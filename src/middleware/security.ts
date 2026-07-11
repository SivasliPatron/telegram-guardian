import type { MiddlewareFn } from 'grammy';
import type { BotContext } from '../types/context.js';
import type { RedisClient } from '../services/redis.js';

export function deduplicateUpdates(redis: RedisClient): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const key = `update:${ctx.update.update_id}`;
    const accepted = await redis.set(key, '1', 'EX', 86_400, 'NX');
    if (accepted !== 'OK') return;
    try {
      await next();
    } catch (error) {
      await redis.del(key).catch(() => undefined);
      throw error;
    }
  };
}

export function commandRateLimit(redis: RedisClient): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    if (!ctx.message?.text?.startsWith('/') || !ctx.from) {
      await next();
      return;
    }
    const key = `command-rate:${ctx.chat?.id ?? 0}:${ctx.from.id}`;
    const accepted = await redis.set(key, '1', 'EX', 2, 'NX');
    if (accepted === 'OK') await next();
  };
}
