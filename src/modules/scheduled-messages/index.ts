import type { Dependencies } from '../../types/dependencies.js';
import { commandArguments, commandRemainder } from '../../utils/telegram.js';
import { isClockTime } from '../../utils/time.js';
import { UserFacingError } from '../../utils/errors.js';
import { translate } from '../../locales/index.js';

export function parseWeekdays(value: string): number[] | null {
  const parts = value.split(',');
  if (parts.length === 0 || parts.some((part) => !/^[0-6]$/u.test(part))) return null;
  return [...new Set(parts.map(Number))];
}

export function registerScheduledMessagesModule(dependencies: Dependencies): void {
  dependencies.bot.command('schedulemessage', async (ctx) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const argumentsList = commandArguments(ctx);
    const time = argumentsList[0] ?? '';
    const weekdays = parseWeekdays(argumentsList[1] ?? '');
    const message = commandRemainder(ctx, 2);
    if (!isClockTime(time) || !weekdays || !message) {
      throw new UserFacingError('error_schedule_message');
    }
    const settings = await dependencies.settings.get(ctx.group.id);
    await dependencies.database.scheduledMessage.create({
      data: {
        groupId: ctx.group.id,
        text: message,
        time,
        weekdays: [...new Set(weekdays)],
        timezone: settings.timezone,
        createdByTelegramId: BigInt(ctx.from.id),
      },
    });
    await ctx.reply(translate(ctx.locale, 'setting_saved'));
  });

  dependencies.bot.command('scheduledmessages', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const messages = await dependencies.database.scheduledMessage.findMany({
      where: { groupId: ctx.group.id, deletedAt: null },
      orderBy: { time: 'asc' },
    });
    await ctx.reply(
      messages
        .map(
          (message) =>
            `${message.id} | ${message.time} | ${message.weekdays.join(',')} | ${message.text}`,
        )
        .join('\n') || '–',
    );
  });

  dependencies.bot.command('deletescheduledmessage', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const id = commandArguments(ctx)[0];
    if (!id) throw new UserFacingError('error_delete_scheduled_message');
    const result = await dependencies.database.scheduledMessage.updateMany({
      where: { id, groupId: ctx.group.id },
      data: { active: false, deletedAt: new Date() },
    });
    if (result.count === 0) throw new UserFacingError('scheduled_message_not_found');
    await ctx.reply(translate(ctx.locale, 'setting_saved'));
  });
}
