'use strict';

const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');

const MODEL_ALIAS = 'guardian-qwen-3.5-2b';
const UPSTREAM_HOST = '127.0.0.1';
const UPSTREAM_PORT = 8081;
const MAXIMUM_PROMPT_CHARACTERS = 24_000;
const MAXIMUM_MESSAGES = 4;
const MAXIMUM_TOKENS = 512;

function readInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} muss zwischen ${minimum} und ${maximum} liegen.`);
  }
  return value;
}

function failStartup(message) {
  console.error(`[ai-proxy] ${message}`);
  process.exit(1);
}

const apiKey = process.env.LLAMA_API_KEY || '';
if (Buffer.byteLength(apiKey, 'utf8') < 32 || /[\r\n]/u.test(apiKey)) {
  failStartup('LLAMA_API_KEY muss gesetzt sein und mindestens 32 Bytes enthalten.');
}

let config;
try {
  config = {
    host: process.env.AI_PROXY_HOST || '0.0.0.0',
    port: readInteger('AI_PROXY_PORT', 8080, 1, 65535),
    maximumRequestBytes: readInteger('AI_PROXY_MAX_REQUEST_BYTES', 65_536, 1024, 1_048_576),
    maximumResponseBytes: readInteger('AI_PROXY_MAX_RESPONSE_BYTES', 131_072, 8192, 1_048_576),
    uploadTimeoutMs: readInteger('AI_PROXY_UPLOAD_TIMEOUT_MS', 10_000, 1000, 60_000),
    inferenceTimeoutMs: readInteger('AI_PROXY_INFERENCE_TIMEOUT_MS', 120_000, 5000, 300_000),
    maximumConcurrency: readInteger('AI_PROXY_MAX_CONCURRENCY', 2, 1, 16),
  };
} catch (error) {
  failStartup(error instanceof Error ? error.message : 'Proxy-Konfiguration ist ungültig.');
}

const expectedAuthorization = Buffer.from(`Bearer ${apiKey}`, 'utf8');
let upstreamReady = false;
let activeRequests = 0;
let shuttingDown = false;
let probeInProgress = false;

function commonHeaders() {
  return {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}

function sendJson(response, statusCode, value, headOnly = false, extraHeaders = {}) {
  if (response.headersSent || response.writableEnded || response.destroyed) return false;
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  response.writeHead(statusCode, {
    ...commonHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    ...extraHeaders,
  });
  response.end(headOnly ? undefined : body);
  return true;
}

function rejectRequest(request, response, statusCode, value, extraHeaders = {}) {
  request.pause();
  response.shouldKeepAlive = false;
  const sent = sendJson(response, statusCode, value, request.method === 'HEAD', {
    Connection: 'close',
    ...extraHeaders,
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
  if (typeof header !== 'string') return false;
  const actual = Buffer.from(header, 'utf8');
  return (
    actual.length === expectedAuthorization.length &&
    crypto.timingSafeEqual(actual, expectedAuthorization)
  );
}

function hasRequestBody(request) {
  const contentLength = request.headers['content-length'];
  return (
    request.headers['transfer-encoding'] !== undefined ||
    (typeof contentLength === 'string' && contentLength !== '0')
  );
}

function validateRequestPayload(body) {
  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch {
    return false;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const allowedKeys = new Set([
    'cache_prompt',
    'chat_template_kwargs',
    'max_tokens',
    'messages',
    'model',
    'reasoning_format',
    'response_format',
    'seed',
    'stream',
    'temperature',
  ]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) return false;
  if (payload.model !== MODEL_ALIAS || payload.stream !== false) return false;
  if (
    !Number.isInteger(payload.max_tokens) ||
    payload.max_tokens < 1 ||
    payload.max_tokens > MAXIMUM_TOKENS
  ) {
    return false;
  }
  if (
    !Array.isArray(payload.messages) ||
    payload.messages.length < 1 ||
    payload.messages.length > MAXIMUM_MESSAGES
  ) {
    return false;
  }
  let totalCharacters = 0;
  for (const message of payload.messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false;
    if (
      Object.keys(message).some((key) => !['role', 'content'].includes(key)) ||
      !['system', 'user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string'
    ) {
      return false;
    }
    totalCharacters += message.content.length;
  }
  if (totalCharacters > MAXIMUM_PROMPT_CHARACTERS) return false;

  if (
    payload.temperature !== undefined &&
    (typeof payload.temperature !== 'number' ||
      !Number.isFinite(payload.temperature) ||
      payload.temperature < 0 ||
      payload.temperature > 2)
  ) {
    return false;
  }
  if (
    payload.seed !== undefined &&
    (!Number.isSafeInteger(payload.seed) || payload.seed < 0 || payload.seed > 4_294_967_295)
  ) {
    return false;
  }
  if (payload.cache_prompt !== undefined && payload.cache_prompt !== true) return false;
  if (payload.reasoning_format !== undefined && payload.reasoning_format !== 'none') return false;
  if (payload.chat_template_kwargs !== undefined) {
    const templateOptions = payload.chat_template_kwargs;
    if (
      !templateOptions ||
      typeof templateOptions !== 'object' ||
      Array.isArray(templateOptions) ||
      Object.keys(templateOptions).length !== 1 ||
      templateOptions.enable_thinking !== false
    ) {
      return false;
    }
  }
  if (payload.response_format !== undefined) {
    const responseFormat = payload.response_format;
    if (!responseFormat || typeof responseFormat !== 'object' || Array.isArray(responseFormat)) {
      return false;
    }
    if (responseFormat.type === 'json_object') {
      if (Object.keys(responseFormat).some((key) => key !== 'type')) return false;
      return true;
    }
    if (
      responseFormat.type !== 'json_schema' ||
      Object.keys(responseFormat).some((key) => !['type', 'json_schema'].includes(key))
    ) {
      return false;
    }
    const jsonSchema = responseFormat.json_schema;
    if (
      !jsonSchema ||
      typeof jsonSchema !== 'object' ||
      Array.isArray(jsonSchema) ||
      Object.keys(jsonSchema).some((key) => !['name', 'strict', 'schema'].includes(key)) ||
      jsonSchema.name !== 'guardian_response' ||
      jsonSchema.strict !== true ||
      !jsonSchema.schema ||
      typeof jsonSchema.schema !== 'object' ||
      Array.isArray(jsonSchema.schema) ||
      Buffer.byteLength(JSON.stringify(jsonSchema.schema), 'utf8') > 8192
    ) {
      return false;
    }
  }
  return true;
}

function probeUpstream() {
  if (probeInProgress || shuttingDown) return;
  probeInProgress = true;
  let settled = false;
  const request = http.get(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: '/health',
      headers: { Connection: 'close' },
    },
    (response) => {
      response.resume();
      finish(response.statusCode === 200);
    },
  );
  function finish(ready) {
    if (settled) return;
    settled = true;
    upstreamReady = ready;
    probeInProgress = false;
    request.destroy();
  }
  request.setTimeout(1000, () => finish(false));
  request.once('error', () => finish(false));
}

function forwardCompletion(request, response, contentLength) {
  activeRequests += 1;
  let released = false;
  let upstreamRequest = null;
  let uploadDeadline = null;
  let inferenceDeadline = null;
  let receivedBytes = 0;
  const requestChunks = [];
  let uploadSettled = false;

  const release = () => {
    if (released) return;
    released = true;
    activeRequests -= 1;
    if (uploadDeadline) clearTimeout(uploadDeadline);
    if (inferenceDeadline) clearTimeout(inferenceDeadline);
    request.setTimeout(0);
  };
  response.once('finish', release);
  response.once('close', () => {
    release();
    uploadSettled = true;
    requestChunks.length = 0;
    if (upstreamRequest && !upstreamRequest.destroyed && !response.writableEnded) {
      upstreamRequest.destroy();
    }
  });

  const rejectUpload = (statusCode, error) => {
    if (uploadSettled) return;
    uploadSettled = true;
    if (uploadDeadline) clearTimeout(uploadDeadline);
    request.setTimeout(0);
    requestChunks.length = 0;
    rejectRequest(request, response, statusCode, { error });
  };

  uploadDeadline = setTimeout(
    () => rejectUpload(408, 'Upload-Zeitlimit überschritten.'),
    config.uploadTimeoutMs,
  );
  request.setTimeout(config.uploadTimeoutMs, () => {
    rejectUpload(408, 'Upload-Zeitlimit überschritten.');
  });
  request.on('data', (chunk) => {
    if (uploadSettled) return;
    receivedBytes += chunk.length;
    if (receivedBytes > contentLength || receivedBytes > config.maximumRequestBytes) {
      rejectUpload(413, 'Anfrage ist zu groß.');
      return;
    }
    requestChunks.push(chunk);
  });
  request.once('aborted', () => {
    uploadSettled = true;
    requestChunks.length = 0;
    if (upstreamRequest && !upstreamRequest.destroyed) upstreamRequest.destroy();
    release();
  });
  request.once('error', () => rejectUpload(400, 'Anfrage konnte nicht gelesen werden.'));
  request.once('end', () => {
    if (uploadSettled || response.headersSent || response.writableEnded) return;
    if (receivedBytes !== contentLength) {
      rejectUpload(400, 'Unvollständige Anfrage.');
      return;
    }
    const body = Buffer.concat(requestChunks, receivedBytes);
    requestChunks.length = 0;
    if (!validateRequestPayload(body)) {
      rejectUpload(400, 'Ungültige Chat-Anfrage.');
      return;
    }
    uploadSettled = true;
    clearTimeout(uploadDeadline);
    request.setTimeout(0);

    upstreamRequest = http.request(
      {
        host: UPSTREAM_HOST,
        port: UPSTREAM_PORT,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'identity',
          'Content-Type': 'application/json',
          'Content-Length': String(body.length),
          Connection: 'close',
        },
      },
      (upstreamResponse) => {
        const chunks = [];
        let bytes = 0;
        let upstreamSettled = false;
        const failUpstream = (message) => {
          if (upstreamSettled) return;
          upstreamSettled = true;
          chunks.length = 0;
          upstreamResponse.destroy();
          sendJson(response, 502, { error: message });
        };
        const upstreamContentType = upstreamResponse.headers['content-type'];
        const rawUpstreamLength = upstreamResponse.headers['content-length'];
        const upstreamLength = Number(rawUpstreamLength);
        if (
          upstreamResponse.statusCode !== 200 ||
          typeof upstreamContentType !== 'string' ||
          !/^application\/json(?:\s*;|$)/iu.test(upstreamContentType) ||
          (rawUpstreamLength !== undefined &&
            (!Number.isSafeInteger(upstreamLength) ||
              upstreamLength < 0 ||
              upstreamLength > config.maximumResponseBytes))
        ) {
          failUpstream('KI-Dienst lieferte eine ungültige Antwort.');
          return;
        }
        upstreamResponse.on('data', (chunk) => {
          if (upstreamSettled) return;
          bytes += chunk.length;
          if (bytes > config.maximumResponseBytes) {
            failUpstream('KI-Antwort ist unerwartet groß.');
            return;
          }
          chunks.push(chunk);
        });
        upstreamResponse.once('error', () => {
          if (!upstreamSettled) {
            upstreamSettled = true;
            chunks.length = 0;
            sendJson(response, 502, { error: 'KI-Antwort konnte nicht gelesen werden.' });
          }
        });
        upstreamResponse.once('end', () => {
          if (upstreamSettled || response.headersSent || response.writableEnded) return;
          upstreamSettled = true;
          const responseBody = Buffer.concat(chunks, bytes);
          try {
            JSON.parse(responseBody.toString('utf8'));
          } catch {
            sendJson(response, 502, { error: 'KI-Dienst lieferte ungültiges JSON.' });
            return;
          }
          response.writeHead(200, {
            ...commonHeaders(),
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': String(responseBody.length),
          });
          response.end(responseBody);
        });
      },
    );
    let inferenceTimedOut = false;
    inferenceDeadline = setTimeout(() => {
      inferenceTimedOut = true;
      upstreamRequest.destroy(new Error('inference timeout'));
    }, config.inferenceTimeoutMs);
    upstreamRequest.once('error', () => {
      upstreamReady = false;
      sendJson(response, inferenceTimedOut ? 504 : 502, {
        error: inferenceTimedOut
          ? 'KI-Anfrage hat das Zeitlimit überschritten.'
          : 'KI-Dienst ist momentan nicht erreichbar.',
      });
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
      upstreamReady && llama.exitCode === null ? 200 : 503,
      upstreamReady && llama.exitCode === null ? { status: 'ok' } : { status: 'starting' },
      headOnly,
    );
    return;
  }
  if (request.method !== 'POST' || pathname !== '/v1/chat/completions') {
    rejectRequest(request, response, 404, { error: 'Nicht gefunden.' });
    return;
  }
  if (!hasValidAuthorization(request)) {
    rejectRequest(
      request,
      response,
      401,
      { error: 'Nicht autorisiert.' },
      {
        'WWW-Authenticate': 'Bearer realm="local-ai"',
      },
    );
    return;
  }
  if (!upstreamReady || llama.exitCode !== null) {
    rejectRequest(
      request,
      response,
      503,
      { error: 'KI-Modell wird noch geladen.' },
      {
        'Retry-After': '5',
      },
    );
    return;
  }
  if (activeRequests >= config.maximumConcurrency) {
    rejectRequest(
      request,
      response,
      429,
      { error: 'KI-Dienst ist ausgelastet.' },
      {
        'Retry-After': '2',
      },
    );
    return;
  }
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    rejectRequest(request, response, 415, { error: 'application/json ist erforderlich.' });
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
  if (contentLength > config.maximumRequestBytes) {
    rejectRequest(request, response, 413, { error: 'Anfrage ist zu groß.' });
    return;
  }
  forwardCompletion(request, response, contentLength);
});

server.on('checkContinue', (request, response) => {
  rejectRequest(request, response, 417, { error: 'Expect-Continue wird nicht unterstützt.' });
});
server.headersTimeout = 15_000;
server.requestTimeout = config.uploadTimeoutMs;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;
server.maxConnections = 128;

const childEnvironment = { ...process.env };
delete childEnvironment.LLAMA_API_KEY;
const configuredLlamaArguments = process.argv.slice(2);
if (
  configuredLlamaArguments.some(
    (argument) =>
      argument === '--host' ||
      argument.startsWith('--host=') ||
      argument === '--port' ||
      argument.startsWith('--port='),
  )
) {
  failStartup('Host und Port des internen llama-Servers dürfen nicht überschrieben werden.');
}
const llama = spawn(
  '/app/llama-server',
  [...configuredLlamaArguments, '--host', UPSTREAM_HOST, '--port', String(UPSTREAM_PORT)],
  {
    cwd: '/app',
    env: childEnvironment,
    stdio: ['ignore', 'inherit', 'inherit'],
  },
);
llama.once('error', (error) => {
  upstreamReady = false;
  console.error(`[ai-proxy] llama-server konnte nicht gestartet werden: ${error.message}`);
  if (!shuttingDown) server.close(() => process.exit(1));
});
llama.once('exit', (code, signal) => {
  upstreamReady = false;
  if (!shuttingDown) {
    console.error(`[ai-proxy] llama-server beendet (code=${code}, signal=${signal}).`);
    server.close(() => process.exit(code || 1));
  }
});

const probeTimer = setInterval(probeUpstream, 1000);
probeTimer.unref();
probeUpstream();
server.listen(config.port, config.host, () => {
  console.log(`[ai-proxy] Geschützter KI-Proxy lauscht auf ${config.host}:${config.port}.`);
});
server.once('error', (error) => {
  console.error(`[ai-proxy] HTTP-Serverfehler: ${error.message}`);
  if (llama.exitCode === null) llama.kill('SIGTERM');
  process.exit(1);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  upstreamReady = false;
  clearInterval(probeTimer);
  console.log(`[ai-proxy] Beende Dienst wegen ${signal}.`);
  server.close();
  if (llama.exitCode === null) llama.kill('SIGTERM');
  const forceTimer = setTimeout(() => {
    if (llama.exitCode === null) llama.kill('SIGKILL');
    process.exit(1);
  }, 10_000);
  forceTimer.unref();
  llama.once('exit', () => process.exit(0));
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
