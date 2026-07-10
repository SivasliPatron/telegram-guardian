import type { Dependencies } from '../../types/dependencies.js';
import { ensureMember } from '../../database/repositories.js';
import { displayName } from '../../utils/telegram.js';
import { rulesKeyboard } from '../rules/index.js';
import { UserFacingError } from '../../utils/errors.js';
import { translate } from '../../locales/index.js';

function renderWelcome(
  template: string,
  members: readonly { first_name: string; last_name?: string; username?: string }[],
  groupTitle: string,
): string {
  const names = members.map(displayName).join(', ');
  const usernames = members
    .map((member) => (member.username ? `@${member.username}` : '–'))
    .join(', ');
  return template
    .replaceAll('{name}', names)
    .replaceAll('{username}', usernames)
    .replaceAll('{group}', groupTitle);
}

export function registerWelcomeModule(dependencies: Dependencies): void {
  dependencies.bot.on('message:new_chat_members', async (ctx) => {
    if (!ctx.group) return;
    const group = ctx.group;
    const settings = await dependencies.settings.get(group.id);
    if (!settings.welcomeEnabled) return;
    const members = ctx.message.new_chat_members.filter(
      (member) => settings.welcomeBots || !member.is_bot,
    );
    if (members.length === 0) return;
    await Promise.all(
      members.map((member) => ensureMember(dependencies.database, group.id, member)),
    );
    const sent = await ctx.reply(renderWelcome(settings.welcomeText, members, group.title), {
      ...(settings.welcomeRulesButton ? { reply_markup: rulesKeyboard(ctx.locale) } : {}),
    });
    if (settings.welcomeDeleteAfterSec) {
      await dependencies.jobs.scheduleDeletion(
        String(ctx.chat.id),
        sent.message_id,
        settings.welcomeDeleteAfterSec,
      );
    }
  });

  dependencies.bot.command('welcome', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const argument = ctx.message?.text.split(/\s+/)[1]?.toLowerCase();
    if (argument !== 'on' && argument !== 'off') throw new UserFacingError('error_reason');
    await dependencies.settings.update(ctx.group.id, { welcomeEnabled: argument === 'on' });
    await ctx.reply(translate(ctx.locale, 'setting_saved'));
  });
}

export { renderWelcome };
