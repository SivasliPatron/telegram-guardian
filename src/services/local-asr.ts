import { z } from 'zod';

const MAXIMUM_RESPONSE_BYTES = 256 * 1_024;
const MAXIMUM_TRANSCRIPT_CHARACTERS = 4_096;

const transcriptionResponseSchema = z.object({
  text: z.string().max(MAXIMUM_TRANSCRIPT_CHARACTERS * 4),
});

export interface LocalAsrClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maximumAudioBytes: number;
}

export class LocalAsrHttpError extends Error {
  public constructor(public readonly status: number) {
    super(`Der lokale Transkriptionsdienst antwortete mit HTTP ${status}.`);
    this.name = 'LocalAsrHttpError';
  }
}

async function readLimitedResponseText(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    byteCount += chunk.value.byteLength;
    if (byteCount > MAXIMUM_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Die lokale Transkriptionsantwort ist zu groß.');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * Sends a WAV file to the protected whisper.cpp gateway and returns only its transcript.
 * Audio and transcript contents are deliberately never included in thrown errors.
 */
export class LocalAsrClient {
  private readonly endpoint: string;

  public constructor(private readonly options: LocalAsrClientOptions) {
    this.endpoint = `${options.baseUrl.replace(/\/+$/u, '')}/inference`;
  }

  public async transcribe(wavAudio: Buffer): Promise<string> {
    if (wavAudio.length === 0) throw new Error('Die Audiodatei ist leer.');
    if (wavAudio.length > this.options.maximumAudioBytes) {
      throw new Error('Die Audiodatei überschreitet das erlaubte Größenlimit.');
    }

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(wavAudio)], { type: 'audio/wav' }), 'audio.wav');
    form.append('temperature', '0');
    form.append('temperature_inc', '0');
    form.append('language', 'auto');
    form.append('translate', 'false');
    form.append('response_format', 'json');

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.apiKey}` },
      body: form,
      redirect: 'error',
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new LocalAsrHttpError(response.status);
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAXIMUM_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new Error('Die lokale Transkriptionsantwort ist zu groß.');
    }
    const responseText = await readLimitedResponseText(response);

    const parsed = transcriptionResponseSchema.parse(JSON.parse(responseText));
    const transcript = parsed.text
      .normalize('NFKC')
      .replace(/\p{Cc}+/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, MAXIMUM_TRANSCRIPT_CHARACTERS);
    if (!transcript) throw new Error('Die Audiodatei enthält keinen erkennbaren Sprachtext.');
    return transcript;
  }
}
