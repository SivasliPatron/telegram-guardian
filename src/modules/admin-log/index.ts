import type { Dependencies } from '../../types/dependencies.js';
import { commandArguments } from '../../utils/telegram.js';
import { UserFacingError } from '../../utils/errors.js';
import { translate } from '../../locales/index.js';

export function registerAdminLogModule(dependencies: Dependencies): void {
  dependencies.bot.command('setlogchannel', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const rawId = commandArguments(ctx)[0];
    if (!rawId || !/^-\d+$/u.test(rawId)) throw new UserFacingError('error_target');
    await ctx.api.sendMessage(rawId, '✅ Admin-Log erfolgreich verbunden.');
    await dependencies.database.adminLogConfiguration.upsert({
      where: { groupId: ctx.group.id },
      create: { groupId: ctx.group.id, channelTelegramId: BigInt(rawId) },
      update: { channelTelegramId: BigInt(rawId), enabled: true },
    });
    await ctx.reply(translate(ctx.locale, 'log_channel_saved'));
  });
}
