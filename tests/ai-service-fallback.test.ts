import type { Logger } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { AiModerationService } from '../src/services/ai-moderation.js';
import type { RedisClient } from '../src/services/redis.js';

const { interactionCreate } = vi.hoisted(() => ({ interactionCreate: vi.fn() }));

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    public readonly interactions = { create: interactionCreate };
  },
}));

function apiError(status: number, message = `HTTP ${status}`): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

function moderationJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    violation: true,
    reviewRecommended: false,
    category: 'insult',
    confidence: 0.9,
    reason: 'Klare persönliche Beleidigung.',
    ...overrides,
  });
}

function requestedModels(): string[] {
  return interactionCreate.mock.calls.map((call) => {
    const request: unknown = call[0];
    if (typeof request !== 'object' || request === null || !('model' in request)) return '';
    return typeof request.model === 'string' ? request.model : '';
  });
}

function createHarness(options: { cacheWriteFails?: boolean } = {}) {
  const redisGet = vi.fn().mockResolvedValue(null);
  const redisSet = options.cacheWriteFails
    ? vi.fn().mockRejectedValue(new Error('Redis offline'))
    : vi.fn().mockResolvedValue('OK');
  const redis = {
    get: redisGet,
    set: redisSet,
  } as unknown as RedisClient;
  const loggerWarn = vi.fn<(bindings: unknown, message: string) => void>();
  const logger = { warn: loggerWarn } as unknown as Logger;
  const env = parseEnv({
    BOT_TOKEN: `123456:${'a'.repeat(35)}`,
    DATABASE_URL: 'postgresql://bot:secret@localhost:5432/bot',
    REDIS_URL: 'redis://localhost:6379',
    OWNER_TELEGRAM_ID: '123456789',
    AI_FILTER_ENABLED: 'true',
    AI_AUDIO_FILTER_ENABLED: 'true',
    AI_NAME_FILTER_ENABLED: 'true',
    GEMINI_API_KEY: 'x'.repeat(32),
    AI_MODEL: 'gemini-3.1-flash-lite',
    AI_FALLBACK_MODELS: 'gemini-3.5-flash,gemini-2.5-flash-lite',
  });
  return { service: new AiModerationService(env, redis, logger), redisSet, loggerWarn };
}

describe('KI-Dienst mit Modellfallback', () => {
  beforeEach(() => {
    interactionCreate.mockReset();
  });

  it('beantwortet /ki mit dem nächsten Modell, wenn das Primärlimit erreicht ist', async () => {
    interactionCreate
      .mockRejectedValueOnce(apiError(429, 'RESOURCE_EXHAUSTED; retryDelay: "60s"'))
      .mockResolvedValueOnce({ output_text: 'Fallback-Antwort' });
    const { service } = createHarness();

    await expect(service.answerQuestion('Wie geht es dir?')).resolves.toBe('Fallback-Antwort');
    expect(requestedModels()).toEqual(['gemini-3.1-flash-lite', 'gemini-3.5-flash']);
  });

  it('verwendet den Fallback für Textmoderation und speichert genau das gültige Ergebnis', async () => {
    interactionCreate
      .mockRejectedValueOnce(apiError(429, 'RESOURCE_EXHAUSTED'))
      .mockResolvedValueOnce({ output_text: moderationJson() });
    const { service, redisSet } = createHarness();

    await expect(service.classify('Eindeutige Testbeleidigung')).resolves.toMatchObject({
      violation: true,
      category: 'insult',
    });
    expect(requestedModels()).toEqual(['gemini-3.1-flash-lite', 'gemini-3.5-flash']);
    expect(redisSet).toHaveBeenCalledTimes(1);
  });

  it('verwendet den Fallback auch für Audio und sichtbare Namen', async () => {
    interactionCreate
      .mockRejectedValueOnce(apiError(503, 'UNAVAILABLE'))
      .mockResolvedValueOnce({ output_text: moderationJson() });
    const audioHarness = createHarness();
    await expect(audioHarness.service.classifyAudio(Buffer.from('wav'))).resolves.toMatchObject({
      category: 'insult',
    });
    expect(requestedModels()).toEqual(['gemini-3.1-flash-lite', 'gemini-3.5-flash']);

    interactionCreate.mockReset();
    interactionCreate
      .mockRejectedValueOnce(apiError(404, 'model not found'))
      .mockResolvedValueOnce({
        output_text: JSON.stringify({
          violation: true,
          category: 'insult',
          confidence: 0.9,
          reason: 'Beleidigender sichtbarer Name.',
        }),
      });
    const nameHarness = createHarness();
    await expect(nameHarness.service.classifyDisplayName('Testname')).resolves.toMatchObject({
      category: 'insult',
    });
    expect(requestedModels()).toEqual(['gemini-3.1-flash-lite', 'gemini-3.5-flash']);
  });

  it('probiert bei einem ungültigen API-Schlüssel keine weiteren Modelle', async () => {
    interactionCreate.mockRejectedValue(apiError(401, 'UNAUTHENTICATED'));
    const { service } = createHarness();

    await expect(service.answerQuestion('Testfrage')).resolves.toBeNull();
    expect(interactionCreate).toHaveBeenCalledTimes(1);
  });

  it('verwirft ein gültiges KI-Ergebnis nicht, wenn nur Redis ausfällt', async () => {
    interactionCreate.mockResolvedValueOnce({ output_text: moderationJson() });
    const { service, loggerWarn } = createHarness({ cacheWriteFails: true });

    await expect(service.classify('Testbeleidigung')).resolves.toMatchObject({ violation: true });
    const [bindings, message] = loggerWarn.mock.calls.at(-1) ?? [];
    expect(message).toBe('KI-Cache konnte nicht geschrieben werden');
    expect(bindings).toBeTypeOf('object');
    if (typeof bindings !== 'object' || bindings === null || !('cacheKey' in bindings)) {
      throw new Error('Cache-Key fehlt im Warnprotokoll');
    }
    expect(typeof bindings.cacheKey).toBe('string');
  });
});
