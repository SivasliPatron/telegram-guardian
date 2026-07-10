import type { Dependencies } from '../../types/dependencies.js';
import { commandArguments } from '../../utils/telegram.js';
import { isClockTime } from '../../utils/time.js';
import { UserFacingError } from '../../utils/errors.js';
import { translate } from '../../locales/index.js';
import type { BotContext } from '../../types/context.js';
import { memberPermissions } from '../moderation/permissions.js';

export function registerNightModeModule(dependencies: Dependencies): void {
  dependencies.bot.command('nightmode', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const value = commandArguments(ctx)[0]?.toLowerCase();
    if (value !== 'on' && value !== 'off') {
      const settings = await dependencies.settings.get(ctx.group.id);
      await ctx.reply(
        translate(ctx.locale, 'nightmode_status', {
          status: translate(
            ctx.locale,
            settings.nightModeEnabled ? 'night_enabled' : 'night_disabled',
          ),
        }),
      );
      return;
    }
    const settings = await dependencies.settings.get(ctx.group.id);
    if (value === 'off' && settings.nightClosed) {
      await dependencies.permissions.requireBotRestrictionRights(ctx);
      await ctx.api.setChatPermissions(ctx.group.telegramId.toString(), memberPermissions);
      await dependencies.settings.update(ctx.group.id, {
        nightModeEnabled: false,
        nightClosed: false,
        lastNightActionAt: new Date(),
      });
    } else {
      await dependencies.settings.update(ctx.group.id, { nightModeEnabled: value === 'on' });
    }
    await ctx.reply(translate(ctx.locale, 'setting_saved'));
  });

  const setTime = async (ctx: BotContext, field: 'nightCloseTime' | 'nightOpenTime') => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const time = commandArguments(ctx)[0] ?? '';
    if (!isClockTime(time)) throw new UserFacingError('error_clock');
    await dependencies.settings.update(ctx.group.id, { [field]: time });
    await ctx.reply(translate(ctx.locale, 'setting_saved'));
  };
  dependencies.bot.command('setclosetime', (ctx) => setTime(ctx, 'nightCloseTime'));
  dependencies.bot.command('setopentime', (ctx) => setTime(ctx, 'nightOpenTime'));

  dependencies.bot.command('nightstatus', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    const settings = await dependencies.settings.get(ctx.group.id);
    await ctx.reply(
      translate(ctx.locale, 'night_status', {
        enabled: translate(
          ctx.locale,
          settings.nightModeEnabled ? 'night_enabled' : 'night_disabled',
        ),
        close: settings.nightCloseTime,
        open: settings.nightOpenTime,
        timezone: settings.timezone,
      }),
    );
  });
}
