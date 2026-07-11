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

export function clearedInactivityState() {
  return {
    inactivityWarnedAt: null,
    inactivityKickDueAt: null,
    inactivityRemovalStartedAt: null,
    inactivityBannedAt: null,
  } as const;
}

export async function ensureMember(
  database: Database,
  groupId: string,
  user: TelegramUser,
  lastSeenAt = new Date(),
) {
  const storedUser = await ensureUser(database, user);
  const existing = await database.groupMember.upsert({
    where: { groupId_userId: { groupId, userId: storedUser.id } },
    create: {
      groupId,
      userId: storedUser.id,
      lastSeenAt,
      ...clearedInactivityState(),
    },
    update: {},
  });
  const updatedWithoutRecovery = await database.groupMember.updateMany({
    where: {
      id: existing.id,
      lastSeenAt: { lte: lastSeenAt },
      inactivityRemovalStartedAt: null,
      inactivityBannedAt: null,
      OR: [{ deletedAt: null }, { deletedAt: { lte: lastSeenAt } }],
    },
    data: {
      lastSeenAt,
      deletedAt: null,
      inactivityWarnedAt: null,
      inactivityKickDueAt: null,
    },
  });

  if (updatedWithoutRecovery.count === 0) {
    await database.groupMember.updateMany({
      where: {
        id: existing.id,
        lastSeenAt: { lte: lastSeenAt },
        OR: [{ inactivityRemovalStartedAt: { not: null } }, { inactivityBannedAt: { not: null } }],
      },
      data: {
        lastSeenAt,
        inactivityWarnedAt: null,
        inactivityKickDueAt: null,
      },
    });
  }

  const member =
    updatedWithoutRecovery.count === 1
      ? { ...existing, lastSeenAt, deletedAt: null, ...clearedInactivityState() }
      : existing;
  return { user: storedUser, member };
}

export async function findOrCreateUserByTelegramId(database: Database, telegramId: bigint) {
  return database.user.upsert({
    where: { telegramId },
    create: { telegramId, firstName: `Telegram-Nutzer ${telegramId}` },
    update: {},
  });
}
