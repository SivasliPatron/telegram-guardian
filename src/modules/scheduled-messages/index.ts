import type { Dependencies } from '../../types/dependencies.js';
import { commandArguments, commandRemainder } from '../../utils/telegram.js';
import { isClockTime } from '../../utils/time.js';
import { UserFacingError } from '../../utils/errors.js';
import { translate } from '../../locales/index.js';

export function registerScheduledMessagesModule(dependencies: Dependencies): void {
  dependencies.bot.command('schedulemessage', async (ctx) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const argumentsList = commandArguments(ctx);
    const time = argumentsList[0] ?? '';
    const weekdays = (argumentsList[1] ?? '')
      .split(',')
      .map(Number)
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    const message = commandRemainder(ctx, 2);
    if (!isClockTime(time) || weekdays.length === 0 || !message)
      throw new UserFacingError('error_reason');
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
    if (!id) throw new UserFacingError('error_reason');
    await dependencies.database.scheduledMessage.updateMany({
      where: { id, groupId: ctx.group.id },
      data: { active: false, deletedAt: new Date() },
    });
    await ctx.reply(translate(ctx.locale, 'setting_saved'));
  });
}
