import type { MiddlewareFn } from 'grammy';
import { InternalRole } from '../generated/prisma/enums.js';
import type { BotContext } from '../types/context.js';
import type { Dependencies } from '../types/dependencies.js';
import type { RedisClient } from '../services/redis.js';
import { translate } from '../locales/index.js';

const MEMBER_COMMAND_ALLOWANCE = 3;
const MEMBER_COMMAND_COOLDOWN_SECONDS = 15 * 60;
const MEMBER_COMMAND_LIMIT_SCRIPT = `
local cooldownTtl = redis.call('TTL', KEYS[2])
if cooldownTtl > 0 then
  return {0, cooldownTtl}
end

local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
if count >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  redis.call('SET', KEYS[2], '1', 'EX', ARGV[1])
end
return {1, count}
`;

interface ParsedCommand {
  name: string;
  botUsername?: string;
}

function parseCommand(text: string): ParsedCommand | null {
  const match = /^\/([a-z][a-z0-9_]{0,31})(?:@([a-z][a-z0-9_]{4,31}))?(?:\s|$)/iu.exec(text);
  if (!match?.[1]) return null;
  return {
    name: match[1].toLocaleLowerCase(),
    ...(match[2] ? { botUsername: match[2].toLocaleLowerCase() } : {}),
  };
}

function commandBelongsToThisBot(ctx: BotContext, command: ParsedCommand): boolean {
  if (!command.botUsername) return true;
  return command.botUsername === ctx.me.username.toLocaleLowerCase();
}

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
    const command = parseCommand(ctx.message?.text ?? '');
    if (!command || !ctx.from || command.name === 'ki' || !commandBelongsToThisBot(ctx, command)) {
      await next();
      return;
    }
    const key = `command-rate:${ctx.chat?.id ?? 0}:${ctx.from.id}`;
    const accepted = await redis.set(key, '1', 'EX', 2, 'NX');
    if (accepted === 'OK') await next();
  };
}

type CommandCooldownDependencies = Pick<Dependencies, 'permissions' | 'redis'>;

export function memberCommandCooldown(
  dependencies: CommandCooldownDependencies,
): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const command = parseCommand(ctx.message?.text ?? '');
    if (
      !command ||
      command.name === 'ki' ||
      !ctx.from ||
      !ctx.group ||
      !commandBelongsToThisBot(ctx, command)
    ) {
      await next();
      return;
    }

    const role = await dependencies.permissions.roleFor(ctx, ctx.group.id, BigInt(ctx.from.id));
    if (role !== InternalRole.MEMBER) {
      await next();
      return;
    }

    const result = (await dependencies.redis.eval(
      MEMBER_COMMAND_LIMIT_SCRIPT,
      2,
      `member-command-count:v1:${ctx.group.id}:${ctx.from.id}`,
      `member-command-cooldown:v1:${ctx.group.id}:${ctx.from.id}`,
      MEMBER_COMMAND_COOLDOWN_SECONDS,
      MEMBER_COMMAND_ALLOWANCE,
    )) as [number | string, number | string];
    const allowed = Number(result[0]) === 1;
    if (allowed) {
      await next();
      return;
    }

    const remainingMinutes = Math.max(1, Math.ceil(Number(result[1]) / 60));
    const duration = `${remainingMinutes} ${remainingMinutes === 1 ? 'Minute' : 'Minuten'}`;
    await ctx.reply(translate(ctx.locale, 'member_command_cooldown', { duration }));
  };
}
