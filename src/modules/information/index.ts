import type { Dependencies } from '../../types/dependencies.js';
import { commandArguments, escapeHtml } from '../../utils/telegram.js';
import { findOrCreateUserByTelegramId } from '../../database/repositories.js';
import { UserFacingError } from '../../utils/errors.js';
import { translate } from '../../locales/index.js';
import { commandRegistry } from '../../commands/registry.js';
import { hasMinimumRole } from '../../services/permissions.js';

export function registerInformationModule(dependencies: Dependencies): void {
  dependencies.bot.command('help', async (ctx) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    const role = await dependencies.permissions.roleFor(ctx, ctx.group.id, BigInt(ctx.from.id));
    const categories = new Map<string, string[]>();
    for (const definition of commandRegistry) {
      if (!hasMinimumRole(role, definition.role)) continue;
      const commands = categories.get(definition.category) ?? [];
      commands.push(`/${definition.command} – ${definition.description}`);
      categories.set(definition.category, commands);
    }
    const body = [...categories.entries()]
      .map(([category, commands]) => `\n<b>${category}</b>\n${commands.join('\n')}`)
      .join('\n');
    await ctx.reply(`${translate(ctx.locale, 'help_title')}\n${body}`, { parse_mode: 'HTML' });
  });

  dependencies.bot.command('userinfo', async (ctx) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    const argumentsList = commandArguments(ctx);
    const resolvedTarget = await dependencies.targets.resolve(ctx, argumentsList, ctx.group.id);
    const target =
      resolvedTarget ??
      (argumentsList.length === 0
        ? { telegramId: BigInt(ctx.from.id), remainingArguments: [] }
        : null);
    if (!target) throw new UserFacingError('error_target');
    if (target.telegramId !== BigInt(ctx.from.id)) {
      await dependencies.permissions.requireModerator(ctx, ctx.group.id);
    }
    const user = await findOrCreateUserByTelegramId(dependencies.database, target.telegramId);
    const [member, warnings, actions, history] = await Promise.all([
      dependencies.database.groupMember.findUnique({
        where: { groupId_userId: { groupId: ctx.group.id, userId: user.id } },
      }),
      dependencies.database.warning.count({
        where: { groupId: ctx.group.id, userId: user.id, clearedAt: null, deletedAt: null },
      }),
      dependencies.database.moderationAction.count({
        where: { groupId: ctx.group.id, targetUserId: user.id },
      }),
      dependencies.database.moderationAction.findMany({
        where: { groupId: ctx.group.id, targetUserId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { type: true, reason: true, createdAt: true },
      }),
    ]);
    const role = await dependencies.permissions.roleFor(ctx, ctx.group.id, target.telegramId);
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
    const historyText = history.length
      ? history
          .map(
            (action) =>
              `${action.type} (${action.createdAt.toLocaleDateString('de-DE')})${action.reason ? `: ${escapeHtml(action.reason)}` : ''}`,
          )
          .join('\n')
      : '–';
    await ctx.reply(
      translate(ctx.locale, 'userinfo', {
        name: escapeHtml(name),
        id: target.telegramId.toString(),
        role,
        joined: member?.joinedAt.toLocaleString('de-DE') ?? 'unbekannt',
        warnings,
        muted: member?.mutedUntil?.toLocaleString('de-DE') ?? 'nein',
        actions,
        history: historyText,
      }),
      { parse_mode: 'HTML' },
    );
  });

  dependencies.bot.command('mydata', async (ctx) => {
    await ctx.reply(translate(ctx.locale, 'privacy_data'));
  });

  dependencies.bot.command('deletemydata', async (ctx) => {
    if (!ctx.from) return;
    await dependencies.database.user.updateMany({
      where: { telegramId: BigInt(ctx.from.id) },
      data: { firstName: 'Gelöscht', lastName: null, username: null, locale: null },
    });
    await ctx.reply(translate(ctx.locale, 'privacy_deleted'));
  });
}
