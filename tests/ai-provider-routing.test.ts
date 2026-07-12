import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { AiModerationService } from '../src/services/ai-moderation.js';
import type { RedisClient } from '../src/services/redis.js';

const { interactionCreate } = vi.hoisted(() => ({ interactionCreate: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    public readonly interactions = { create: interactionCreate };
  },
}));

const fetchMock = vi.fn<typeof fetch>();

function localCompletion(content: string, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function moderationJson(): string {
  return JSON.stringify({
    violation: true,
    reviewRecommended: false,
    category: 'insult',
    confidence: 0.91,
    reason: 'Klare persönliche Beleidigung.',
  });
}

function nameJson(): string {
  return JSON.stringify({
    violation: true,
    category: 'insult',
    confidence: 0.9,
    reason: 'Beleidigender sichtbarer Name.',
  });
}

function createHarness(
  provider: 'local' | 'local_gemini_fallback',
  options: { audio?: boolean } = {},
) {
  const redisSet = vi.fn().mockResolvedValue('OK');
  const redis = {
    get: vi.fn().mockResolvedValue(null),
    set: redisSet,
  } as unknown as RedisClient;
  const loggerWarn = vi.fn<(bindings: unknown, message: string) => void>();
  const logger = { warn: loggerWarn } as unknown as Logger;
  const env = parseEnv({
    BOT_TOKEN: `123456:${'a'.repeat(35)}`,
    DATABASE_URL: 'postgresql://bot:secret@localhost:5432/bot',
    REDIS_URL: 'redis://localhost:6379',
    OWNER_TELEGRAM_ID: '123456789',
    AI_PROVIDER: provider,
    AI_FILTER_ENABLED: 'true',
    AI_AUDIO_FILTER_ENABLED: options.audio ? 'true' : 'false',
    AI_NAME_FILTER_ENABLED: 'true',
    LOCAL_AI_BASE_URL: 'http://local-ai:8080',
    LOCAL_AI_API_KEY: 'l'.repeat(32),
    LOCAL_AI_MODEL: 'qwen3.5-2b',
    GEMINI_API_KEY: 'g'.repeat(32),
    ...(options.audio
      ? {
          LOCAL_ASR_BASE_URL: 'http://local-asr:8080',
          LOCAL_ASR_API_KEY: 'a'.repeat(32),
          AI_AUDIO_MAX_BYTES: '100000',
        }
      : {}),
    ...(provider === 'local_gemini_fallback'
      ? {
          AI_MODEL: 'gemini-primary',
          AI_FALLBACK_MODELS: '',
        }
      : {}),
  });
  return {
    loggerWarn,
    redisSet,
    service: new AiModerationService(env, redis, logger),
  };
}

describe('Providerwahl zwischen lokaler KI und Gemini-Notreserve', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    interactionCreate.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('verwendet im local-Modus für Chat, Text und Namen ausschließlich den lokalen Dienst', async () => {
    fetchMock
      .mockResolvedValueOnce(localCompletion('Lokale Chatantwort'))
      .mockResolvedValueOnce(localCompletion(moderationJson()))
      .mockResolvedValueOnce(localCompletion(nameJson()));
    const { service } = createHarness('local');

    await expect(service.answerQuestion('Wie geht es dir?')).resolves.toBe('Lokale Chatantwort');
    await expect(service.classify('Eindeutige Testbeleidigung')).resolves.toMatchObject({
      category: 'insult',
    });
    await expect(service.classifyDisplayName('Testname')).resolves.toMatchObject({
      category: 'insult',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(interactionCreate).not.toHaveBeenCalled();
  });

  it('ruft im Hybridmodus Gemini nicht auf, wenn die lokale Antwort gültig ist', async () => {
    fetchMock.mockResolvedValueOnce(localCompletion(moderationJson()));
    const { service, redisSet } = createHarness('local_gemini_fallback');

    await expect(service.classify('Eindeutige Testbeleidigung')).resolves.toMatchObject({
      violation: true,
      category: 'insult',
    });
    expect(interactionCreate).not.toHaveBeenCalled();
    expect(redisSet).toHaveBeenCalledOnce();
  });

  it('verwendet bei lokalem HTTP-Fehler für /ki genau einmal die Gemini-Notreserve', async () => {
    fetchMock.mockResolvedValueOnce(localCompletion('lokal nicht bereit', 503));
    interactionCreate.mockResolvedValueOnce({ output_text: 'Gemini-Notantwort' });
    const { service, loggerWarn } = createHarness('local_gemini_fallback');

    await expect(service.answerQuestion('Testfrage')).resolves.toBe('Gemini-Notantwort');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(interactionCreate).toHaveBeenCalledOnce();
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'chat' }),
      'Lokale KI fehlgeschlagen; Gemini-Notreserve wird versucht',
    );
  });

  it('sendet bei syntaktisch ungültiger lokaler Moderation keine Daten an Gemini', async () => {
    fetchMock.mockResolvedValueOnce(localCompletion('kein JSON'));
    interactionCreate.mockResolvedValueOnce({ output_text: moderationJson() });
    const { service, redisSet } = createHarness('local_gemini_fallback');

    await expect(service.classify('Eindeutige Testbeleidigung')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(interactionCreate).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
  });

  it.each([
    {
      violation: false,
      reviewRecommended: false,
      category: 'insult',
      confidence: 0.9,
      reason: 'Widerspruch',
    },
    {
      violation: true,
      reviewRecommended: true,
      category: 'insult',
      confidence: 0.9,
      reason: 'Widerspruch',
    },
    {
      violation: true,
      reviewRecommended: false,
      category: 'none',
      confidence: 0.9,
      reason: 'Widerspruch',
    },
  ])('verwirft ein widersprüchliches Moderationsergebnis vollständig: %o', async (result) => {
    fetchMock.mockResolvedValueOnce(localCompletion(JSON.stringify(result)));
    interactionCreate.mockResolvedValueOnce({ output_text: moderationJson() });
    const { service, redisSet } = createHarness('local_gemini_fallback');

    await expect(service.classify('Neuer Prüfsatz')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(interactionCreate).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
  });

  it('sendet bei einem ungültigen lokalen Namensschema keine Daten an Gemini', async () => {
    fetchMock.mockResolvedValueOnce(
      localCompletion(JSON.stringify({ violation: true, category: 'unbekannt' })),
    );
    interactionCreate.mockResolvedValueOnce({ output_text: nameJson() });
    const { service } = createHarness('local_gemini_fallback');

    await expect(service.classifyDisplayName('Testname')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(interactionCreate).not.toHaveBeenCalled();
  });

  it.each([
    {
      violation: false,
      category: 'insult',
      confidence: 0.9,
      reason: 'Widerspruch',
    },
    {
      violation: true,
      category: 'none',
      confidence: 0.9,
      reason: 'Widerspruch',
    },
  ])('verwirft ein widersprüchliches Namensergebnis vollständig: %o', async (result) => {
    fetchMock.mockResolvedValueOnce(localCompletion(JSON.stringify(result)));
    interactionCreate.mockResolvedValueOnce({ output_text: nameJson() });
    const { service, redisSet } = createHarness('local_gemini_fallback');

    await expect(service.classifyDisplayName('Testname')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(interactionCreate).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
  });

  it('verwendet im local-Modus bei einem Ausfall niemals heimlich Gemini', async () => {
    fetchMock.mockResolvedValueOnce(localCompletion('lokal nicht bereit', 503));
    const { service } = createHarness('local');

    await expect(service.answerQuestion('Testfrage')).resolves.toBeNull();
    expect(interactionCreate).not.toHaveBeenCalled();
  });

  it('behält bei vollständigem Hybrid-Ausfall den deterministischen HS-Prüffall', async () => {
    fetchMock.mockResolvedValueOnce(localCompletion('lokal nicht bereit', 503));
    interactionCreate.mockRejectedValueOnce(
      Object.assign(new Error('UNAUTHENTICATED'), { status: 401 }),
    );
    const { service } = createHarness('local_gemini_fallback');

    await expect(
      service.classify('h s Menschen in Afrika haben kein Wasser'),
    ).resolves.toMatchObject({
      reviewRecommended: true,
      category: 'insult',
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(interactionCreate).toHaveBeenCalledOnce();
  });

  it('transkribiert lokales Audio und lässt ausschließlich das Transkript von Qwen bewerten', async () => {
    const wavAudio = Buffer.from('lokale-wav-daten');
    fetchMock.mockImplementation((input) => {
      if (typeof input !== 'string') throw new Error('Unerwartete Fetch-Adresse');
      if (input.endsWith('/inference')) {
        return Promise.resolve(
          new Response(JSON.stringify({ text: '  Gesprochene   Testbeleidigung  ' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      if (input.endsWith('/v1/chat/completions')) {
        return Promise.resolve(localCompletion(moderationJson()));
      }
      throw new Error(`Unerwartete Fetch-Adresse: ${input}`);
    });
    const { service } = createHarness('local', { audio: true });

    await expect(service.classifyAudio(wavAudio)).resolves.toMatchObject({
      violation: true,
      category: 'insult',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(interactionCreate).not.toHaveBeenCalled();
    const localAiCall = fetchMock.mock.calls[1];
    if (!localAiCall || typeof localAiCall[1]?.body !== 'string') {
      throw new Error('Lokaler Qwen-Request fehlt');
    }
    const body = JSON.parse(localAiCall[1].body) as unknown;
    if (typeof body !== 'object' || body === null || !('messages' in body)) {
      throw new Error('Qwen-Request enthält keine Nachrichten');
    }
    const messages = body.messages;
    expect(JSON.stringify(messages)).toContain('Gesprochene Testbeleidigung');
    expect(JSON.stringify(messages)).not.toContain(wavAudio.toString('base64'));
  });

  it('sendet im Hybridmodus bei ASR-Ausfall das ursprüngliche Audio an Gemini', async () => {
    const wavAudio = Buffer.from('fallback-wav-daten');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'ASR nicht bereit' }), { status: 503 }),
    );
    interactionCreate.mockResolvedValueOnce({ output_text: moderationJson() });
    const { service, loggerWarn } = createHarness('local_gemini_fallback', { audio: true });

    await expect(service.classifyAudio(wavAudio)).resolves.toMatchObject({
      category: 'insult',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(interactionCreate).toHaveBeenCalledOnce();
    const geminiCall = interactionCreate.mock.calls[0];
    const request: unknown = geminiCall?.[0];
    if (typeof request !== 'object' || request === null || !('input' in request)) {
      throw new Error('Gemini-Audiorequest fehlt');
    }
    expect(JSON.stringify(request.input)).toContain(wavAudio.toString('base64'));
    expect(JSON.stringify(request.input)).toContain('audio/wav');
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'audio-moderation' }),
      'Lokale KI fehlgeschlagen; Gemini-Notreserve wird versucht',
    );
  });

  it('erlaubt Audio im local-Modus sicher, wenn die Transkription ausfällt', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ASR nicht bereit', { status: 503 }));
    const { service } = createHarness('local', { audio: true });

    await expect(service.classifyAudio(Buffer.from('wav'))).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(interactionCreate).not.toHaveBeenCalled();
  });
});
