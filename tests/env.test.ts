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
});
