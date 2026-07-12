import { describe, expect, it, vi } from 'vitest';
import { InternalRole } from '../src/generated/prisma/enums.js';
import {
  commandRateLimit,
  deduplicateUpdates,
  memberCommandCooldown,
} from '../src/middleware/security.js';
import type { BotContext } from '../src/types/context.js';
import type { Dependencies } from '../src/types/dependencies.js';
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

function commandContext(text: string) {
  const reply = vi.fn().mockResolvedValue({ message_id: 2 });
  const ctx = {
    update: { update_id: 1 },
    message: { text },
    from: { id: 42, is_bot: false, first_name: 'Mitglied' },
    chat: { id: -100123, type: 'supergroup', title: 'Testgruppe' },
    group: { id: 'group-1', telegramId: -100123n, title: 'Testgruppe' },
    locale: 'de',
    me: {
      id: 99,
      is_bot: true,
      first_name: 'Guardian',
      username: 'GuardianBot',
    },
    reply,
  } as unknown as BotContext;
  return { ctx, reply };
}

describe('Befehlslimit für normale Mitglieder', () => {
  it('erlaubt drei Befehle und blockiert danach für 15 Minuten', async () => {
    const redisEval = vi
      .fn()
      .mockResolvedValueOnce([1, 1])
      .mockResolvedValueOnce([1, 2])
      .mockResolvedValueOnce([1, 3])
      .mockResolvedValueOnce([0, 900]);
    const roleFor = vi.fn().mockResolvedValue(InternalRole.MEMBER);
    const redis = {
      eval: redisEval,
    } as unknown as RedisClient;
    const dependencies = {
      redis,
      permissions: { roleFor },
    } as unknown as Pick<Dependencies, 'permissions' | 'redis'>;
    const middleware = memberCommandCooldown(dependencies);
    const next = vi.fn().mockResolvedValue(undefined);
    const contexts = Array.from({ length: 4 }, () => commandContext('/help'));

    for (const { ctx } of contexts) await middleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(3);
    expect(contexts[3]?.reply).toHaveBeenCalledWith(
      '⏳ Du hast bereits drei Befehle benutzt. Warte noch etwa 15 Minuten. /ki kannst du weiterhin benutzen.',
    );
  });

  it('nimmt /ki vollständig vom allgemeinen Befehlslimit aus', async () => {
    const redisSet = vi.fn();
    const redisEval = vi.fn();
    const roleFor = vi.fn();
    const redis = {
      set: redisSet,
      eval: redisEval,
    } as unknown as RedisClient;
    const dependencies = {
      redis,
      permissions: { roleFor },
    } as unknown as Pick<Dependencies, 'permissions' | 'redis'>;
    const { ctx } = commandContext('/ki@GuardianBot Erkläre mir die Regeln');
    const next = vi.fn().mockResolvedValue(undefined);

    await commandRateLimit(redis)(ctx, next);
    await memberCommandCooldown(dependencies)(ctx, next);

    expect(next).toHaveBeenCalledTimes(2);
    expect(redisSet).not.toHaveBeenCalled();
    expect(redisEval).not.toHaveBeenCalled();
    expect(roleFor).not.toHaveBeenCalled();
  });

  it('zählt Befehle für einen zweiten Bot nicht mit', async () => {
    const redisEval = vi.fn();
    const roleFor = vi.fn();
    const redis = { eval: redisEval } as unknown as RedisClient;
    const dependencies = {
      redis,
      permissions: { roleFor },
    } as unknown as Pick<Dependencies, 'permissions' | 'redis'>;
    const next = vi.fn().mockResolvedValue(undefined);

    await memberCommandCooldown(dependencies)(commandContext('/help@AndererBot').ctx, next);

    expect(next).toHaveBeenCalledOnce();
    expect(redisEval).not.toHaveBeenCalled();
    expect(roleFor).not.toHaveBeenCalled();
  });

  it('begrenzt vertrauenswürdige Nutzer, Moderatoren und Admins nicht', async () => {
    const redisEval = vi.fn();
    const roleFor = vi.fn().mockResolvedValue(InternalRole.TRUSTED);
    const redis = { eval: redisEval } as unknown as RedisClient;
    const dependencies = {
      redis,
      permissions: { roleFor },
    } as unknown as Pick<Dependencies, 'permissions' | 'redis'>;
    const next = vi.fn().mockResolvedValue(undefined);

    await memberCommandCooldown(dependencies)(commandContext('/rules').ctx, next);

    expect(next).toHaveBeenCalledOnce();
    expect(redisEval).not.toHaveBeenCalled();
  });
});
