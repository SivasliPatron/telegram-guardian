import { spawn } from 'node:child_process';

export interface AudioModerationLimits {
  maxDurationSeconds: number;
  maxBytes: number;
}

export interface AudioCandidate {
  durationSeconds: number;
  fileSize?: number;
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
      resolve(Buffer.concat(output));
    });
    process.stdin.once('error', (error) => finishWithError(error));
    process.stdin.end(input);
  });
}
