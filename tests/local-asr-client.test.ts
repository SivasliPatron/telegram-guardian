import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocalAsrClient,
  LocalAsrHttpError,
  type LocalAsrClientOptions,
} from '../src/services/local-asr.js';

const fetchMock = vi.fn<typeof fetch>();

const defaultOptions: LocalAsrClientOptions = {
  baseUrl: 'http://local-asr:8080/',
  apiKey: 'local-asr-secret-for-tests',
  timeoutMs: 5_000,
  maximumAudioBytes: 1_024,
};

function createClient(overrides: Partial<LocalAsrClientOptions> = {}): LocalAsrClient {
  return new LocalAsrClient({ ...defaultOptions, ...overrides });
}

function transcriptResponse(text: string): Response {
  return new Response(JSON.stringify({ text }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function chunkedResponse(totalBytes: number, chunkBytes = 4_096): Response {
  let emittedBytes = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (emittedBytes >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - emittedBytes);
      emittedBytes += size;
      controller.enqueue(new Uint8Array(size).fill(0x78));
    },
  });
  return new Response(stream, { status: 200 });
}

function fetchCall(): [string, RequestInit | undefined] {
  const call = fetchMock.mock.calls[0];
  if (!call) throw new Error('Fetch-Aufruf fehlt');
  const [input, init] = call;
  if (typeof input !== 'string') throw new Error('Fetch-URL ist kein String');
  return [input, init];
}

describe('lokaler whisper.cpp-ASR-Client', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sendet WAV, Parameter und Authentifizierung als korrektes Multipart-Formular', async () => {
    fetchMock.mockResolvedValueOnce(transcriptResponse('Gesprochener Test'));
    const client = createClient();
    const wavAudio = Buffer.from([0x52, 0x49, 0x46, 0x46]);

    await expect(client.transcribe(wavAudio)).resolves.toBe('Gesprochener Test');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchCall();
    expect(url).toBe('http://local-asr:8080/inference');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer local-asr-secret-for-tests');
    expect(headers.get('content-type')).toBeNull();
    expect(init?.body).toBeInstanceOf(FormData);
    if (!(init?.body instanceof FormData)) throw new Error('Multipart-Formular fehlt');

    expect(init.body.get('temperature')).toBe('0');
    expect(init.body.get('temperature_inc')).toBe('0');
    expect(init.body.get('language')).toBe('auto');
    expect(init.body.get('translate')).toBe('false');
    expect(init.body.get('response_format')).toBe('json');
    const file = init.body.get('file');
    expect(file).toBeInstanceOf(Blob);
    if (!(file instanceof Blob)) throw new Error('WAV-Datei fehlt');
    expect(file.type).toBe('audio/wav');
    expect(file.size).toBe(wavAudio.length);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array(wavAudio));
    expect('name' in file ? file.name : null).toBe('audio.wav');
  });

  it('normalisiert Unicode, Steuerzeichen und Leerraum und begrenzt das Transkript', async () => {
    const longTranscript = ` \u0000Ａ\t   Satz\n${'x'.repeat(4_200)}`;
    fetchMock.mockResolvedValueOnce(transcriptResponse(longTranscript));
    const client = createClient();

    const result = await client.transcribe(Buffer.from('wav'));

    expect(result.startsWith('A Satz ')).toBe(true);
    expect(result.includes('\u0000')).toBe(false);
    expect(result.includes('\n')).toBe(false);
    expect(result.includes('\t')).toBe(false);
    expect(result).not.toContain('  ');
    expect(result).toHaveLength(4_096);
  });

  it('weist leere und zu große Audiodateien vor jedem Netzwerkzugriff zurück', async () => {
    const client = createClient({ maximumAudioBytes: 4 });

    await expect(client.transcribe(Buffer.alloc(0))).rejects.toThrow('leer');
    await expect(client.transcribe(Buffer.alloc(5))).rejects.toThrow('Größenlimit');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('akzeptiert eine Audiodatei exakt an der konfigurierten Größengrenze', async () => {
    fetchMock.mockResolvedValueOnce(transcriptResponse('Grenzfall'));
    const client = createClient({ maximumAudioBytes: 4 });

    await expect(client.transcribe(Buffer.alloc(4))).resolves.toBe('Grenzfall');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([401, 429, 503])(
    'liefert HTTP %s als inhaltsfreien typisierten Fehler',
    async (status) => {
      fetchMock.mockResolvedValueOnce(new Response('streng vertraulicher Audioinhalt', { status }));
      const client = createClient();

      const request = client.transcribe(Buffer.from('wav'));
      await expect(request).rejects.toMatchObject({ name: 'LocalAsrHttpError', status });
      await expect(Promise.reject(new LocalAsrHttpError(status))).rejects.not.toThrow(
        'streng vertraulicher Audioinhalt',
      );
    },
  );

  it('bricht eine hängende Transkription nach dem Zeitlimit ab', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException('ASR-Zeitlimit', 'TimeoutError')),
        milliseconds,
      );
      return controller.signal;
    });
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error('AbortSignal fehlt'));
            return;
          }
          signal.addEventListener(
            'abort',
            () =>
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error('ASR-Anfrage abgebrochen'),
              ),
            { once: true },
          );
        }),
    );
    const client = createClient({ timeoutMs: 5_000 });

    const request = client.transcribe(Buffer.from('wav'));
    const rejection = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    ['ungültiges JSON', () => new Response('<html>kaputt</html>', { status: 200 })],
    [
      'fehlender Text',
      () =>
        new Response(JSON.stringify({ language: 'de' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ],
    ['leeres normalisiertes Transkript', () => transcriptResponse('\u0000\n\t')],
  ])('verwirft eine fehlerhafte Transkriptionsantwort: %s', async (_label, factory) => {
    fetchMock.mockResolvedValueOnce(factory());
    const client = createClient();

    await expect(client.transcribe(Buffer.from('wav'))).rejects.toBeInstanceOf(Error);
  });

  it('verwirft eine laut Content-Length übergroße Antwort', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ text: 'kurz' }), {
        status: 200,
        headers: { 'content-length': String(256 * 1_024 + 1) },
      }),
    );
    const client = createClient();

    await expect(client.transcribe(Buffer.from('wav'))).rejects.toThrow('zu groß');
  });

  it('bricht eine chunked Antwort ohne Content-Length oberhalb von 256 KiB ab', async () => {
    const response = chunkedResponse(256 * 1_024 + 1, 3_333);
    expect(response.headers.has('content-length')).toBe(false);
    fetchMock.mockResolvedValueOnce(response);
    const client = createClient();

    await expect(client.transcribe(Buffer.from('wav'))).rejects.toThrow('zu groß');
  });
});
