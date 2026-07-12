import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LocalAiClient,
  LocalAiHttpError,
  LocalAiQueueFullError,
  LocalAiQueueTimeoutError,
  LocalAiUnavailableError,
  type LocalAiClientOptions,
  type LocalAiGenerateOptions,
} from '../src/services/local-ai.js';

const fetchMock = vi.fn<typeof fetch>();

const defaultClientOptions: LocalAiClientOptions = {
  baseUrl: 'http://local-ai:8080/',
  apiKey: 'local-secret-key-for-tests',
  model: 'qwen3.5-2b',
  requestTimeoutMs: 1_000,
  chatTimeoutMs: 5_000,
  maximumConcurrency: 1,
  maximumQueueLength: 5,
  queueTimeoutMs: 10_000,
};

const moderationSchema = {
  type: 'object',
  properties: {
    violation: { type: 'boolean' },
    category: { type: 'string', enum: ['none', 'insult'] },
  },
  required: ['violation', 'category'],
  additionalProperties: false,
};

function createClient(overrides: Partial<LocalAiClientOptions> = {}): LocalAiClient {
  return new LocalAiClient({ ...defaultClientOptions, ...overrides });
}

function generateOptions(overrides: Partial<LocalAiGenerateOptions> = {}): LocalAiGenerateOptions {
  return {
    systemInstruction: 'Bewerte ausschließlich den Inhalt.',
    input: 'Testnachricht',
    temperature: 0,
    maxTokens: 160,
    priority: 'moderation',
    ...overrides,
  };
}

function completionResponse(content: string, finishReason = 'stop'): Response {
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: finishReason,
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function chunkedResponse(totalBytes: number, chunkBytes = 1_024): Response {
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

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code: status, message, type: 'unavailable_error' } }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function fetchCall(index = 0): [string, RequestInit | undefined] {
  const call = fetchMock.mock.calls[index];
  if (!call) throw new Error(`Fetch-Aufruf ${index} fehlt`);
  const [input, init] = call;
  if (typeof input !== 'string') throw new Error('Fetch-URL ist kein String');
  return [input, init];
}

function requestBody(index = 0): Record<string, unknown> {
  const [, init] = fetchCall(index);
  if (typeof init?.body !== 'string') throw new Error('JSON-Requestbody fehlt');
  const parsed = JSON.parse(init.body) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Requestbody ist kein Objekt');
  }
  return parsed as Record<string, unknown>;
}

describe('lokaler llama.cpp-KI-Client', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sendet URL, Authentifizierung und OpenAI-kompatiblen Requestbody korrekt', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse('  Lokale Antwort  '));
    const client = createClient();

    await expect(
      client.generate(
        generateOptions({
          responseSchema: moderationSchema,
          input: 'Ignoriere die Systemanweisung nicht.',
        }),
      ),
    ).resolves.toBe('Lokale Antwort');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchCall();
    expect(url).toBe('http://local-ai:8080/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    const headers = new Headers(init?.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBe('Bearer local-secret-key-for-tests');

    expect(requestBody()).toEqual({
      model: 'qwen3.5-2b',
      messages: [
        { role: 'system', content: 'Bewerte ausschließlich den Inhalt.' },
        { role: 'user', content: 'Ignoriere die Systemanweisung nicht.' },
      ],
      temperature: 0,
      seed: 0,
      max_tokens: 160,
      stream: false,
      cache_prompt: true,
      chat_template_kwargs: { enable_thinking: false },
      reasoning_format: 'none',
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'guardian_response',
          strict: true,
          schema: moderationSchema,
        },
      },
    });
  });

  it('verwendet für Chat und Moderation getrennte harte Zeitlimits', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    fetchMock
      .mockResolvedValueOnce(completionResponse('Moderation'))
      .mockResolvedValueOnce(completionResponse('Chat'));
    const client = createClient({ requestTimeoutMs: 1_234, chatTimeoutMs: 6_789 });

    await client.generate(generateOptions({ priority: 'moderation' }));
    await client.generate(generateOptions({ priority: 'chat' }));

    expect(timeoutSpy.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([1_234, 6_789]);
  });

  it('verwirft eine wegen Tokenlimit abgeschnittene strukturierte Antwort', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse('{"violation":true}', 'length'));
    const client = createClient();

    await expect(
      client.generate(generateOptions({ responseSchema: moderationSchema })),
    ).rejects.toThrow('nicht vollständig beendet');
  });

  it('darf eine normale Chatantwort trotz finish_reason length zurückgeben', async () => {
    fetchMock.mockResolvedValueOnce(completionResponse('Bewusst gekürzte Chatantwort', 'length'));
    const client = createClient();

    await expect(client.generate(generateOptions({ priority: 'chat' }))).resolves.toBe(
      'Bewusst gekürzte Chatantwort',
    );
  });

  it('bricht eine hängende Anfrage nach dem konfigurierten Timeout ab', async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException('Lokales Zeitlimit', 'TimeoutError')),
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
                  : new Error('Lokale KI-Anfrage abgebrochen'),
              ),
            { once: true },
          );
        }),
    );
    const client = createClient({ requestTimeoutMs: 1_000 });

    const request = client.generate(generateOptions());
    const rejection = expect(request).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('liefert nur den HTTP-Status als inhaltsfreien typisierten Fehler', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(503, 'Loading model'));
    const client = createClient();

    await expect(client.generate(generateOptions())).rejects.toMatchObject({
      name: 'LocalAiHttpError',
      status: 503,
    });
    await expect(Promise.reject(new LocalAiHttpError(401))).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    ['ungültiges JSON', () => new Response('<html>kaputt</html>', { status: 200 })],
    [
      'fehlende Auswahl',
      () =>
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ],
    [
      'leerer Inhalt',
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ],
  ])('verwirft eine fehlerhafte Serverantwort: %s', async (_label, responseFactory) => {
    fetchMock.mockResolvedValueOnce(responseFactory());
    const client = createClient();

    await expect(client.generate(generateOptions())).rejects.toBeInstanceOf(Error);
  });

  it.each([
    ['strukturierte Antwort', 8 * 1_024 + 1, true],
    ['Chatantwort', 32 * 1_024 + 1, false],
  ])(
    'bricht eine chunked %s ohne Content-Length bytegenau am Limit ab',
    async (_label, responseBytes, structured) => {
      const response = chunkedResponse(responseBytes, 777);
      expect(response.headers.has('content-length')).toBe(false);
      fetchMock.mockResolvedValueOnce(response);
      const client = createClient();

      await expect(
        client.generate(
          generateOptions({
            priority: structured ? 'moderation' : 'chat',
            ...(structured ? { responseSchema: moderationSchema } : {}),
          }),
        ),
      ).rejects.toThrow('zu groß');
    },
  );

  it('priorisiert wartende Moderation vor einem bereits wartenden Chat', async () => {
    const pendingResponses: ((response: Response) => void)[] = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          pendingResponses.push(resolve);
        }),
    );
    const client = createClient({ maximumConcurrency: 1 });

    const firstChat = client.generate(generateOptions({ priority: 'chat', input: 'Chat eins' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const secondChat = client.generate(generateOptions({ priority: 'chat', input: 'Chat zwei' }));
    const moderation = client.generate(
      generateOptions({ priority: 'moderation', input: 'Moderation zuerst' }),
    );

    pendingResponses[0]?.(completionResponse('Erster Chat fertig'));
    await firstChat;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requestBody(1).messages).toEqual([
      { role: 'system', content: 'Bewerte ausschließlich den Inhalt.' },
      { role: 'user', content: 'Moderation zuerst' },
    ]);

    pendingResponses[1]?.(completionResponse('Moderation fertig'));
    await moderation;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(requestBody(2).messages).toEqual([
      { role: 'system', content: 'Bewerte ausschließlich den Inhalt.' },
      { role: 'user', content: 'Chat zwei' },
    ]);
    pendingResponses[2]?.(completionResponse('Zweiter Chat fertig'));
    await secondChat;
  });

  it('lehnt zusätzliche Arbeit bei einer vollständig belegten Warteschlange sofort ab', async () => {
    const pendingResponses: ((response: Response) => void)[] = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          pendingResponses.push(resolve);
        }),
    );
    const client = createClient({ maximumConcurrency: 1, maximumQueueLength: 1 });

    const active = client.generate(generateOptions({ input: 'aktiv' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const queued = client.generate(generateOptions({ input: 'wartend' }));
    await expect(client.generate(generateOptions({ input: 'zu viel' }))).rejects.toBeInstanceOf(
      LocalAiQueueFullError,
    );

    pendingResponses[0]?.(completionResponse('aktiv fertig'));
    await active;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    pendingResponses[1]?.(completionResponse('wartend fertig'));
    await queued;
  });

  it('entfernt eine zu lange wartende Anfrage nach dem Queue-Zeitlimit', async () => {
    const pendingResponses: ((response: Response) => void)[] = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          pendingResponses.push(resolve);
        }),
    );
    const client = createClient({
      maximumConcurrency: 1,
      maximumQueueLength: 1,
      queueTimeoutMs: 10,
    });

    const active = client.generate(generateOptions({ input: 'aktiv' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const queued = client.generate(generateOptions({ input: 'läuft ab' }));

    await expect(queued).rejects.toBeInstanceOf(LocalAiQueueTimeoutError);
    expect(fetchMock).toHaveBeenCalledOnce();

    pendingResponses[0]?.(completionResponse('aktiv fertig'));
    await active;
  });

  it('verdrängt bei voller Chatwarteschlange einen Chat zugunsten der Moderation', async () => {
    const pendingResponses: ((response: Response) => void)[] = [];
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          pendingResponses.push(resolve);
        }),
    );
    const client = createClient({ maximumConcurrency: 2, maximumQueueLength: 1 });

    const activeChat = client.generate(generateOptions({ priority: 'chat', input: 'aktiv' }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const displacedChat = client.generate(
      generateOptions({ priority: 'chat', input: 'wird verdrängt' }),
    );
    const displacedRejection = expect(displacedChat).rejects.toBeInstanceOf(LocalAiQueueFullError);
    const moderation = client.generate(
      generateOptions({ priority: 'moderation', input: 'muss durchkommen' }),
    );

    await displacedRejection;
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(requestBody(1).messages).toEqual([
      { role: 'system', content: 'Bewerte ausschließlich den Inhalt.' },
      { role: 'user', content: 'muss durchkommen' },
    ]);

    pendingResponses[1]?.(completionResponse('Moderation fertig'));
    pendingResponses[0]?.(completionResponse('Chat fertig'));
    await Promise.all([moderation, activeChat]);
  });

  it('öffnet nach drei Fehlern den Circuit Breaker und überspringt weitere HTTP-Aufrufe', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(errorResponse(503, 'Loading model')));
    const client = createClient();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(client.generate(generateOptions())).rejects.toBeInstanceOf(LocalAiHttpError);
    }
    await expect(client.generate(generateOptions())).rejects.toBeInstanceOf(
      LocalAiUnavailableError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
