import type { MiddlewareFn } from 'grammy';
import type { Dependencies } from '../types/dependencies.js';
import type { BotContext, GroupReference } from '../types/context.js';
import { ensureGroup } from '../database/repositories.js';

export function groupContextMiddleware(dependencies: Dependencies): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) {
      await next();
      return;
    }
    const cacheKey = `group:${ctx.chat.id}`;
    const cached = await dependencies.redis.get(cacheKey);
    let group: GroupReference;
    if (cached) {
      const value = JSON.parse(cached) as { id: string; telegramId: string; title: string };
      group = { ...value, telegramId: BigInt(value.telegramId) };
    } else {
      const stored = await ensureGroup(
        dependencies.database,
        ctx.chat,
        dependencies.env.DEFAULT_TIMEZONE,
      );
      group = { id: stored.id, telegramId: stored.telegramId, title: stored.title };
      await dependencies.redis.set(
        cacheKey,
        JSON.stringify({ ...group, telegramId: group.telegramId.toString() }),
        'EX',
        300,
      );
    }
    ctx.group = group;
    const settings = await dependencies.settings.get(group.id);
    ctx.locale = settings.language;
    if (ctx.from?.username) {
      await dependencies.targets.remember(group.id, ctx.from.id, ctx.from.username);
    }
    await next();
  };
}
