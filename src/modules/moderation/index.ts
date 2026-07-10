import type { Dependencies } from '../../types/dependencies.js';
import { commandArguments, escapeHtml } from '../../utils/telegram.js';
import { UserFacingError } from '../../utils/errors.js';
import { formatDuration, parseDuration } from '../../utils/duration.js';
import { translate } from '../../locales/index.js';
import { ensureUser, findOrCreateUserByTelegramId } from '../../database/repositories.js';
import { ModerationActionType } from '../../generated/prisma/enums.js';
import { ModerationService } from './service.js';
import type { BotContext } from '../../types/context.js';

export function shouldApplyWarningMute(warningCount: number, maximumWarnings: number): boolean {
  return maximumWarnings > 0 && warningCount >= maximumWarnings;
}

export function registerModerationModule(dependencies: Dependencies): ModerationService {
  const service = new ModerationService(dependencies);

  dependencies.bot.command('warn', async (ctx) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireModerator(ctx, ctx.group.id);
    const target = await dependencies.targets.resolve(ctx, commandArguments(ctx), ctx.group.id);
    if (!target) throw new UserFacingError('error_target');
    await dependencies.permissions.requireUnprotectedTarget(ctx, target.telegramId);
    const reason = target.remainingArguments.join(' ');
    if (!reason) throw new UserFacingError('error_reason');
    const [user, moderator, settings] = await Promise.all([
      findOrCreateUserByTelegramId(dependencies.database, target.telegramId),
      ensureUser(dependencies.database, ctx.from),
      dependencies.settings.get(ctx.group.id),
    ]);
    await dependencies.database.warning.create({
      data: {
        groupId: ctx.group.id,
        userId: user.id,
        moderatorId: moderator.id,
        reason,
        ...(target.messageId ? { originalMessageId: target.messageId } : {}),
      },
    });
    const count = await dependencies.database.warning.count({
      where: { groupId: ctx.group.id, userId: user.id, clearedAt: null, deletedAt: null },
    });
    await ctx.reply(
      translate(ctx.locale, 'warning_added', {
        user: escapeHtml(user.firstName),
        count,
        max: settings.maxWarnings,
        reason: escapeHtml(reason),
      }),
      { parse_mode: 'HTML' },
    );
    await dependencies.adminLog.send(ctx.group.id, 'Verwarnung', {
      Nutzer: target.telegramId.toString(),
      Moderator: ctx.from.id,
      Grund: reason,
      Anzahl: count,
    });
    if (shouldApplyWarningMute(count, settings.maxWarnings)) {
      await service.mute(
        ctx,
        target.telegramId,
        settings.warningMuteDurationSec,
        `Automatisch nach ${count} Verwarnungen`,
      );
    }
  });

  dependencies.bot.command('warnings', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    const target =
      (await dependencies.targets.resolve(ctx, commandArguments(ctx), ctx.group.id)) ??
      (ctx.from ? { telegramId: BigInt(ctx.from.id), remainingArguments: [] } : null);
    if (!target) throw new UserFacingError('error_target');
    const user = await findOrCreateUserByTelegramId(dependencies.database, target.telegramId);
    const warnings = await dependencies.database.warning.findMany({
      where: { groupId: ctx.group.id, userId: user.id, clearedAt: null, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    if (warnings.length === 0) {
      await ctx.reply(translate(ctx.locale, 'no_warnings'));
      return;
    }
    const details = warnings.map(
      (warning, index) =>
        `${index + 1}. ${escapeHtml(warning.reason)} (${warning.createdAt.toLocaleDateString('de-DE')})`,
    );
    await ctx.reply(
      `${translate(ctx.locale, 'warnings_title', { user: escapeHtml(user.firstName), count: warnings.length })}\n${details.join('\n')}`,
      { parse_mode: 'HTML' },
    );
  });

  const clearWarning = async (ctx: BotContext, all: boolean) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    if (all) await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    else await dependencies.permissions.requireModerator(ctx, ctx.group.id);
    const target = await dependencies.targets.resolve(ctx, commandArguments(ctx), ctx.group.id);
    if (!target) throw new UserFacingError('error_target');
    const user = await findOrCreateUserByTelegramId(dependencies.database, target.telegramId);
    if (all) {
      await dependencies.database.warning.updateMany({
        where: { groupId: ctx.group.id, userId: user.id, clearedAt: null, deletedAt: null },
        data: { clearedAt: new Date() },
      });
    } else {
      const latest = await dependencies.database.warning.findFirst({
        where: { groupId: ctx.group.id, userId: user.id, clearedAt: null, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (!latest) throw new UserFacingError('no_warnings');
      await dependencies.database.warning.update({
        where: { id: latest.id },
        data: { clearedAt: new Date() },
      });
    }
    const moderator = await ensureUser(dependencies.database, ctx.from);
    await dependencies.database.moderationAction.create({
      data: {
        groupId: ctx.group.id,
        targetUserId: user.id,
        moderatorId: moderator.id,
        type: all ? ModerationActionType.CLEAR_WARNINGS : ModerationActionType.UNWARN,
      },
    });
    await ctx.reply(translate(ctx.locale, all ? 'warnings_cleared' : 'warning_removed'));
  };
  dependencies.bot.command('unwarn', (ctx) => clearWarning(ctx, false));
  dependencies.bot.command('clearwarnings', (ctx) => clearWarning(ctx, true));

  const handleMute = async (ctx: BotContext, temporary: boolean) => {
    const argumentsList = commandArguments(ctx);
    if (!ctx.group) throw new UserFacingError('error_group_only');
    const target = await dependencies.targets.resolve(ctx, argumentsList, ctx.group.id);
    if (!target) throw new UserFacingError('error_target');
    const duration = temporary ? parseDuration(target.remainingArguments[0] ?? '') : null;
    if (temporary && !duration) throw new UserFacingError('error_duration');
    const reason = target.remainingArguments.slice(temporary ? 1 : 0).join(' ');
    if (!reason) throw new UserFacingError('error_reason');
    await service.mute(ctx, target.telegramId, duration, reason);
    await ctx.reply(
      translate(ctx.locale, 'muted', {
        user: target.telegramId.toString(),
        duration: duration ? formatDuration(duration) : 'dauerhaft',
        reason: escapeHtml(reason),
      }),
      { parse_mode: 'HTML' },
    );
  };
  dependencies.bot.command('mute', (ctx) => handleMute(ctx, false));
  dependencies.bot.command('tmute', (ctx) => handleMute(ctx, true));

  dependencies.bot.command('unmute', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    const target = await dependencies.targets.resolve(ctx, commandArguments(ctx), ctx.group.id);
    if (!target) throw new UserFacingError('error_target');
    await service.unmute(ctx, target.telegramId);
    await ctx.reply(translate(ctx.locale, 'unmuted', { user: target.telegramId.toString() }));
  });

  const handleBan = async (ctx: BotContext, temporary: boolean) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    const target = await dependencies.targets.resolve(ctx, commandArguments(ctx), ctx.group.id);
    if (!target) throw new UserFacingError('error_target');
    const duration = temporary ? parseDuration(target.remainingArguments[0] ?? '') : null;
    if (temporary && !duration) throw new UserFacingError('error_duration');
    const reason = target.remainingArguments.slice(temporary ? 1 : 0).join(' ');
    if (!reason) throw new UserFacingError('error_reason');
    await service.ban(ctx, target.telegramId, duration, reason);
    await ctx.reply(
      translate(ctx.locale, temporary ? 'temp_banned' : 'banned', {
        user: target.telegramId.toString(),
        duration: duration ? formatDuration(duration) : 'dauerhaft',
        reason: escapeHtml(reason),
      }),
      { parse_mode: 'HTML' },
    );
  };
  dependencies.bot.command('ban', (ctx) => handleBan(ctx, false));
  dependencies.bot.command('tban', (ctx) => handleBan(ctx, true));

  dependencies.bot.command('unban', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    const target = await dependencies.targets.resolve(ctx, commandArguments(ctx), ctx.group.id);
    if (!target) throw new UserFacingError('error_target');
    await service.unban(ctx, target.telegramId);
    await ctx.reply(translate(ctx.locale, 'unbanned', { user: target.telegramId.toString() }));
  });

  dependencies.bot.command('kick', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    const target = await dependencies.targets.resolve(ctx, commandArguments(ctx), ctx.group.id);
    if (!target) throw new UserFacingError('error_target');
    await service.kick(ctx, target.telegramId);
    await ctx.reply(translate(ctx.locale, 'kicked', { user: target.telegramId.toString() }));
  });

  return service;
}
