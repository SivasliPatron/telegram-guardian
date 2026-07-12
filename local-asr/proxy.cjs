'use strict';

const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');

const MAXIMUM_PCM_DATA_BYTES = 3_840_000;
const PCM_BYTES_PER_MILLISECOND = 32;
const UNKNOWN_RIFF_SIZE = 0xffffffff;
const MAXIMUM_MULTIPART_HEADER_BYTES = 8 * 1024;

function readInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} muss eine ganze Zahl zwischen ${minimum} und ${maximum} sein.`);
  }

  return value;
}

function failStartup(message) {
  console.error(`[asr-proxy] ${message}`);
  process.exit(1);
}

const apiKey = process.env.ASR_API_KEY || '';

if (Buffer.byteLength(apiKey, 'utf8') < 32 || /[\r\n]/.test(apiKey)) {
  failStartup('ASR_API_KEY muss gesetzt sein und mindestens 32 Bytes enthalten.');
}

let config;

try {
  config = {
    host: process.env.ASR_HOST || '0.0.0.0',
    port: readInteger('ASR_PORT', 8080, 1, 65535),
    maxUploadBytes: readInteger('ASR_MAX_UPLOAD_BYTES', 4_000_000, 1, 100_000_000),
    maxResponseBytes: readInteger('ASR_MAX_RESPONSE_BYTES', 1_048_576, 1024, 10_000_000),
    uploadTimeoutMs: readInteger('ASR_UPLOAD_TIMEOUT_MS', 30_000, 1000, 300_000),
    inferenceTimeoutMs: readInteger('ASR_INFERENCE_TIMEOUT_MS', 180_000, 1000, 900_000),
    threads: readInteger('WHISPER_THREADS', 5, 1, 64),
    maxDurationMs: readInteger('WHISPER_MAX_DURATION_MS', 120_000, 1000, 120_000),
  };
} catch (error) {
  failStartup(error.message);
}

const expectedAuthorization = Buffer.from(`Bearer ${apiKey}`, 'utf8');
const maximumPcmDataBytes = Math.min(
  MAXIMUM_PCM_DATA_BYTES,
  config.maxDurationMs * PCM_BYTES_PER_MILLISECOND,
);
const upstreamHost = '127.0.0.1';
const upstreamPort = 8081;
const whisperBinary = '/app/build/bin/whisper-server';
const whisperArguments = [
  '--model',
  '/models/ggml-small.bin',
  '--host',
  upstreamHost,
  '--port',
  String(upstreamPort),
  '--threads',
  String(config.threads),
  '--processors',
  '1',
  '--duration',
  String(config.maxDurationMs),
  '--language',
  'auto',
  '--no-gpu',
  '--no-timestamps',
];

let activeInference = false;
let upstreamReady = false;
let shuttingDown = false;
let probeInProgress = false;
let fatalInferenceAbort = false;
let probeTimer = null;

function commonHeaders() {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

function sendJson(response, statusCode, value, extraHeaders, headOnly = false) {
  if (response.headersSent || response.writableEnded || response.destroyed) {
    return false;
  }

  const body = Buffer.from(JSON.stringify(value), 'utf8');
  response.writeHead(statusCode, {
    ...commonHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    ...(extraHeaders || {}),
  });
  response.end(headOnly ? undefined : body);
  return true;
}

function rejectRequest(request, response, statusCode, value, extraHeaders) {
  request.pause();
  response.shouldKeepAlive = false;
  const sent = sendJson(response, statusCode, value, {
    Connection: 'close',
    ...(extraHeaders || {}),
  });
  if (sent && !request.complete) {
    response.once('finish', () => {
      if (!request.complete && !request.destroyed) request.destroy();
    });
  }
}

function hasValidAuthorization(request) {
  const authorizationHeaders = request.rawHeaders.filter(
    (value, index) => index % 2 === 0 && value.toLowerCase() === 'authorization',
  );
  if (authorizationHeaders.length !== 1) return false;
  const header = request.headers.authorization;

  if (typeof header !== 'string') {
    return false;
  }

  const actualAuthorization = Buffer.from(header, 'utf8');
  return (
    actualAuthorization.length === expectedAuthorization.length &&
    crypto.timingSafeEqual(actualAuthorization, expectedAuthorization)
  );
}

function hasRequestBody(request) {
  const contentLength = request.headers['content-length'];
  return (
    request.headers['transfer-encoding'] !== undefined ||
    (typeof contentLength === 'string' && contentLength !== '0')
  );
}

function extractBoundary(contentType) {
  const segments = contentType.split(';');
  if (segments.length !== 2 || segments[0].trim().toLowerCase() !== 'multipart/form-data') {
    return null;
  }

  const match = /^boundary=([A-Za-z0-9._-]{1,70})$/u.exec(segments[1].trim());
  return match?.[1] || null;
}

const allowedTextFields = new Map([
  ['temperature', new Set(['0', '0.0'])],
  ['temperature_inc', new Set(['0', '0.0'])],
  ['language', new Set(['auto', 'de', 'en', 'tr'])],
  ['translate', new Set(['false', '0'])],
  ['response_format', new Set(['json'])],
]);

function fourCcEquals(buffer, offset, expected) {
  return buffer.subarray(offset, offset + 4).equals(Buffer.from(expected, 'ascii'));
}

function validatePcmWav(audio) {
  if (audio.length < 44 || !fourCcEquals(audio, 0, 'RIFF') || !fourCcEquals(audio, 8, 'WAVE')) {
    throw new Error('Nur RIFF/WAVE-Audio ist erlaubt.');
  }

  const riffSize = audio.readUInt32LE(4);
  if (riffSize !== UNKNOWN_RIFF_SIZE && riffSize + 8 !== audio.length) {
    throw new Error('Die RIFF-Dateigröße stimmt nicht mit dem Upload überein.');
  }

  let offset = 12;
  let foundFormat = false;
  let foundData = false;

  while (offset < audio.length) {
    if (offset + 8 > audio.length) {
      throw new Error('Der WAV-Chunk-Header ist unvollständig.');
    }

    const chunkSize = audio.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;

    if (fourCcEquals(audio, offset, 'data')) {
      if (!foundFormat || foundData) {
        throw new Error('Der WAV-Datenchunk fehlt oder ist doppelt.');
      }

      const usesStreamingSize = chunkSize === UNKNOWN_RIFF_SIZE;
      if ((riffSize === UNKNOWN_RIFF_SIZE) !== usesStreamingSize) {
        throw new Error('Streaming-Größen im WAV-Header sind widersprüchlich.');
      }

      const actualDataBytes = usesStreamingSize ? audio.length - chunkDataStart : chunkSize;
      if (!usesStreamingSize && chunkDataStart + chunkSize !== audio.length) {
        throw new Error('Der WAV-Datenchunk muss der letzte Chunk sein.');
      }
      if (
        actualDataBytes <= 0 ||
        actualDataBytes % 2 !== 0 ||
        actualDataBytes > maximumPcmDataBytes
      ) {
        throw new Error(
          'Die reale PCM-Datenmenge ist ungültig oder überschreitet die Höchstdauer.',
        );
      }

      foundData = true;
      offset = audio.length;
      continue;
    }

    if (chunkSize === UNKNOWN_RIFF_SIZE) {
      throw new Error('Nur der finale WAV-Datenchunk darf eine Streaming-Größe verwenden.');
    }

    const chunkDataEnd = chunkDataStart + chunkSize;
    const paddedChunkEnd = chunkDataEnd + (chunkSize % 2);
    if (paddedChunkEnd > audio.length) {
      throw new Error('Ein WAV-Chunk überschreitet die Dateigrenze.');
    }

    if (fourCcEquals(audio, offset, 'fmt ')) {
      if (foundFormat || (chunkSize !== 16 && chunkSize !== 18)) {
        throw new Error('Der WAV-Format-Chunk ist ungültig oder doppelt.');
      }

      const formatTag = audio.readUInt16LE(chunkDataStart);
      const channels = audio.readUInt16LE(chunkDataStart + 2);
      const sampleRate = audio.readUInt32LE(chunkDataStart + 4);
      const byteRate = audio.readUInt32LE(chunkDataStart + 8);
      const blockAlign = audio.readUInt16LE(chunkDataStart + 12);
      const bitsPerSample = audio.readUInt16LE(chunkDataStart + 14);
      const extensionSize = chunkSize === 18 ? audio.readUInt16LE(chunkDataStart + 16) : 0;

      if (
        formatTag !== 1 ||
        channels !== 1 ||
        sampleRate !== 16_000 ||
        byteRate !== 32_000 ||
        blockAlign !== 2 ||
        bitsPerSample !== 16 ||
        extensionSize !== 0
      ) {
        throw new Error('WAV muss PCM16, mono und 16 kHz sein.');
      }

      foundFormat = true;
    }

    offset = paddedChunkEnd;
  }

  if (!foundFormat || !foundData) {
    throw new Error('WAV enthält keinen gültigen Format- oder Datenchunk.');
  }
}

function parsePartHeaders(originalHeaders) {
  const lines = originalHeaders.split('\r\n');
  if (lines.length === 0 || lines.some((line) => line.length === 0)) {
    throw new Error('Multipart-Header ist ungültig.');
  }

  const dispositionLines = lines.filter((line) => /^Content-Disposition\s*:/i.test(line));
  if (dispositionLines.length !== 1) {
    throw new Error('Genau ein Content-Disposition-Header ist erforderlich.');
  }

  const disposition =
    /^Content-Disposition:\s*form-data;\s*name="([A-Za-z0-9_]{1,32})"(?:;\s*filename="([^"\r\n]+)")?$/i.exec(
      dispositionLines[0],
    );
  if (!disposition) {
    throw new Error('Content-Disposition ist nicht im erlaubten Format.');
  }

  const fieldName = disposition[1];
  const filename = disposition[2];
  const otherLines = lines.filter((line) => line !== dispositionLines[0]);

  if (fieldName === 'file') {
    if (
      !filename ||
      otherLines.length !== 1 ||
      !/^Content-Type:\s*audio\/wav\s*$/i.test(otherLines[0])
    ) {
      throw new Error('Die Datei muss als audio/wav hochgeladen werden.');
    }
  } else if (filename !== undefined || otherLines.length !== 0) {
    throw new Error('Multipart-Steuerfelder dürfen keine Dateiheader enthalten.');
  }

  return fieldName;
}

// Validate every multipart control field before whisper-server sees it. This
// prevents request fields such as "duration" or "debug_mode" from overriding
// the locked server settings. Uploaded filenames are replaced because the
// upstream server logs them; audio bytes remain untouched.
function sanitizeMultipartBody(body, boundary) {
  const marker = Buffer.from(`--${boundary}`, 'utf8');
  const innerMarker = Buffer.from(`\r\n--${boundary}`, 'utf8');
  const headerTerminator = Buffer.from('\r\n\r\n', 'ascii');
  const chunks = [];
  const seenFields = new Set();
  let cursor = 0;
  let firstBoundary = true;
  let fileParts = 0;

  while (true) {
    const expectedMarker = firstBoundary ? marker : innerMarker;
    if (!body.subarray(cursor, cursor + expectedMarker.length).equals(expectedMarker)) {
      throw new Error('Multipart-Grenze steht nicht an der erwarteten Position.');
    }

    cursor += expectedMarker.length;
    const isFinalBoundary = body[cursor] === 45 && body[cursor + 1] === 45;

    if (isFinalBoundary) {
      cursor += 2;
      if (body[cursor] === 13 && body[cursor + 1] === 10) {
        cursor += 2;
      }
      if (cursor !== body.length) {
        throw new Error('Multipart-Epilog ist nicht erlaubt.');
      }
      break;
    }

    if (body[cursor] !== 13 || body[cursor + 1] !== 10) {
      throw new Error('Multipart-Grenze ist ungültig.');
    }

    const headerStart = cursor + 2;
    const headerEnd = body.indexOf(headerTerminator, headerStart);

    if (headerEnd === -1 || headerEnd - headerStart > MAXIMUM_MULTIPART_HEADER_BYTES) {
      throw new Error('Multipart-Header ist unvollständig.');
    }

    const contentStart = headerEnd + headerTerminator.length;
    const nextMarker = body.indexOf(innerMarker, contentStart);

    if (nextMarker === -1) {
      throw new Error('Multipart-Endmarke fehlt.');
    }

    const originalHeaders = body.subarray(headerStart, headerEnd).toString('latin1');
    const fieldName = parsePartHeaders(originalHeaders);

    if (!fieldName || seenFields.has(fieldName)) {
      throw new Error('Multipart-Feld fehlt oder ist doppelt.');
    }

    seenFields.add(fieldName);
    const valueBytes = body.subarray(contentStart, nextMarker);

    if (fieldName === 'file') {
      if (valueBytes.length === 0) {
        throw new Error('Audiodatei fehlt.');
      }
      validatePcmWav(valueBytes);
      fileParts += 1;
    } else {
      const allowedValues = allowedTextFields.get(fieldName);

      if (!allowedValues || valueBytes.length > 16) {
        throw new Error('Multipart-Steuerfeld ist nicht erlaubt.');
      }

      const value = valueBytes.toString('utf8');

      if (!allowedValues.has(value)) {
        throw new Error('Multipart-Steuerwert ist nicht erlaubt.');
      }
    }

    const prefix = chunks.length === 0 ? `--${boundary}\r\n` : `\r\n--${boundary}\r\n`;
    const safeHeaders =
      fieldName === 'file'
        ? 'Content-Disposition: form-data; name="file"; filename="audio.wav"\r\nContent-Type: audio/wav'
        : `Content-Disposition: form-data; name="${fieldName}"`;
    chunks.push(Buffer.from(`${prefix}${safeHeaders}\r\n\r\n`, 'latin1'));
    chunks.push(valueBytes);
    cursor = nextMarker;
    firstBoundary = false;
  }

  if (firstBoundary || fileParts !== 1) {
    throw new Error('Genau eine Audiodatei ist erforderlich.');
  }

  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'ascii'));
  return Buffer.concat(chunks);
}

function probeUpstream() {
  if (probeInProgress || shuttingDown) {
    return;
  }

  probeInProgress = true;
  let settled = false;
  const request = http.get(
    {
      host: upstreamHost,
      port: upstreamPort,
      path: '/health',
      headers: { Connection: 'close' },
    },
    (response) => {
      response.resume();
      finish(response.statusCode === 200);
    },
  );

  function finish(ready) {
    if (settled) {
      return;
    }

    settled = true;
    upstreamReady = ready;
    probeInProgress = false;
    request.destroy();
  }

  request.setTimeout(1000, () => finish(false));
  request.once('error', () => finish(false));
}

function terminateContainerAfterInferenceAbort(reason) {
  if (fatalInferenceAbort) {
    return;
  }

  fatalInferenceAbort = true;
  shuttingDown = true;
  upstreamReady = false;
  if (probeTimer) {
    clearInterval(probeTimer);
  }
  console.error(`[asr-proxy] ${reason}; Dienst wird hart neu gestartet.`);
  server.close();
  if (whisper.exitCode === null) {
    whisper.kill('SIGKILL');
  }
  setImmediate(() => process.exit(1));
}

function forwardInference(request, response, contentLength, boundary) {
  activeInference = true;
  let released = false;
  let upstreamRequest = null;
  let receivedBytes = 0;
  let discarded = false;
  let uploadDeadline = null;
  let upstreamReturned = false;
  const requestChunks = [];

  const release = () => {
    if (!released) {
      released = true;
      activeInference = false;
      clearTimeout(uploadDeadline);
    }
  };

  response.once('finish', release);
  response.once('close', () => {
    const inferenceWasAborted =
      upstreamRequest !== null && !upstreamReturned && !response.writableEnded;
    release();
    if (inferenceWasAborted) {
      terminateContainerAfterInferenceAbort('Clientverbindung während aktiver Inferenz beendet');
    } else if (upstreamRequest && !upstreamRequest.destroyed && !response.writableEnded) {
      upstreamRequest.destroy();
    }
  });

  const rejectUpload = (statusCode, error) => {
    if (discarded) {
      return;
    }

    discarded = true;
    clearTimeout(uploadDeadline);
    requestChunks.length = 0;
    rejectRequest(request, response, statusCode, { error });
  };

  uploadDeadline = setTimeout(() => {
    rejectUpload(408, 'Upload-Zeitlimit überschritten.');
  }, config.uploadTimeoutMs);

  request.setTimeout(config.uploadTimeoutMs, () => {
    rejectUpload(408, 'Upload-Zeitlimit überschritten.');
  });

  request.on('data', (chunk) => {
    if (discarded) {
      return;
    }

    receivedBytes += chunk.length;

    if (receivedBytes > contentLength || receivedBytes > config.maxUploadBytes) {
      rejectUpload(413, 'Audiodatei ist zu groß.');
      return;
    }

    requestChunks.push(chunk);
  });

  request.once('error', () => {
    rejectUpload(400, 'Upload konnte nicht gelesen werden.');
  });

  request.once('aborted', () => {
    if (discarded) return;
    discarded = true;
    requestChunks.length = 0;
    if (upstreamRequest && !upstreamReturned) {
      terminateContainerAfterInferenceAbort('Client hat eine aktive Inferenz abgebrochen');
      return;
    }
    release();
  });

  request.once('end', () => {
    clearTimeout(uploadDeadline);
    request.setTimeout(0);

    if (discarded) {
      return;
    }

    if (receivedBytes !== contentLength) {
      rejectUpload(400, 'Unvollständiger Upload.');
      return;
    }

    const originalBody = Buffer.concat(requestChunks, receivedBytes);
    requestChunks.length = 0;
    let body;

    try {
      body = sanitizeMultipartBody(originalBody, boundary);
    } catch {
      rejectUpload(400, 'Multipart-Upload enthält ungültige Felder.');
      return;
    }

    upstreamRequest = http.request(
      {
        host: upstreamHost,
        port: upstreamPort,
        path: '/inference',
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length),
        },
      },
      (upstreamResponse) => {
        upstreamReturned = true;
        upstreamRequest.setTimeout(0);
        const responseChunks = [];
        let responseBytes = 0;
        let responseTooLarge = false;

        upstreamResponse.on('data', (chunk) => {
          responseBytes += chunk.length;

          if (responseBytes > config.maxResponseBytes) {
            responseTooLarge = true;
            responseChunks.length = 0;
            upstreamResponse.destroy();
            sendJson(response, 502, { error: 'ASR-Antwort ist unerwartet groß.' });
            return;
          }

          responseChunks.push(chunk);
        });

        upstreamResponse.once('error', () => {
          if (!responseTooLarge) {
            sendJson(response, 502, { error: 'ASR-Antwort konnte nicht gelesen werden.' });
          }
        });

        upstreamResponse.once('end', () => {
          if (responseTooLarge || response.headersSent || response.writableEnded) {
            return;
          }

          const responseBody = Buffer.concat(responseChunks, responseBytes);
          const upstreamContentType = upstreamResponse.headers['content-type'];
          response.writeHead(upstreamResponse.statusCode || 502, {
            ...commonHeaders(),
            'Content-Type':
              typeof upstreamContentType === 'string'
                ? upstreamContentType
                : 'application/json; charset=utf-8',
            'Content-Length': String(responseBody.length),
          });
          response.end(responseBody);
        });
      },
    );

    upstreamRequest.setTimeout(config.inferenceTimeoutMs, () => {
      terminateContainerAfterInferenceAbort('Inferenz-Zeitlimit überschritten');
    });

    upstreamRequest.once('error', () => {
      if (!upstreamReturned) {
        terminateContainerAfterInferenceAbort(
          'Upstream-Verbindung während aktiver Inferenz beendet',
        );
        return;
      }
      upstreamReady = false;
      sendJson(response, 502, { error: 'ASR-Dienst ist momentan nicht erreichbar.' });
    });

    upstreamRequest.end(body);
  });
}

const server = http.createServer((request, response) => {
  const pathname = request.url || '';
  const headOnly = request.method === 'HEAD';

  if ((request.method === 'GET' || headOnly) && pathname === '/health') {
    if (hasRequestBody(request)) {
      rejectRequest(request, response, 400, { error: 'Healthcheck darf keinen Body enthalten.' });
      return;
    }
    sendJson(
      response,
      upstreamReady && whisper.exitCode === null ? 200 : 503,
      upstreamReady && whisper.exitCode === null ? { status: 'ok' } : { status: 'starting' },
      undefined,
      headOnly,
    );
    return;
  }

  if (request.method !== 'POST' || pathname !== '/inference') {
    rejectRequest(request, response, 404, { error: 'Nicht gefunden.' });
    return;
  }

  if (!hasValidAuthorization(request)) {
    rejectRequest(
      request,
      response,
      401,
      { error: 'Nicht autorisiert.' },
      { 'WWW-Authenticate': 'Bearer realm="local-asr"' },
    );
    return;
  }

  if (!upstreamReady || whisper.exitCode !== null) {
    rejectRequest(
      request,
      response,
      503,
      { error: 'ASR-Modell wird noch geladen.' },
      { 'Retry-After': '5' },
    );
    return;
  }

  if (activeInference) {
    rejectRequest(
      request,
      response,
      429,
      { error: 'ASR-Dienst ist ausgelastet.' },
      { 'Retry-After': '2' },
    );
    return;
  }

  const contentType = request.headers['content-type'];

  if (typeof contentType !== 'string' || !/^multipart\/form-data(?:;|$)/i.test(contentType)) {
    rejectRequest(request, response, 415, { error: 'multipart/form-data ist erforderlich.' });
    return;
  }

  const boundary = extractBoundary(contentType);

  if (!boundary) {
    rejectRequest(request, response, 400, {
      error: 'Multipart-Boundary fehlt oder ist ungültig.',
    });
    return;
  }

  if (request.headers['transfer-encoding'] !== undefined) {
    rejectRequest(request, response, 411, { error: 'Content-Length ist erforderlich.' });
    return;
  }

  const rawContentLength = request.headers['content-length'];
  if (typeof rawContentLength !== 'string') {
    rejectRequest(request, response, 411, { error: 'Content-Length ist erforderlich.' });
    return;
  }

  if (!/^[1-9]\d*$/u.test(rawContentLength)) {
    rejectRequest(request, response, 400, { error: 'Content-Length ist ungültig.' });
    return;
  }

  const contentLength = Number(rawContentLength);
  if (!Number.isSafeInteger(contentLength)) {
    rejectRequest(request, response, 400, { error: 'Content-Length ist ungültig.' });
    return;
  }

  if (contentLength > config.maxUploadBytes) {
    rejectRequest(request, response, 413, { error: 'Audiodatei ist zu groß.' });
    return;
  }

  forwardInference(request, response, contentLength, boundary);
});

server.on('checkContinue', (request, response) => {
  rejectRequest(request, response, 417, { error: 'Expect-Continue wird nicht unterstützt.' });
});
server.headersTimeout = 15_000;
server.requestTimeout = config.uploadTimeoutMs;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;
server.maxConnections = 64;

const whisperEnvironment = { ...process.env };
delete whisperEnvironment.ASR_API_KEY;

const whisper = spawn(whisperBinary, whisperArguments, {
  cwd: '/app',
  env: whisperEnvironment,
  stdio: ['ignore', 'inherit', 'inherit'],
});

whisper.once('error', (error) => {
  upstreamReady = false;
  console.error(`[asr-proxy] whisper-server konnte nicht gestartet werden: ${error.message}`);

  if (!shuttingDown) {
    server.close(() => process.exit(1));
  }
});

whisper.once('exit', (code, signal) => {
  upstreamReady = false;

  if (!shuttingDown) {
    console.error(
      `[asr-proxy] whisper-server wurde unerwartet beendet (code=${code}, signal=${signal}).`,
    );
    server.close(() => process.exit(code || 1));
  }
});

probeTimer = setInterval(probeUpstream, 1000);
probeTimer.unref();
probeUpstream();

server.listen(config.port, config.host, () => {
  console.log(`[asr-proxy] Auth-Proxy lauscht auf ${config.host}:${config.port}.`);
});

function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  upstreamReady = false;
  clearInterval(probeTimer);
  console.log(`[asr-proxy] Beende Dienst wegen ${signal}.`);
  server.close();

  if (whisper.exitCode === null) {
    whisper.kill('SIGTERM');
  }

  const forceTimer = setTimeout(() => {
    if (whisper.exitCode === null) {
      whisper.kill('SIGKILL');
    }
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  whisper.once('exit', () => process.exit(0));
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
