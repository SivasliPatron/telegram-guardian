import type { Context } from 'grammy';
import type { Database } from '../database/client.js';
import type { RedisClient } from './redis.js';
import { resolveTarget, type TargetReference } from '../utils/telegram.js';

const USERNAME_PATTERN = /^@([a-z][a-z0-9_]{4,31})$/iu;
const USERNAME_CACHE_SECONDS = 30 * 24 * 60 * 60;

export class TargetResolver {
  public constructor(
    private readonly database: Database,
    private readonly redis: RedisClient,
  ) {}

  public async resolve(
    ctx: Context,
    argumentsList: string[],
    groupId: string,
  ): Promise<TargetReference | null> {
    const directTarget = resolveTarget(ctx, argumentsList);
    if (directTarget) return directTarget;

    const mentionedUser = ctx.message?.entities?.find(
      (entity) => entity.type === 'text_mention',
    )?.user;
    if (mentionedUser) {
      return {
        telegramId: BigInt(mentionedUser.id),
        remainingArguments: argumentsList.slice(1),
      };
    }

    const match = USERNAME_PATTERN.exec(argumentsList[0] ?? '');
    const username = match?.[1]?.toLocaleLowerCase();
    if (!username) return null;

    const cachedTelegramId = await this.redis.get(this.usernameKey(groupId, username));
    if (cachedTelegramId && /^\d+$/u.test(cachedTelegramId)) {
      return {
        telegramId: BigInt(cachedTelegramId),
        remainingArguments: argumentsList.slice(1),
      };
    }

    const member = await this.database.groupMember.findFirst({
      where: {
        groupId,
        deletedAt: null,
        user: { username: { equals: username, mode: 'insensitive' } },
      },
      select: { user: { select: { telegramId: true } } },
      orderBy: { lastSeenAt: 'desc' },
    });
    if (!member) return null;

    await this.redis.set(
      this.usernameKey(groupId, username),
      member.user.telegramId.toString(),
      'EX',
      USERNAME_CACHE_SECONDS,
    );
    return {
      telegramId: member.user.telegramId,
      remainingArguments: argumentsList.slice(1),
    };
  }

  public async remember(groupId: string, telegramId: number, username: string): Promise<void> {
    const normalizedUsername = username.toLocaleLowerCase();
    const reverseKey = `username-by-id:${groupId}:${telegramId}`;
    const previousUsername = await this.redis.get(reverseKey);
    const pipeline = this.redis.pipeline();
    if (previousUsername && previousUsername !== normalizedUsername) {
      pipeline.del(this.usernameKey(groupId, previousUsername));
    }
    pipeline.set(
      this.usernameKey(groupId, normalizedUsername),
      String(telegramId),
      'EX',
      USERNAME_CACHE_SECONDS,
    );
    pipeline.set(reverseKey, normalizedUsername, 'EX', USERNAME_CACHE_SECONDS);
    await pipeline.exec();
  }

  private usernameKey(groupId: string, username: string): string {
    return `username:${groupId}:${username}`;
  }
}
