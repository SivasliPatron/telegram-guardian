import type { Context } from 'grammy';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function commandArguments(ctx: Context): string[] {
  const text = ctx.message?.text ?? '';
  const firstSpace = text.indexOf(' ');
  if (firstSpace === -1) return [];
  return text
    .slice(firstSpace + 1)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function commandRemainder(ctx: Context, skipArguments = 0): string {
  const argumentsList = commandArguments(ctx);
  return argumentsList.slice(skipArguments).join(' ').trim();
}

export interface TargetReference {
  telegramId: bigint;
  messageId?: bigint;
  remainingArguments: string[];
}

export function resolveTarget(ctx: Context, argumentsList: string[]): TargetReference | null {
  const repliedMessage = ctx.message?.reply_to_message;
  const repliedUser = repliedMessage?.from;
  if (repliedUser) {
    return {
      telegramId: BigInt(repliedUser.id),
      messageId: BigInt(repliedMessage.message_id),
      remainingArguments: argumentsList,
    };
  }
  const first = argumentsList[0];
  if (!first || !/^\d+$/.test(first)) return null;
  return { telegramId: BigInt(first), remainingArguments: argumentsList.slice(1) };
}

export function displayName(user: {
  first_name: string;
  last_name?: string;
  username?: string;
}): string {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return user.username ? `${fullName} (@${user.username})` : fullName;
}
