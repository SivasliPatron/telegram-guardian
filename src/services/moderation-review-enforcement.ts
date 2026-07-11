import { ModerationActionType, ModerationReviewStatus } from '../generated/prisma/enums.js';
import type { Dependencies } from '../types/dependencies.js';
import { banAfterWarningThreshold, shouldApplyWarningBan } from './warning-escalation.js';

type EnforcementDependencies = Pick<
  Dependencies,
  'adminLog' | 'bot' | 'database' | 'logger' | 'redis'
>;

export interface ReviewEnforcementResult {
  warningCount: number;
  maxWarnings: number;
  banned: boolean;
}

export async function enforceApprovedModerationReview(
  dependencies: EnforcementDependencies,
  reviewId: string,
): Promise<ReviewEnforcementResult | null> {
  const lockKey = `moderation-review-enforcement:${reviewId}`;
  const locked = await dependencies.redis.set(lockKey, '1', 'EX', 55, 'NX');
  if (locked !== 'OK') return null;

  try {
    const review = await dependencies.database.moderationReview.findUnique({
      where: { id: reviewId },
      include: { group: true, targetUser: true },
    });
    if (review?.status !== ModerationReviewStatus.APPROVED) return null;

    const [warningCount, settings] = await Promise.all([
      dependencies.database.warning.count({
        where: {
          groupId: review.groupId,
          userId: review.targetUserId,
          clearedAt: null,
          deletedAt: null,
        },
      }),
      dependencies.database.groupSettings.findUnique({
        where: { groupId: review.groupId },
        select: { maxWarnings: true },
      }),
    ]);
    const maxWarnings = settings?.maxWarnings ?? 3;
    if (review.enforcedAt) {
      return {
        warningCount,
        maxWarnings,
        banned: shouldApplyWarningBan(warningCount, maxWarnings),
      };
    }

    try {
      await dependencies.bot.api.deleteMessage(
        review.group.telegramId.toString(),
        Number(review.originalMessageId),
      );
    } catch (error) {
      dependencies.logger.warn(
        { err: error, groupId: review.groupId, reviewId },
        'Die geprüfte Originalnachricht konnte nicht gelöscht werden',
      );
      if (!messageWasAlreadyDeleted(error)) throw error;
    }

    let banned = false;
    if (shouldApplyWarningBan(warningCount, maxWarnings)) {
      const targetMember = await dependencies.bot.api.getChatMember(
        review.group.telegramId.toString(),
        Number(review.targetUser.telegramId),
      );
      if (targetMember.status === 'administrator' || targetMember.status === 'creator') {
        dependencies.logger.warn(
          { groupId: review.groupId, reviewId, target: review.targetUser.telegramId.toString() },
          'Automatischer Verwarnungs-Ban übersprungen, weil das Ziel inzwischen Admin ist',
        );
      } else {
        const existingBan = await dependencies.database.moderationAction.findFirst({
          where: {
            groupId: review.groupId,
            targetUserId: review.targetUserId,
            type: ModerationActionType.BAN,
            metadata: { path: ['moderationReviewId'], equals: review.id },
          },
          select: { id: true },
        });
        if (!existingBan) {
          await banAfterWarningThreshold(dependencies, {
            group: review.group,
            targetUserId: review.targetUserId,
            targetTelegramId: review.targetUser.telegramId,
            ...(review.reviewedById ? { moderatorUserId: review.reviewedById } : {}),
            warningCount,
            sourceReviewId: review.id,
          });
        }
        banned = true;
      }
    }

    await dependencies.database.moderationReview.updateMany({
      where: {
        id: review.id,
        status: ModerationReviewStatus.APPROVED,
        enforcedAt: null,
      },
      data: { enforcedAt: new Date() },
    });
    return { warningCount, maxWarnings, banned };
  } finally {
    await dependencies.redis.del(lockKey).catch(() => undefined);
  }
}

function messageWasAlreadyDeleted(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /message to delete not found|message identifier is not specified/iu.test(message);
}
