import type { Context } from 'grammy';
import { InternalRole } from '../generated/prisma/enums.js';
import type { Database } from '../database/client.js';
import { UserFacingError } from '../utils/errors.js';
import type { RedisClient } from './redis.js';

const ROLE_RANK: Readonly<Record<InternalRole, number>> = {
  MEMBER: 0,
  TRUSTED: 1,
  MODERATOR: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function hasMinimumRole(actual: InternalRole, required: InternalRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

export class PermissionService {
  public constructor(
    private readonly database: Database,
    private readonly ownerTelegramId: bigint,
    private readonly redis: RedisClient,
  ) {}

  public async roleFor(ctx: Context, groupId: string, telegramId: bigint): Promise<InternalRole> {
    if (telegramId === this.ownerTelegramId) return InternalRole.OWNER;
    if (!ctx.chat) return InternalRole.MEMBER;
    const cacheKey = `role:${groupId}:${telegramId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached && Object.values(InternalRole).includes(cached as InternalRole)) {
      return cached as InternalRole;
    }
    const telegramMember = await ctx.api.getChatMember(ctx.chat.id, Number(telegramId));
    if (telegramMember.status === 'creator') {
      await this.redis.set(cacheKey, InternalRole.OWNER, 'EX', 60);
      return InternalRole.OWNER;
    }
    if (telegramMember.status === 'administrator') {
      await this.redis.set(cacheKey, InternalRole.ADMIN, 'EX', 60);
      return InternalRole.ADMIN;
    }
    const member = await this.database.groupMember.findFirst({
      where: { groupId, user: { telegramId }, deletedAt: null },
      select: { role: true },
    });
    const role = member?.role ?? InternalRole.MEMBER;
    await this.redis.set(cacheKey, role, 'EX', 60);
    return role;
  }

  public async requireModerator(ctx: Context, groupId: string): Promise<void> {
    if (!ctx.from) throw new UserFacingError('error_moderator_only');
    const role = await this.roleFor(ctx, groupId, BigInt(ctx.from.id));
    if (!hasMinimumRole(role, InternalRole.MODERATOR)) {
      throw new UserFacingError('error_moderator_only');
    }
  }

  public async requireAdmin(ctx: Context, groupId: string): Promise<void> {
    if (!ctx.from) throw new UserFacingError('error_admin_only');
    const role = await this.roleFor(ctx, groupId, BigInt(ctx.from.id));
    if (!hasMinimumRole(role, InternalRole.ADMIN)) throw new UserFacingError('error_admin_only');
  }

  public async requireBotRestrictionRights(ctx: Context): Promise<void> {
    if (!ctx.chat) throw new UserFacingError('error_group_only');
    const me = await ctx.api.getMe();
    const botMember = await ctx.api.getChatMember(ctx.chat.id, me.id);
    if (botMember.status !== 'administrator' || !botMember.can_restrict_members) {
      throw new UserFacingError('error_bot_permissions');
    }
  }

  public async requireBotInviteRights(ctx: Context): Promise<void> {
    if (!ctx.chat) throw new UserFacingError('error_group_only');
    const me = await ctx.api.getMe();
    const botMember = await ctx.api.getChatMember(ctx.chat.id, me.id);
    if (botMember.status !== 'administrator' || !botMember.can_invite_users) {
      throw new UserFacingError('error_bot_invite_permissions');
    }
  }

  public async requireUnprotectedTarget(ctx: Context, telegramId: bigint): Promise<void> {
    if (!ctx.chat) throw new UserFacingError('error_group_only');
    const member = await ctx.api.getChatMember(ctx.chat.id, Number(telegramId));
    if (member.status === 'administrator' || member.status === 'creator') {
      throw new UserFacingError('error_protected_target');
    }
  }
}
