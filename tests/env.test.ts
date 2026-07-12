import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';

const validEnvironment = {
  BOT_TOKEN: `123456:${'a'.repeat(35)}`,
  DATABASE_URL: 'postgresql://bot:secret@localhost:5432/bot',
  REDIS_URL: 'redis://localhost:6379',
  OWNER_TELEGRAM_ID: '123456789',
};

describe('Umgebungsvalidierung', () => {
  it('setzt sichere Standardwerte', () => {
    const result = parseEnv(validEnvironment);
    expect(result.DEFAULT_TIMEZONE).toBe('Europe/Berlin');
    expect(result.NODE_ENV).toBe('development');
    expect(result.HEALTH_PORT).toBe(3000);
    expect(result.AI_MODEL).toBe('gemini-3.1-flash-lite');
    expect(result.AI_FALLBACK_MODELS).toContain('gemini-3.5-flash');
  });

  it('weist ungültige Secrets, IDs und Zeitzonen zurück', () => {
    expect(() => parseEnv({ ...validEnvironment, BOT_TOKEN: 'secret' })).toThrow();
    expect(() => parseEnv({ ...validEnvironment, OWNER_TELEGRAM_ID: 'abc' })).toThrow();
    expect(() => parseEnv({ ...validEnvironment, DEFAULT_TIMEZONE: 'Mars/Olympus' })).toThrow();
  });

  it('erlaubt eine leere oder kommagetrennte Modellreserve, aber keine Anzeigenamen', () => {
    expect(parseEnv({ ...validEnvironment, AI_FALLBACK_MODELS: '' }).AI_FALLBACK_MODELS).toBe('');
    expect(
      parseEnv({
        ...validEnvironment,
        AI_FALLBACK_MODELS: 'gemini-3.5-flash, gemini-2.5-flash-lite',
      }).AI_FALLBACK_MODELS,
    ).toBe('gemini-3.5-flash, gemini-2.5-flash-lite');
    expect(() =>
      parseEnv({ ...validEnvironment, AI_FALLBACK_MODELS: 'Gemini 3.5 Flash' }),
    ).toThrow();
  });

  it('akzeptiert einen vollständig lokalen KI-Provider ohne Gemini-Schlüssel', () => {
    const result = parseEnv({
      ...validEnvironment,
      AI_PROVIDER: 'local',
      AI_FILTER_ENABLED: 'true',
      LOCAL_AI_BASE_URL: 'http://local-ai:8080',
      LOCAL_AI_API_KEY: 'l'.repeat(32),
      LOCAL_AI_MODEL: 'qwen3.5-2b',
    });

    expect(result.AI_PROVIDER).toBe('local');
    expect(result.GEMINI_API_KEY).toBeUndefined();
    expect(result.LOCAL_AI_MODEL).toBe('qwen3.5-2b');
    expect(result.LOCAL_AI_TIMEOUT_MS).toBe(8_000);
    expect(result.LOCAL_AI_CHAT_TIMEOUT_MS).toBe(45_000);
    expect(result.LOCAL_AI_MAX_CONCURRENCY).toBe(2);
    expect(result.LOCAL_AI_MAX_QUEUE).toBe(50);
  });

  it('verlangt beim lokalen und hybriden Provider eine URL und ein lokales API-Secret', () => {
    expect(() =>
      parseEnv({
        ...validEnvironment,
        AI_PROVIDER: 'local',
        LOCAL_AI_API_KEY: 'l'.repeat(32),
      }),
    ).toThrow();
    expect(() =>
      parseEnv({
        ...validEnvironment,
        AI_PROVIDER: 'local_gemini_fallback',
        LOCAL_AI_BASE_URL: 'http://local-ai:8080',
        GEMINI_API_KEY: 'g'.repeat(32),
      }),
    ).toThrow();
  });

  it('verlangt für den aktivierten Hybrid-Filter zusätzlich eine Gemini-Notreserve', () => {
    const hybridEnvironment = {
      ...validEnvironment,
      AI_PROVIDER: 'local_gemini_fallback',
      AI_FILTER_ENABLED: 'true',
      LOCAL_AI_BASE_URL: 'http://local-ai:8080',
      LOCAL_AI_API_KEY: 'l'.repeat(32),
    };

    expect(() => parseEnv(hybridEnvironment)).toThrow();
    expect(parseEnv({ ...hybridEnvironment, GEMINI_API_KEY: 'g'.repeat(32) }).AI_PROVIDER).toBe(
      'local_gemini_fallback',
    );
  });

  it('weist unbekannte Provider und unsichere lokale Grenzwerte zurück', () => {
    expect(() => parseEnv({ ...validEnvironment, AI_PROVIDER: 'irgendwas' })).toThrow();
    expect(() =>
      parseEnv({
        ...validEnvironment,
        AI_PROVIDER: 'local',
        LOCAL_AI_BASE_URL: 'keine-url',
        LOCAL_AI_API_KEY: 'l'.repeat(32),
      }),
    ).toThrow();
    expect(() =>
      parseEnv({
        ...validEnvironment,
        AI_PROVIDER: 'local',
        LOCAL_AI_BASE_URL: 'http://local-ai:8080',
        LOCAL_AI_API_KEY: 'zu-kurz',
      }),
    ).toThrow();
    expect(() =>
      parseEnv({
        ...validEnvironment,
        AI_PROVIDER: 'local',
        LOCAL_AI_BASE_URL: 'http://local-ai:8080',
        LOCAL_AI_API_KEY: 'l'.repeat(32),
        LOCAL_AI_MAX_CONCURRENCY: '5',
      }),
    ).toThrow();
  });

  it('verlangt für lokale Audiomoderation einen geschützten ASR-Dienst', () => {
    const localAudioEnvironment = {
      ...validEnvironment,
      AI_PROVIDER: 'local',
      AI_FILTER_ENABLED: 'true',
      AI_AUDIO_FILTER_ENABLED: 'true',
      LOCAL_AI_BASE_URL: 'http://local-ai:8080',
      LOCAL_AI_API_KEY: 'l'.repeat(32),
    };

    expect(() => parseEnv(localAudioEnvironment)).toThrow();
    expect(() =>
      parseEnv({
        ...localAudioEnvironment,
        LOCAL_ASR_BASE_URL: 'http://local-asr:8080',
      }),
    ).toThrow();
    const valid = parseEnv({
      ...localAudioEnvironment,
      LOCAL_ASR_BASE_URL: 'http://local-asr:8080',
      LOCAL_ASR_API_KEY: 'a'.repeat(32),
    });
    expect(valid.LOCAL_ASR_TIMEOUT_MS).toBe(180_000);
  });

  it('verlangt in Produktion für lokale HTTP-Dienste eine ausdrückliche Freigabe', () => {
    const productionLocalEnvironment = {
      ...validEnvironment,
      NODE_ENV: 'production',
      AI_PROVIDER: 'local',
      AI_FILTER_ENABLED: 'true',
      LOCAL_AI_BASE_URL: 'http://local-ai:8080',
      LOCAL_AI_API_KEY: 'l'.repeat(32),
    };

    expect(() => parseEnv(productionLocalEnvironment)).toThrow();
    expect(
      parseEnv({
        ...productionLocalEnvironment,
        LOCAL_SERVICES_ALLOW_INSECURE_HTTP: 'true',
      }).LOCAL_SERVICES_ALLOW_INSECURE_HTTP,
    ).toBe(true);
    expect(
      parseEnv({
        ...productionLocalEnvironment,
        LOCAL_AI_BASE_URL: 'https://local-ai.internal',
      }).LOCAL_SERVICES_ALLOW_INSECURE_HTTP,
    ).toBe(false);
  });

  it('wendet die Produktionsfreigabe ebenfalls auf den lokalen HTTP-ASR-Dienst an', () => {
    const productionAudioEnvironment = {
      ...validEnvironment,
      NODE_ENV: 'production',
      AI_PROVIDER: 'local',
      AI_FILTER_ENABLED: 'true',
      AI_AUDIO_FILTER_ENABLED: 'true',
      LOCAL_AI_BASE_URL: 'https://local-ai.internal',
      LOCAL_AI_API_KEY: 'l'.repeat(32),
      LOCAL_ASR_BASE_URL: 'http://local-asr:8080',
      LOCAL_ASR_API_KEY: 'a'.repeat(32),
    };

    expect(() => parseEnv(productionAudioEnvironment)).toThrow();
    expect(() =>
      parseEnv({
        ...productionAudioEnvironment,
        LOCAL_SERVICES_ALLOW_INSECURE_HTTP: 'true',
      }),
    ).not.toThrow();
  });

  it('akzeptiert verschlüsselte rediss-Verbindungen für Redis beziehungsweise Valkey', () => {
    const result = parseEnv({
      ...validEnvironment,
      REDIS_URL: 'rediss://bot:secret@redis.internal:6380/0',
    });

    expect(result.REDIS_URL).toBe('rediss://bot:secret@redis.internal:6380/0');
  });

  it('behandelt leere optionale Schlüssel aus einer Env-Datei als nicht gesetzt', () => {
    const result = parseEnv({ ...validEnvironment, GEMINI_API_KEY: '' });

    expect(result.GEMINI_API_KEY).toBeUndefined();
  });

  it('erkennt auch eine großgeschriebene HTTP-Adresse als unsicher', () => {
    expect(() =>
      parseEnv({
        ...validEnvironment,
        NODE_ENV: 'production',
        AI_PROVIDER: 'local',
        LOCAL_AI_BASE_URL: 'HTTP://local-ai:8080',
        LOCAL_AI_API_KEY: 'l'.repeat(32),
      }),
    ).toThrow();
  });
});
