import type { Chat, User as TelegramUser } from 'grammy/types';
import type { Database } from './client.js';

export async function ensureGroup(
  database: Database,
  chat: Chat,
  defaultTimezone = 'Europe/Berlin',
) {
  const title = 'title' in chat && chat.title ? chat.title : String(chat.id);
  return database.telegramGroup.upsert({
    where: { telegramId: BigInt(chat.id) },
    create: {
      telegramId: BigInt(chat.id),
      title,
      settings: { create: { timezone: defaultTimezone } },
    },
    update: { title, isActive: true },
  });
}

export async function ensureUser(database: Database, user: TelegramUser) {
  return database.user.upsert({
    where: { telegramId: BigInt(user.id) },
    create: {
      telegramId: BigInt(user.id),
      firstName: user.first_name,
      ...(user.last_name ? { lastName: user.last_name } : {}),
      ...(user.username ? { username: user.username } : {}),
      ...(user.language_code ? { locale: user.language_code } : {}),
    },
    update: {
      firstName: user.first_name,
      lastName: user.last_name ?? null,
      username: user.username ?? null,
      locale: user.language_code ?? null,
    },
  });
}

export async function ensureMember(database: Database, groupId: string, user: TelegramUser) {
  const storedUser = await ensureUser(database, user);
  const member = await database.groupMember.upsert({
    where: { groupId_userId: { groupId, userId: storedUser.id } },
    create: { groupId, userId: storedUser.id },
    update: { lastSeenAt: new Date(), deletedAt: null },
  });
  return { user: storedUser, member };
}

export async function findOrCreateUserByTelegramId(database: Database, telegramId: bigint) {
  return database.user.upsert({
    where: { telegramId },
    create: { telegramId, firstName: `Telegram-Nutzer ${telegramId}` },
    update: {},
  });
}
