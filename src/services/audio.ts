import { spawn } from 'node:child_process';

export interface AudioModerationLimits {
  maxDurationSeconds: number;
  maxBytes: number;
}

export interface AudioCandidate {
  durationSeconds: number;
  fileSize?: number;
}

export async function readAudioResponseBuffer(
  response: Response,
  maximumBytes: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    throw new Error('Ungültiges Audio-Größenlimit');
  }

  const rawContentLength = response.headers.get('content-length');
  if (rawContentLength !== null) {
    const contentLength = Number(rawContentLength);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new Error('Ungültige Audio-Größenangabe');
    }
    if (contentLength > maximumBytes) {
      await response.body?.cancel();
      throw new Error('Heruntergeladenes Audio überschreitet das Größenlimit');
    }
  }

  const body = response.body;
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    receivedBytes += chunk.value.byteLength;
    if (receivedBytes > maximumBytes) {
      await reader.cancel();
      throw new Error('Heruntergeladenes Audio überschreitet das Größenlimit');
    }
    chunks.push(Buffer.from(chunk.value));
  }
  return Buffer.concat(chunks, receivedBytes);
}

/** Replaces ffmpeg's unknown pipe sizes with the actual in-memory WAV sizes. */
export function finalizePipeWavHeader(wavAudio: Buffer): Buffer {
  if (
    wavAudio.length < 44 ||
    wavAudio.toString('ascii', 0, 4) !== 'RIFF' ||
    wavAudio.toString('ascii', 8, 12) !== 'WAVE' ||
    wavAudio.length - 8 > 0xffff_ffff
  ) {
    throw new Error('Audio-Konvertierung lieferte keine gültige WAV-Datei');
  }

  const finalized = Buffer.from(wavAudio);
  finalized.writeUInt32LE(finalized.length - 8, 4);
  let offset = 12;
  while (offset + 8 <= finalized.length) {
    const chunkName = finalized.toString('ascii', offset, offset + 4);
    const declaredSize = finalized.readUInt32LE(offset + 4);
    const contentOffset = offset + 8;
    if (chunkName === 'data') {
      const actualSize = finalized.length - contentOffset;
      if (actualSize > 0xffff_ffff || (declaredSize !== 0xffff_ffff && declaredSize > actualSize)) {
        throw new Error('Audio-Konvertierung lieferte eine beschädigte WAV-Datei');
      }
      finalized.writeUInt32LE(actualSize, offset + 4);
      return finalized;
    }
    if (declaredSize === 0xffff_ffff || contentOffset + declaredSize > finalized.length) break;
    offset = contentOffset + declaredSize + (declaredSize % 2);
  }
  throw new Error('Audio-Konvertierung lieferte keine WAV-Audiodaten');
}

export function audioWithinModerationLimits(
  candidate: AudioCandidate,
  limits: AudioModerationLimits,
): boolean {
  return (
    candidate.durationSeconds > 0 &&
    candidate.durationSeconds <= limits.maxDurationSeconds &&
    (candidate.fileSize === undefined || candidate.fileSize <= limits.maxBytes)
  );
}

export async function convertAudioToWav(
  input: Buffer,
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const process = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        '-f',
        'wav',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputSize = 0;
    let settled = false;

    const finishWithError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.kill('SIGKILL');
      reject(error);
    };

    const timer = setTimeout(
      () => finishWithError(new Error('Audio-Konvertierung hat das Zeitlimit überschritten')),
      timeoutMs,
    );

    process.stdout.on('data', (chunk: Buffer) => {
      outputSize += chunk.length;
      if (outputSize > maxOutputBytes) {
        finishWithError(new Error('Konvertiertes Audio überschreitet das Größenlimit'));
        return;
      }
      output.push(chunk);
    });
    process.stderr.on('data', (chunk: Buffer) => {
      if (errors.reduce((total, item) => total + item.length, 0) < 4_096) errors.push(chunk);
    });
    process.once('error', (error) => finishWithError(error));
    process.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `Audio-Konvertierung fehlgeschlagen: ${Buffer.concat(errors).toString('utf8').trim()}`,
          ),
        );
        return;
      }
      try {
        resolve(finalizePipeWavHeader(Buffer.concat(output, outputSize)));
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Ungültige WAV-Ausgabe'));
      }
    });
    process.stdin.once('error', (error) => finishWithError(error));
    process.stdin.end(input);
  });
}
