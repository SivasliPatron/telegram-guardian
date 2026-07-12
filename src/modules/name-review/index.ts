import { createHash } from 'node:crypto';
import { InlineKeyboard } from 'grammy';
import type { User as TelegramUser } from 'grammy/types';
import {
  ModerationActionType,
  NameReviewContext,
  NameReviewStatus,
} from '../../generated/prisma/enums.js';
import { ensureUser } from '../../database/repositories.js';
import { translate, type TranslationKey } from '../../locales/index.js';
import { appendAdministratorMentions } from '../../services/admin-mentions.js';
import { enforceResolvedNameReview } from '../../services/name-review-enforcement.js';
import {
  allowedNameCacheKey,
  forbiddenNameCacheKey,
  isValidForbiddenName,
  matchesForbiddenName,
  normalizeName,
  visibleProfileName,
} from '../../services/name-guard.js';
import type { BotContext } from '../../types/context.js';
import type { Dependencies } from '../../types/dependencies.js';
import { UserFacingError } from '../../utils/errors.js';
import { displayName, escapeHtml } from '../../utils/telegram.js';

const REVIEW_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const REVIEW_CALLBACK_PATTERN = /^nr:(a|f):([a-z0-9]+)$/u;

export interface NameReviewCandidate {
  pattern: string;
  source: 'preset' | 'ai';
  reason: string;
  confidence?: number;
}

export interface NameReviewRequest {
  user: TelegramUser;
  context: NameReviewContext;
  candidate: NameReviewCandidate;
  requestUserChatId?: bigint;
}

export type NameReviewDecision = 'allow' | 'forbid';

export function nameReviewCallbackData(decision: NameReviewDecision, reviewId: string): string {
  return `nr:${decision === 'allow' ? 'a' : 'f'}:${reviewId}`;
}

export function parseNameReviewCallback(
  data: string,
): { decision: NameReviewDecision; reviewId: string } | null {
  const match = REVIEW_CALLBACK_PATTERN.exec(data);
  if (!match?.[1] || !match[2]) return null;
  return { decision: match[1] === 'a' ? 'allow' : 'forbid', reviewId: match[2] };
}

export function nameReviewKeyboard(reviewId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Erlaubt', nameReviewCallbackData('allow', reviewId))
    .text('🚫 Nicht erlaubt', nameReviewCallbackData('forbid', reviewId));
}

export function formatNameReviewMessage(input: {
  user: string;
  visibleName: string;
  candidatePattern: string;
  reason: string;
  confidence?: number;
  joinRequest: boolean;
}): string {
  const assessment =
    input.confidence === undefined
      ? escapeHtml(input.reason)
      : `${escapeHtml(input.reason)} (${Math.round(input.confidence * 100)} %)`;
  return [
    '🔎 <b>Admin-Prüfung für einen Namen</b>',
    '',
    `<b>Nutzer:</b> ${escapeHtml(input.user)}`,
    `<b>Sichtbarer Name:</b> ${escapeHtml(input.visibleName)}`,
    `<b>Möglicher Filter:</b> ${escapeHtml(input.candidatePattern)}`,
    `<b>Hinweis:</b> ${assessment}`,
    '',
    input.joinRequest
      ? 'Die Beitrittsanfrage wartet. Es wurde noch nichts abgelehnt.'
      : 'Die Person bleibt bis zu eurer Entscheidung in der Gruppe.',
    '„Erlaubt“ speichert eine Ausnahme. „Nicht erlaubt“ speichert den bestätigten Namensfilter und entfernt die Person.',
  ].join('\n');
}

export async function requestNameReview(
  dependencies: Dependencies,
  ctx: BotContext,
  input: NameReviewRequest,
): Promise<void> {
  if (!ctx.group) return;
  const visibleName = visibleProfileName(input.user).trim();
  const normalizedName = normalizeName(visibleName).normalized;
  if (!normalizedName || !isValidForbiddenName(input.candidate.pattern)) return;

  const target = await ensureUser(dependencies.database, input.user);
  const requestKey = createHash('sha256')
    .update(`${ctx.group.id}\0${target.id}\0${normalizedName}`)
    .digest('hex');
  const lockKey = `name-review-request:${requestKey}`;
  const locked = await dependencies.redis.set(lockKey, '1', 'EX', 30, 'NX');
  if (locked !== 'OK') return;

  try {
    const existing = await dependencies.database.nameReview.findUnique({
      where: {
        groupId_targetUserId_normalizedName: {
          groupId: ctx.group.id,
          targetUserId: target.id,
          normalizedName,
        },
      },
    });
    if (
      existing?.status === NameReviewStatus.PENDING &&
      existing.expiresAt.getTime() > Date.now() &&
      existing.reviewMessageId
    ) {
      return;
    }
    if (existing && (await resolvedDecisionIsStillActive(dependencies, existing))) {
      return;
    }

    const reviewData = {
      context: input.context,
      displayName: visibleName,
      normalizedName,
      candidatePattern: input.candidate.pattern.trim(),
      source: input.candidate.source,
      reason: input.candidate.reason,
      confidence: input.candidate.confidence ?? null,
      requestUserChatId: input.requestUserChatId ?? null,
      status: NameReviewStatus.PENDING,
      expiresAt: new Date(Date.now() + REVIEW_LIFETIME_MS),
      reviewedById: null,
      reviewedAt: null,
      enforcedAt: null,
      reviewMessageId: null,
    } as const;
    let review;
    try {
      review = existing
        ? await dependencies.database.nameReview.update({
            where: { id: existing.id },
            data: reviewData,
          })
        : await dependencies.database.nameReview.create({
            data: { groupId: ctx.group.id, targetUserId: target.id, ...reviewData },
          });
    } catch (error) {
      if (isUniqueConstraintError(error)) return;
      throw error;
    }

    let sentMessageId: number | undefined;
    try {
      const text = formatNameReviewMessage({
        user: displayName(input.user),
        visibleName,
        candidatePattern: input.candidate.pattern,
        reason: input.candidate.reason,
        ...(input.candidate.confidence === undefined
          ? {}
          : { confidence: input.candidate.confidence }),
        joinRequest: input.context === NameReviewContext.JOIN_REQUEST,
      });
      const sent = await ctx.reply(await appendAdministratorMentions(dependencies, ctx, text), {
        parse_mode: 'HTML',
        reply_markup: nameReviewKeyboard(review.id),
      });
      sentMessageId = sent.message_id;
      await dependencies.database.nameReview.update({
        where: { id: review.id },
        data: { reviewMessageId: BigInt(sent.message_id) },
      });
      await dependencies.adminLog.send(ctx.group.id, 'Namensprüfung – Admin-Entscheidung', {
        Nutzer: input.user.id,
        Name: visibleName,
        Hinweis: input.candidate.reason,
        Prüfung: review.id,
      });
    } catch (error) {
      if (sentMessageId !== undefined) {
        await ctx.api
          .deleteMessage(ctx.group.telegramId.toString(), sentMessageId)
          .catch(() => undefined);
      }
      await dependencies.database.nameReview.updateMany({
        where: { id: review.id, status: NameReviewStatus.PENDING },
        data: { status: NameReviewStatus.EXPIRED, reviewMessageId: null },
      });
      throw error;
    }
  } finally {
    await dependencies.redis.del(lockKey).catch(() => undefined);
  }
}

export function registerNameReviewModule(dependencies: Dependencies): void {
  dependencies.bot.callbackQuery(REVIEW_CALLBACK_PATTERN, async (ctx) => {
    const parsed = parseNameReviewCallback(ctx.callbackQuery.data);
    if (!parsed || !ctx.group || !ctx.callbackQuery.message) {
      await ctx.answerCallbackQuery({
        text: 'Diese Namensprüfung ist nicht mehr verfügbar.',
        show_alert: true,
      });
      return;
    }

    const review = await dependencies.database.nameReview.findUnique({
      where: { id: parsed.reviewId },
      include: { targetUser: true },
    });
    const callbackMessageId = BigInt(ctx.callbackQuery.message.message_id);
    if (review?.groupId !== ctx.group.id || review.reviewMessageId !== callbackMessageId) {
      await ctx.answerCallbackQuery({
        text: 'Diese Namensprüfung gehört nicht zu dieser Nachricht.',
        show_alert: true,
      });
      return;
    }

    const decidingMember = await ctx.api.getChatMember(
      ctx.group.telegramId.toString(),
      ctx.from.id,
    );
    const isCurrentAdmin =
      decidingMember.status === 'administrator' ||
      decidingMember.status === 'creator' ||
      BigInt(ctx.from.id) === BigInt(dependencies.env.OWNER_TELEGRAM_ID);
    if (!isCurrentAdmin) {
      await ctx.answerCallbackQuery({
        text: 'Nur Administratoren dürfen darüber entscheiden.',
        show_alert: true,
      });
      return;
    }
    if (review.status !== NameReviewStatus.PENDING) {
      await ctx.answerCallbackQuery({
        text: 'Über diesen Namen wurde bereits entschieden.',
        show_alert: true,
      });
      return;
    }
    if (review.expiresAt.getTime() <= Date.now()) {
      await dependencies.database.nameReview.updateMany({
        where: {
          id: review.id,
          status: NameReviewStatus.PENDING,
          expiresAt: { lte: new Date() },
        },
        data: { status: NameReviewStatus.EXPIRED },
      });
      await ctx.answerCallbackQuery({
        text: 'Diese Namensprüfung ist nach 24 Stunden abgelaufen.',
        show_alert: true,
      });
      await finishNameReviewMessage(dependencies, ctx, '⌛ Prüfung abgelaufen.');
      return;
    }

    try {
      if (review.context === NameReviewContext.JOIN_REQUEST) {
        await dependencies.permissions.requireBotInviteRights(ctx);
      } else if (parsed.decision === 'forbid') {
        await Promise.all([
          dependencies.permissions.requireBotRestrictionRights(ctx),
          dependencies.permissions.requireUnprotectedTarget(ctx, review.targetUser.telegramId),
        ]);
      }
    } catch (error) {
      if (error instanceof UserFacingError) {
        await ctx.answerCallbackQuery({
          text: translate(ctx.locale, error.translationKey as TranslationKey),
          show_alert: true,
        });
        return;
      }
      throw error;
    }

    const reviewer = await ensureUser(dependencies.database, ctx.from);
    const decisionTime = new Date();
    await ctx.answerCallbackQuery({ text: 'Entscheidung wird verarbeitet …' });
    const claimed = await dependencies.database.$transaction(async (transaction) => {
      const updated = await transaction.nameReview.updateMany({
        where: {
          id: review.id,
          status: NameReviewStatus.PENDING,
          expiresAt: { gt: decisionTime },
        },
        data: {
          status:
            parsed.decision === 'allow' ? NameReviewStatus.ALLOWED : NameReviewStatus.FORBIDDEN,
          reviewedById: reviewer.id,
          reviewedAt: decisionTime,
        },
      });
      if (updated.count !== 1) return false;

      if (parsed.decision === 'allow') {
        await transaction.allowedName.upsert({
          where: {
            groupId_normalizedName: {
              groupId: review.groupId,
              normalizedName: review.normalizedName,
            },
          },
          create: {
            groupId: review.groupId,
            displayName: review.displayName,
            normalizedName: review.normalizedName,
            createdByTelegramId: reviewer.telegramId,
          },
          update: {
            displayName: review.displayName,
            enabled: true,
            deletedAt: null,
            createdByTelegramId: reviewer.telegramId,
          },
        });
      } else {
        const filterPattern = validReviewPattern(review.candidatePattern, review.displayName);
        const normalized = normalizeName(filterPattern);
        await transaction.forbiddenName.upsert({
          where: {
            groupId_normalizedPattern: {
              groupId: review.groupId,
              normalizedPattern: normalized.normalized,
            },
          },
          create: {
            groupId: review.groupId,
            pattern: filterPattern,
            normalizedPattern: normalized.normalized,
            compactPattern: normalized.compact,
            createdByTelegramId: reviewer.telegramId,
          },
          update: {
            pattern: filterPattern,
            compactPattern: normalized.compact,
            enabled: true,
            deletedAt: null,
            createdByTelegramId: reviewer.telegramId,
          },
        });
      }
      await transaction.moderationAction.create({
        data: {
          groupId: review.groupId,
          targetUserId: review.targetUserId,
          moderatorId: reviewer.id,
          type: ModerationActionType.FILTER,
          reason:
            parsed.decision === 'allow'
              ? `Name erlaubt: ${review.displayName}`
              : `Name nicht erlaubt: ${review.candidatePattern}`,
          metadata: {
            nameReviewId: review.id,
            decision: parsed.decision,
            displayName: review.displayName,
            pattern: review.candidatePattern,
          },
        },
      });
      return true;
    });
    if (!claimed) return;

    await dependencies.redis.del(
      parsed.decision === 'allow'
        ? allowedNameCacheKey(review.groupId)
        : forbiddenNameCacheKey(review.groupId),
    );

    let enforcement = null;
    try {
      enforcement = await enforceResolvedNameReview(dependencies, review.id);
    } catch (error) {
      dependencies.logger.error(
        { err: error, groupId: review.groupId, reviewId: review.id },
        'Die gespeicherte Namensentscheidung wird vom Hintergrundjob erneut durchgesetzt',
      );
    }

    const reviewerName = displayName(ctx.from);
    const decisionText =
      parsed.decision === 'allow'
        ? review.context === NameReviewContext.JOIN_REQUEST
          ? `✅ ${reviewerName}: Erlaubt. Die Beitrittsanfrage wurde angenommen.`
          : `✅ ${reviewerName}: Erlaubt. Die Person bleibt in der Gruppe.`
        : enforcement?.removedMember || enforcement?.handledJoinRequest
          ? `🚫 ${reviewerName}: Nicht erlaubt. Der Filter wurde gespeichert und die Person entfernt.`
          : enforcement?.targetWasAbsent
            ? `🚫 ${reviewerName}: Nicht erlaubt. Der Filter wurde gespeichert; die Person war bereits nicht mehr verfügbar.`
            : `🚫 ${reviewerName}: Nicht erlaubt. Der Filter wurde gespeichert; die Entfernung wird erneut versucht.`;
    await finishNameReviewMessage(dependencies, ctx, decisionText);
  });
}

function validReviewPattern(candidatePattern: string, displayNameValue: string): string {
  if (isValidForbiddenName(candidatePattern)) return candidatePattern.trim();
  if (isValidForbiddenName(displayNameValue)) return displayNameValue.trim();
  throw new Error('Der bestätigte Namensfilter ist ungültig.');
}

async function resolvedDecisionIsStillActive(
  dependencies: Dependencies,
  review: {
    groupId: string;
    normalizedName: string;
    status: NameReviewStatus;
  },
): Promise<boolean> {
  if (review.status === NameReviewStatus.ALLOWED) {
    return Boolean(
      await dependencies.database.allowedName.findFirst({
        where: {
          groupId: review.groupId,
          normalizedName: review.normalizedName,
          enabled: true,
          deletedAt: null,
        },
        select: { id: true },
      }),
    );
  }
  if (review.status !== NameReviewStatus.FORBIDDEN) return false;
  const forbiddenNames = await dependencies.database.forbiddenName.findMany({
    where: { groupId: review.groupId, enabled: true, deletedAt: null },
    select: { normalizedPattern: true, compactPattern: true },
  });
  const profileName = normalizeName(review.normalizedName);
  return forbiddenNames.some((forbidden) => matchesForbiddenName(profileName, forbidden));
}

async function finishNameReviewMessage(
  dependencies: Dependencies,
  ctx: BotContext,
  decisionText: string,
): Promise<void> {
  try {
    await ctx.editMessageText(['🔎 Namensprüfung abgeschlossen', '', decisionText].join('\n'), {
      reply_markup: new InlineKeyboard(),
    });
    if (ctx.group && ctx.callbackQuery?.message) {
      await dependencies.database.nameReview.updateMany({
        where: {
          groupId: ctx.group.id,
          reviewMessageId: BigInt(ctx.callbackQuery.message.message_id),
        },
        data: { reviewMessageId: null },
      });
    }
  } catch (error) {
    dependencies.logger.warn(
      { err: error, groupId: ctx.group?.id },
      'Die Namensprüfnachricht konnte nicht abgeschlossen werden',
    );
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
