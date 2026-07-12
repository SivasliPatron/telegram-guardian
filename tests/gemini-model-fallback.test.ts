import { describe, expect, it, vi } from 'vitest';
import { parseGeminiModelCandidates } from '../src/config/ai-models.js';
import {
  GeminiModelFallback,
  geminiErrorStatus,
  geminiRetryDelayMilliseconds,
  isGeminiModelFallbackError,
} from '../src/services/gemini-model-fallback.js';

function apiError(status: number, message = `HTTP ${status}`): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

describe('Gemini-Modellfallback', () => {
  it('bereinigt und dedupliziert die konfigurierte Reihenfolge', () => {
    expect(
      parseGeminiModelCandidates(
        'gemini-3.1-flash-lite',
        ' gemini-3.5-flash,gemini-3.1-flash-lite,,gemini-3.5-flash ',
      ),
    ).toEqual(['gemini-3.1-flash-lite', 'gemini-3.5-flash']);
  });

  it.each([404, 408, 429, 500, 502, 503, 504])(
    'wechselt bei einem behebbaren HTTP-%s-Fehler zum nächsten Modell',
    async (status) => {
      const attempt = vi
        .fn<(model: string) => Promise<string>>()
        .mockRejectedValueOnce(apiError(status))
        .mockResolvedValueOnce('ok');
      const fallback = new GeminiModelFallback(
        ['primary', 'secondary'],
        { warn: vi.fn() } as never,
        () => 1_000,
      );

      await expect(fallback.run('test', attempt)).resolves.toBe('ok');
      expect(attempt.mock.calls.map(([model]) => model)).toEqual(['primary', 'secondary']);
    },
  );

  it.each([400, 401, 403])('wechselt bei HTTP-%s bewusst nicht das Modell', async (status) => {
    const attempt = vi.fn<(model: string) => Promise<string>>().mockRejectedValue(apiError(status));
    const fallback = new GeminiModelFallback(['primary', 'secondary'], { warn: vi.fn() } as never);

    await expect(fallback.run('test', attempt)).rejects.toMatchObject({ status });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('überspringt ein limitiertes Modell bis zum Ende seiner Sperrzeit', async () => {
    let now = 10_000;
    const attempt = vi
      .fn<(model: string) => Promise<string>>()
      .mockRejectedValueOnce(
        apiError(429, 'RESOURCE_EXHAUSTED; Please retry in 2m30s. RetryDelay: "150s"'),
      )
      .mockResolvedValue('ok');
    const fallback = new GeminiModelFallback(
      ['primary', 'secondary'],
      { warn: vi.fn() } as never,
      () => now,
    );

    await expect(fallback.run('first', attempt)).resolves.toBe('ok');
    await expect(fallback.run('second', attempt)).resolves.toBe('ok');
    expect(attempt.mock.calls.map(([model]) => model)).toEqual([
      'primary',
      'secondary',
      'secondary',
    ]);

    now += 151_000;
    await expect(fallback.run('third', attempt)).resolves.toBe('ok');
    expect(attempt.mock.calls.at(-1)?.[0]).toBe('primary');
  });

  it('liest Status und von Google genannte Wartezeit aus dem Fehler', () => {
    const error = apiError(
      429,
      '[429 RESOURCE_EXHAUSTED] Please retry in 1h2m3.5s. {"retryDelay":"3723.5s"}',
    );
    expect(geminiErrorStatus(error)).toBe(429);
    expect(geminiRetryDelayMilliseconds(error)).toBe(3_723_500);
    expect(isGeminiModelFallbackError(error)).toBe(true);
  });

  it('verlängert die Sperrzeit bei wiederholt erschöpftem Tageslimit', async () => {
    let now = 0;
    const attempt = vi.fn((model: string): Promise<string> => {
      if (model === 'primary') return Promise.reject(apiError(429, 'RESOURCE_EXHAUSTED'));
      return Promise.resolve('ok');
    });
    const fallback = new GeminiModelFallback(
      ['primary', 'secondary'],
      { warn: vi.fn() } as never,
      () => now,
    );

    await fallback.run('first', attempt);
    now = 61_000;
    await fallback.run('second', attempt);
    now = 122_000;
    await fallback.run('third', attempt);

    expect(attempt.mock.calls.map(([model]) => model)).toEqual([
      'primary',
      'secondary',
      'primary',
      'secondary',
      'secondary',
    ]);
  });

  it('behandelt typische Netzwerkfehler als vorübergehend', () => {
    expect(
      isGeminiModelFallbackError(Object.assign(new Error('fetch failed'), { code: 'EAI_AGAIN' })),
    ).toBe(true);
  });
});
