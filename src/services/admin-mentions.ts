import type { Dependencies } from '../types/dependencies.js';
import type { BotContext } from '../types/context.js';
import { escapeHtml } from '../utils/telegram.js';

interface AdministratorEntry {
  user: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
  };
}

export function formatAdministratorMentions(administrators: readonly AdministratorEntry[]): string {
  return administrators
    .filter(({ user }) => !user.is_bot)
    .map(({ user }) => {
      const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
      const label = fullName.slice(0, 40) || `Admin ${user.id}`;
      return `<a href="tg://user?id=${user.id}">${escapeHtml(label)}</a>`;
    })
    .join(', ');
}

export async function appendAdministratorMentions(
  dependencies: Dependencies,
  ctx: BotContext,
  warningMessage: string,
): Promise<string> {
  if (!ctx.group) return warningMessage;
  try {
    const administrators = await ctx.api.getChatAdministrators(ctx.group.telegramId.toString());
    const mentions = formatAdministratorMentions(administrators);
    return mentions ? `${warningMessage}\n\n📣 <b>Admins:</b> ${mentions}` : warningMessage;
  } catch (error) {
    dependencies.logger.warn(
      { err: error, groupId: ctx.group.id },
      'Administratoren konnten für den Moderationshinweis nicht markiert werden',
    );
    return warningMessage;
  }
}
