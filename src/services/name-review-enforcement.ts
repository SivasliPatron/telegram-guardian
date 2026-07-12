import {
  ModerationActionType,
  NameReviewContext,
  NameReviewStatus,
} from '../generated/prisma/enums.js';
import { translate } from '../locales/index.js';
import { isProtectedNeutralName } from './name-guard.js';
import type { Dependencies } from '../types/dependencies.js';

type NameReviewEnforcementDependencies = Pick<
  Dependencies,
  'adminLog' | 'bot' | 'database' | 'logger' | 'redis'
>;

export interface NameReviewEnforcementResult {
  handledJoinRequest: boolean;
  removedMember: boolean;
  targetWasAbsent: boolean;
}

export async function enforceResolvedNameReview(
  dependencies: NameReviewEnforcementDependencies,
  reviewId: string,
): Promise<NameReviewEnforcementResult | null> {
  const lockKey = `name-review-enforcement:${reviewId}`;
  const locked = await dependencies.redis.set(lockKey, '1', 'EX', 55, 'NX');
  if (locked !== 'OK') return null;

  try {
    const review = await dependencies.database.nameReview.findUnique({
      where: { id: reviewId },
      include: { group: true, targetUser: true },
    });
    if (
      !review ||
      (review.status !== NameReviewStatus.ALLOWED && review.status !== NameReviewStatus.FORBIDDEN)
    ) {
      return null;
    }
    if (
      review.status === NameReviewStatus.FORBIDDEN &&
      isProtectedNeutralName(review.displayName)
    ) {
      await dependencies.database.nameReview.updateMany({
        where: { id: review.id, status: NameReviewStatus.FORBIDDEN },
        data: { status: NameReviewStatus.ALLOWED, enforcedAt: new Date() },
      });
      return { handledJoinRequest: false, removedMember: false, targetWasAbsent: false };
    }
    if (review.enforcedAt) {
      return {
        handledJoinRequest: review.context === NameReviewContext.JOIN_REQUEST,
        removedMember: review.status === NameReviewStatus.FORBIDDEN,
        targetWasAbsent: false,
      };
    }

    let handledJoinRequest = false;
    let removedMember = false;
    let targetWasAbsent = false;
    const chatId = review.group.telegramId.toString();
    const targetTelegramId = Number(review.targetUser.telegramId);

    if (review.context === NameReviewContext.JOIN_REQUEST) {
      try {
        if (review.status === NameReviewStatus.ALLOWED) {
          await dependencies.bot.api.approveChatJoinRequest(chatId, targetTelegramId);
        } else {
          await sendPrivateNameNotice(dependencies, review);
          await dependencies.bot.api.declineChatJoinRequest(chatId, targetTelegramId);
        }
        handledJoinRequest = true;
      } catch (error) {
        if (!joinRequestIsAlreadyResolved(error)) throw error;
        if (review.status === NameReviewStatus.FORBIDDEN) {
          const member = await dependencies.bot.api.getChatMember(chatId, targetTelegramId);
          if (member.status === 'administrator' || member.status === 'creator') {
            dependencies.logger.warn(
              { groupId: review.groupId, reviewId, targetTelegramId },
              'Abgelehnte Namensprüfung konnte nicht entfernen, weil das Ziel inzwischen Admin ist',
            );
          } else if (member.status === 'left' || member.status === 'kicked') {
            targetWasAbsent = true;
          } else {
            await dependencies.bot.api.banChatMember(chatId, targetTelegramId);
            await dependencies.bot.api.unbanChatMember(chatId, targetTelegramId, {
              only_if_banned: true,
            });
            removedMember = true;
          }
        } else {
          targetWasAbsent = true;
        }
      }
    } else if (review.status === NameReviewStatus.FORBIDDEN) {
      await sendPrivateNameNotice(dependencies, review);
      const member = await dependencies.bot.api.getChatMember(chatId, targetTelegramId);
      if (member.status === 'administrator' || member.status === 'creator') {
        dependencies.logger.warn(
          { groupId: review.groupId, reviewId, targetTelegramId },
          'Namensentscheidung konnte nicht durchgesetzt werden, weil das Ziel inzwischen Admin ist',
        );
      } else if (member.status === 'left' || member.status === 'kicked') {
        targetWasAbsent = true;
      } else {
        await dependencies.bot.api.banChatMember(chatId, targetTelegramId);
        await dependencies.bot.api.unbanChatMember(chatId, targetTelegramId, {
          only_if_banned: true,
        });
        removedMember = true;
      }
    }

    if (review.status === NameReviewStatus.FORBIDDEN) {
      const existingAction = await dependencies.database.moderationAction.findFirst({
        where: {
          groupId: review.groupId,
          targetUserId: review.targetUserId,
          type: ModerationActionType.KICK,
          metadata: { path: ['nameReviewId'], equals: review.id },
        },
        select: { id: true },
      });
      if (!existingAction) {
        await dependencies.database.$transaction([
          dependencies.database.moderationAction.create({
            data: {
              groupId: review.groupId,
              targetUserId: review.targetUserId,
              ...(review.reviewedById ? { moderatorId: review.reviewedById } : {}),
              type: ModerationActionType.KICK,
              reason:
                review.context === NameReviewContext.JOIN_REQUEST
                  ? `Beitrittsanfrage wegen bestätigtem Namensfilter abgelehnt: ${review.candidatePattern}`
                  : `Wegen bestätigtem Namensfilter entfernt: ${review.candidatePattern}`,
              metadata: {
                nameGuard: true,
                nameReviewId: review.id,
                pattern: review.candidatePattern,
                context: review.context,
              },
            },
          }),
          dependencies.database.groupMember.updateMany({
            where: { groupId: review.groupId, userId: review.targetUserId },
            data: { mutedUntil: null, deletedAt: new Date() },
          }),
        ]);
      }
    }

    await dependencies.database.nameReview.updateMany({
      where: {
        id: review.id,
        status: review.status,
        enforcedAt: null,
      },
      data: { enforcedAt: new Date() },
    });
    await dependencies.adminLog.send(
      review.groupId,
      review.status === NameReviewStatus.ALLOWED
        ? 'Namensprüfung – erlaubt'
        : 'Namensprüfung – nicht erlaubt',
      {
        Nutzer: review.targetUser.telegramId.toString(),
        Name: review.displayName,
        Filter: review.candidatePattern,
        Prüfung: review.id,
      },
    );
    return { handledJoinRequest, removedMember, targetWasAbsent };
  } finally {
    await dependencies.redis.del(lockKey).catch(() => undefined);
  }
}

async function sendPrivateNameNotice(
  dependencies: NameReviewEnforcementDependencies,
  review: {
    groupId: string;
    requestUserChatId: bigint | null;
    targetUser: { telegramId: bigint };
  },
): Promise<void> {
  const settings = await dependencies.database.groupSettings.findUnique({
    where: { groupId: review.groupId },
    select: { language: true, nameProtectionMessage: true },
  });
  const message = translate(settings?.language ?? 'de', 'name_guard_private_notice', {
    message:
      settings?.nameProtectionMessage ??
      'Dieser Name ist in unserer Gruppe nicht erlaubt. Ändere deinen Namen und versuche es erneut.',
  });
  await dependencies.bot.api
    .sendMessage((review.requestUserChatId ?? review.targetUser.telegramId).toString(), message)
    .catch(() => undefined);
}

function joinRequestIsAlreadyResolved(error: unknown): boolean {
  const description =
    typeof error === 'object' && error !== null && 'description' in error
      ? String((error as { description?: unknown }).description)
      : '';
  const message = `${error instanceof Error ? error.message : String(error)} ${description}`;
  return /hide[_ ]requester[_ ]missing|join request.*not found|user.*already.*participant/iu.test(
    message,
  );
}
