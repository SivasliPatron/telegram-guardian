import { describe, expect, it, vi } from 'vitest';
import { deduplicateUpdates } from '../src/middleware/security.js';
import type { BotContext } from '../src/types/context.js';
import type { RedisClient } from '../src/services/redis.js';

function context(updateId: number): BotContext {
  return { update: { update_id: updateId } } as BotContext;
}

describe('Update-Deduplizierung', () => {
  it('entfernt den Deduplizierungsschlüssel, wenn die Verarbeitung fehlschlägt', async () => {
    const del = vi.fn().mockResolvedValue(1);
    const redis = {
      set: vi.fn().mockResolvedValue('OK'),
      del,
    } as unknown as RedisClient;
    const next = vi.fn().mockRejectedValue(new Error('PostgreSQL nicht erreichbar'));

    await expect(deduplicateUpdates(redis)(context(123), next)).rejects.toThrow(
      'PostgreSQL nicht erreichbar',
    );

    expect(del).toHaveBeenCalledWith('update:123');
  });

  it('behält den Schlüssel nach erfolgreicher Verarbeitung und ignoriert Duplikate', async () => {
    const del = vi.fn().mockResolvedValue(1);
    const redis = {
      set: vi.fn().mockResolvedValueOnce('OK').mockResolvedValueOnce(null),
      del,
    } as unknown as RedisClient;
    const next = vi.fn().mockResolvedValue(undefined);
    const middleware = deduplicateUpdates(redis);

    await middleware(context(456), next);
    await middleware(context(456), next);

    expect(next).toHaveBeenCalledOnce();
    expect(del).not.toHaveBeenCalled();
  });
});
