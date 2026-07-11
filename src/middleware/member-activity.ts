import type { MiddlewareFn } from 'grammy';
import type { ChatMember, Message, User as TelegramUser } from 'grammy/types';
import { ensureMember } from '../database/repositories.js';
import type { BotContext } from '../types/context.js';
import type { Dependencies } from '../types/dependencies.js';
import { recordActivityMarker } from '../services/activity-marker.js';

const ACTIVITY_MESSAGE_FIELDS = [
  'text',
  'rich_message',
  'animation',
  'audio',
  'document',
  'live_photo',
  'paid_media',
  'photo',
  'sticker',
  'story',
  'video',
  'video_note',
  'voice',
  'contact',
  'dice',
  'game',
  'poll',
  'venue',
  'location',
  'checklist',
] as const;

export function isUserActivityMessage(message: Message): boolean {
  const fields = message as unknown as Record<string, unknown>;
  return ACTIVITY_MESSAGE_FIELDS.some((field) => field in fields);
}

function telegramDate(unixSeconds: number): Date {
  return new Date(unixSeconds * 1_000);
}

function isPresent(member: ChatMember): boolean {
  return (
    member.status === 'creator' ||
    member.status === 'administrator' ||
    member.status === 'member' ||
    (member.status === 'restricted' && member.is_member)
  );
}

function isProtectedTelegramRole(member: ChatMember): boolean {
  return member.status === 'creator' || member.status === 'administrator';
}

async function markMemberDeleted(
  dependencies: Dependencies,
  groupId: string,
  user: TelegramUser,
  deletedAt: Date,
): Promise<void> {
  await dependencies.database.groupMember.updateMany({
    where: { groupId, user: { telegramId: BigInt(user.id) } },
    data: { deletedAt },
  });
  await dependencies.database.groupMember.updateMany({
    where: {
      groupId,
      user: { telegramId: BigInt(user.id) },
      inactivityRemovalStartedAt: null,
      inactivityBannedAt: null,
    },
    data: {
      inactivityWarnedAt: null,
      inactivityKickDueAt: null,
    },
  });
}

export function memberActivityMiddleware(dependencies: Dependencies): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    if (!ctx.group) {
      await next();
      return;
    }

    const groupId = ctx.group.id;
    const chatMemberUpdate = ctx.chatMember;
    if (chatMemberUpdate && !chatMemberUpdate.new_chat_member.user.is_bot) {
      const wasPresent = isPresent(chatMemberUpdate.old_chat_member);
      const isNowPresent = isPresent(chatMemberUpdate.new_chat_member);
      const protectionChanged =
        isProtectedTelegramRole(chatMemberUpdate.old_chat_member) !==
        isProtectedTelegramRole(chatMemberUpdate.new_chat_member);
      const changedAt = telegramDate(chatMemberUpdate.date);
      if (isNowPresent) {
        if (!wasPresent || protectionChanged) {
          await ensureMember(
            dependencies.database,
            groupId,
            chatMemberUpdate.new_chat_member.user,
            changedAt,
          );
        }
      } else if (wasPresent) {
        await markMemberDeleted(
          dependencies,
          groupId,
          chatMemberUpdate.new_chat_member.user,
          changedAt,
        );
      }
    }

    if (ctx.message && 'new_chat_members' in ctx.message) {
      const joinedAt = telegramDate(ctx.message.date);
      await Promise.all(
        ctx.message.new_chat_members
          .filter((member) => !member.is_bot)
          .map((member) => ensureMember(dependencies.database, groupId, member, joinedAt)),
      );
    }

    if (ctx.message && 'left_chat_member' in ctx.message && !ctx.message.left_chat_member.is_bot) {
      await markMemberDeleted(
        dependencies,
        groupId,
        ctx.message.left_chat_member,
        telegramDate(ctx.message.date),
      );
    }

    if (ctx.message && ctx.from && !ctx.from.is_bot && isUserActivityMessage(ctx.message)) {
      const occurredAt = telegramDate(ctx.message.date);
      const [markerResult, databaseResult] = await Promise.allSettled([
        recordActivityMarker(dependencies.redis, groupId, BigInt(ctx.from.id), occurredAt),
        ensureMember(dependencies.database, groupId, ctx.from, occurredAt),
      ]);

      if (markerResult.status === 'rejected' && databaseResult.status === 'rejected') {
        throw new AggregateError(
          [markerResult.reason, databaseResult.reason],
          'Mitgliederaktivität konnte weder in Redis noch in PostgreSQL gespeichert werden',
        );
      }
      if (databaseResult.status === 'rejected') throw databaseResult.reason;
      if (markerResult.status === 'rejected') {
        dependencies.logger.warn(
          { err: markerResult.reason, groupId, telegramId: ctx.from.id },
          'Redis-Aktivitätsmarker fehlgeschlagen; PostgreSQL-Aktivität wurde gespeichert',
        );
      }
    }

    await next();
  };
}
