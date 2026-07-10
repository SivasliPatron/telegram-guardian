import type { BotContext } from '../../types/context.js';
import type { Dependencies } from '../../types/dependencies.js';
import { ModerationActionType } from '../../generated/prisma/enums.js';
import { ensureUser, findOrCreateUserByTelegramId } from '../../database/repositories.js';
import { memberPermissions, mutedPermissions } from './permissions.js';

export class ModerationService {
  public constructor(private readonly dependencies: Dependencies) {}

  public async prepare(ctx: BotContext, telegramId: bigint) {
    if (!ctx.group || !ctx.from) throw new Error('Gruppen- und Benutzerkontext fehlt');
    await this.dependencies.permissions.requireModerator(ctx, ctx.group.id);
    await this.dependencies.permissions.requireBotRestrictionRights(ctx);
    await this.dependencies.permissions.requireUnprotectedTarget(ctx, telegramId);
    const [target, moderator] = await Promise.all([
      findOrCreateUserByTelegramId(this.dependencies.database, telegramId),
      ensureUser(this.dependencies.database, ctx.from),
    ]);
    return { group: ctx.group, target, moderator };
  }

  public async mute(
    ctx: BotContext,
    telegramId: bigint,
    durationSeconds: number | null,
    reason: string,
    actionType: ModerationActionType = ModerationActionType.MUTE,
  ): Promise<void> {
    const { group, target, moderator } = await this.prepare(ctx, telegramId);
    const until = durationSeconds ? new Date(Date.now() + durationSeconds * 1_000) : null;
    await ctx.api.restrictChatMember(
      group.telegramId.toString(),
      Number(telegramId),
      mutedPermissions,
      {
        ...(until ? { until_date: Math.floor(until.getTime() / 1_000) } : {}),
      },
    );
    await this.dependencies.database.$transaction([
      this.dependencies.database.moderationAction.create({
        data: {
          groupId: group.id,
          targetUserId: target.id,
          moderatorId: moderator.id,
          type: actionType,
          reason,
          ...(durationSeconds ? { durationSeconds } : {}),
        },
      }),
      this.dependencies.database.groupMember.upsert({
        where: { groupId_userId: { groupId: group.id, userId: target.id } },
        create: { groupId: group.id, userId: target.id, mutedUntil: until },
        update: { mutedUntil: until },
      }),
    ]);
    await this.dependencies.adminLog.send(group.id, 'Mute', {
      Nutzer: telegramId.toString(),
      Moderator: ctx.from?.id ?? 0,
      Grund: reason,
      Dauer: durationSeconds ?? 'dauerhaft',
    });
  }

  public async unmute(ctx: BotContext, telegramId: bigint): Promise<void> {
    const { group, target, moderator } = await this.prepare(ctx, telegramId);
    await ctx.api.restrictChatMember(
      group.telegramId.toString(),
      Number(telegramId),
      memberPermissions,
    );
    await this.dependencies.database.$transaction([
      this.dependencies.database.moderationAction.create({
        data: {
          groupId: group.id,
          targetUserId: target.id,
          moderatorId: moderator.id,
          type: ModerationActionType.UNMUTE,
        },
      }),
      this.dependencies.database.groupMember.updateMany({
        where: { groupId: group.id, userId: target.id },
        data: { mutedUntil: null },
      }),
    ]);
  }

  public async ban(
    ctx: BotContext,
    telegramId: bigint,
    durationSeconds: number | null,
    reason: string,
  ): Promise<void> {
    const { group, target, moderator } = await this.prepare(ctx, telegramId);
    await ctx.api.banChatMember(group.telegramId.toString(), Number(telegramId), {
      ...(durationSeconds ? { until_date: Math.floor(Date.now() / 1_000) + durationSeconds } : {}),
    });
    await this.dependencies.database.moderationAction.create({
      data: {
        groupId: group.id,
        targetUserId: target.id,
        moderatorId: moderator.id,
        type: ModerationActionType.BAN,
        reason,
        ...(durationSeconds ? { durationSeconds } : {}),
      },
    });
    await this.dependencies.adminLog.send(group.id, 'Ban', {
      Nutzer: telegramId.toString(),
      Moderator: ctx.from?.id ?? 0,
      Grund: reason,
      Dauer: durationSeconds ?? 'dauerhaft',
    });
  }

  public async unban(ctx: BotContext, telegramId: bigint): Promise<void> {
    if (!ctx.group || !ctx.from) throw new Error('Gruppenkontext fehlt');
    await this.dependencies.permissions.requireModerator(ctx, ctx.group.id);
    await this.dependencies.permissions.requireBotRestrictionRights(ctx);
    const target = await findOrCreateUserByTelegramId(this.dependencies.database, telegramId);
    const moderator = await ensureUser(this.dependencies.database, ctx.from);
    await ctx.api.unbanChatMember(ctx.group.telegramId.toString(), Number(telegramId), {
      only_if_banned: true,
    });
    await this.dependencies.database.moderationAction.create({
      data: {
        groupId: ctx.group.id,
        targetUserId: target.id,
        moderatorId: moderator.id,
        type: ModerationActionType.UNBAN,
      },
    });
  }

  public async kick(ctx: BotContext, telegramId: bigint): Promise<void> {
    const { group, target, moderator } = await this.prepare(ctx, telegramId);
    await ctx.api.banChatMember(group.telegramId.toString(), Number(telegramId));
    await ctx.api.unbanChatMember(group.telegramId.toString(), Number(telegramId));
    await this.dependencies.database.moderationAction.create({
      data: {
        groupId: group.id,
        targetUserId: target.id,
        moderatorId: moderator.id,
        type: ModerationActionType.KICK,
      },
    });
  }
}
