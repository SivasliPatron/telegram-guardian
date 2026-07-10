import { InlineKeyboard } from 'grammy';
import type { Dependencies } from '../../types/dependencies.js';
import { commandRemainder, escapeHtml } from '../../utils/telegram.js';
import { translate } from '../../locales/index.js';
import { UserFacingError } from '../../utils/errors.js';
import type { BotContext } from '../../types/context.js';
import { applyRecommendedGroupSetup } from '../../services/group-setup.js';

export function registerRulesModule(dependencies: Dependencies): void {
  const sendRules = async (ctx: BotContext) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    const settings = await dependencies.settings.get(ctx.group.id);
    await ctx.reply(
      `${translate(ctx.locale, 'rules_title')}\n\n${escapeHtml(settings.rulesText)}`,
      {
        parse_mode: 'HTML',
      },
    );
  };

  dependencies.bot.command(['rules', 'regeln'], sendRules);
  dependencies.bot.callbackQuery('show-rules', async (ctx) => {
    await ctx.answerCallbackQuery();
    await sendRules(ctx);
  });
  dependencies.bot.command('setrules', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const rules = commandRemainder(ctx);
    if (!rules) throw new UserFacingError('error_setrules');
    await dependencies.settings.update(ctx.group.id, { rulesText: rules });
    await dependencies.adminLog.send(ctx.group.id, 'Regeln geändert', {
      Moderator: ctx.from?.id ?? 0,
    });
    await ctx.reply(translate(ctx.locale, 'rules_saved'));
  });

  dependencies.bot.command('setupgroup', async (ctx) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    await applyRecommendedGroupSetup(
      dependencies.database,
      dependencies.redis,
      ctx.group.id,
      BigInt(ctx.from.id),
    );
    await dependencies.adminLog.send(ctx.group.id, 'Empfohlenes Gruppensetup angewendet', {
      Moderator: ctx.from.id,
    });
    await ctx.reply(translate(ctx.locale, 'setup_complete'));
  });
}

export function rulesKeyboard(locale: string): InlineKeyboard {
  return new InlineKeyboard().text(translate(locale, 'welcome_rules_button'), 'show-rules');
}
