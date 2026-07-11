import { InlineKeyboard } from 'grammy';
import {
  FilterActionType,
  ModerationActionType,
  ModerationReviewStatus,
} from '../../generated/prisma/enums.js';
import { translate } from '../../locales/index.js';
import { appendAdministratorMentions } from '../../services/admin-mentions.js';
import type { AiModerationResult } from '../../services/ai-moderation.js';
import { enforceApprovedModerationReview } from '../../services/moderation-review-enforcement.js';
import type { BotContext } from '../../types/context.js';
import type { Dependencies } from '../../types/dependencies.js';
import { ensureUser } from '../../database/repositories.js';
import { displayName, escapeHtml, quotedMessageReason } from '../../utils/telegram.js';

const REVIEW_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const REVIEW_TEXT_LIMIT = 700;
const REVIEW_CALLBACK_PATTERN = /^mr:(y|n):([a-z0-9]+)$/u;

export type ModerationReviewDecision = 'approve' | 'dismiss';

export interface ModerationReviewCallback {
  decision: ModerationReviewDecision;
  reviewId: string;
}

export function moderationReviewCallbackData(
  decision: ModerationReviewDecision,
  reviewId: string,
): string {
  return `mr:${decision === 'approve' ? 'y' : 'n'}:${reviewId}`;
}

export function parseModerationReviewCallback(data: string): ModerationReviewCallback | null {
  const match = REVIEW_CALLBACK_PATTERN.exec(data);
  if (!match?.[1] || !match[2]) return null;
  return {
    decision: match[1] === 'y' ? 'approve' : 'dismiss',
    reviewId: match[2],
  };
}

export function moderationReviewKeyboard(reviewId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('⚠️ Verwarnung: Ja', moderationReviewCallbackData('approve', reviewId))
    .text('✅ Verwarnung: Nein', moderationReviewCallbackData('dismiss', reviewId));
}

export function formatModerationReviewMessage(input: {
  user: string;
  messageText: string;
  category: string;
  confidence: number;
  reason: string;
}): string {
  return [
    '🔎 <b>Admin-Prüfung erforderlich</b>',
    '',
    `<b>Nutzer:</b> ${escapeHtml(input.user)}`,
    `<b>Nachricht:</b> ${escapeHtml(quotedMessageReason(input.messageText, REVIEW_TEXT_LIMIT))}`,
    `<b>Möglicher Bereich:</b> ${escapeHtml(input.category)}`,
    `<b>KI-Einschätzung:</b> ${Math.round(input.confidence * 100)} %`,
    `<b>Hinweis:</b> ${escapeHtml(input.reason)}`,
    '',
    'Die Nachricht wurde noch nicht gelöscht und es wurde noch keine Verwarnung vergeben. Bitte entscheidet mit einem Button.',
  ].join('\n');
}

export async function requestModerationReview(
  dependencies: Dependencies,
  ctx: BotContext,
  result: AiModerationResult,
  messageText: string,
): Promise<void> {
  if (!ctx.group || !ctx.from || !ctx.message) return;
  const originalMessageId = BigInt(ctx.message.message_id);
  const existing = await dependencies.database.moderationReview.findUnique({
    where: {
      groupId_originalMessageId: { groupId: ctx.group.id, originalMessageId },
    },
    select: { id: true },
  });
  if (existing) return;

  const target = await ensureUser(dependencies.database, ctx.from);
  const storedText = messageText.trim().slice(0, REVIEW_TEXT_LIMIT);
  const review = await dependencies.database.moderationReview.create({
    data: {
      groupId: ctx.group.id,
      targetUserId: target.id,
      originalMessageId,
      messageText: storedText,
      aiCategory: result.category,
      aiConfidence: result.confidence,
      aiReason: result.reason,
      expiresAt: new Date(Date.now() + REVIEW_LIFETIME_MS),
    },
  });

  let sentMessageId: number | undefined;
  try {
    const reviewText = formatModerationReviewMessage({
      user: displayName(ctx.from),
      messageText: storedText,
      category: result.category,
      confidence: result.confidence,
      reason: result.reason,
    });
    const sent = await ctx.reply(await appendAdministratorMentions(dependencies, ctx, reviewText), {
      parse_mode: 'HTML',
      reply_markup: moderationReviewKeyboard(review.id),
      reply_parameters: {
        message_id: ctx.message.message_id,
        allow_sending_without_reply: true,
      },
    });
    sentMessageId = sent.message_id;
    await dependencies.database.moderationReview.update({
      where: { id: review.id },
      data: { reviewMessageId: BigInt(sent.message_id) },
    });
    await dependencies.adminLog.send(ctx.group.id, 'KI-Filter – Admin-Prüfung', {
      Nutzer: ctx.from.id,
      Kategorie: result.category,
      Sicherheit: `${Math.round(result.confidence * 100)} %`,
      Grund: result.reason,
      Prüfung: review.id,
    });
  } catch (error) {
    if (sentMessageId !== undefined) {
      await ctx.api
        .deleteMessage(ctx.group.telegramId.toString(), sentMessageId)
        .catch(() => undefined);
    }
    await dependencies.database.moderationReview.deleteMany({
      where: { id: review.id, reviewMessageId: null },
    });
    throw error;
  }
}

export function registerModerationReviewModule(dependencies: Dependencies): void {
  dependencies.bot.callbackQuery(REVIEW_CALLBACK_PATTERN, async (ctx) => {
    const parsed = parseModerationReviewCallback(ctx.callbackQuery.data);
    if (!parsed || !ctx.group || !ctx.callbackQuery.message) {
      await ctx.answerCallbackQuery({
        text: 'Diese Admin-Prüfung ist nicht mehr verfügbar.',
        show_alert: true,
      });
      return;
    }

    const review = await dependencies.database.moderationReview.findUnique({
      where: { id: parsed.reviewId },
      include: { targetUser: true },
    });
    const callbackMessageId = BigInt(ctx.callbackQuery.message.message_id);
    if (review?.groupId !== ctx.group.id || review.reviewMessageId !== callbackMessageId) {
      await ctx.answerCallbackQuery({
        text: 'Diese Admin-Prüfung gehört nicht zu dieser Nachricht.',
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

    if (review.status !== ModerationReviewStatus.PENDING) {
      await ctx.answerCallbackQuery({
        text: 'Über diese Nachricht wurde bereits entschieden.',
        show_alert: true,
      });
      await finishReviewMessage(
        dependencies,
        ctx,
        review.status === ModerationReviewStatus.EXPIRED
          ? '⌛ Prüfung abgelaufen.'
          : '✅ Über diesen Prüffall wurde bereits entschieden.',
      );
      return;
    }

    if (review.expiresAt.getTime() <= Date.now()) {
      const expired = await dependencies.database.moderationReview.updateMany({
        where: {
          id: review.id,
          status: ModerationReviewStatus.PENDING,
          expiresAt: { lte: new Date() },
        },
        data: { status: ModerationReviewStatus.EXPIRED, messageText: '' },
      });
      if (expired.count !== 1) {
        await ctx.answerCallbackQuery({
          text: 'Über diese Nachricht wurde bereits entschieden.',
          show_alert: true,
        });
        return;
      }
      await ctx.answerCallbackQuery({
        text: 'Diese Admin-Prüfung ist nach 24 Stunden abgelaufen.',
        show_alert: true,
      });
      await finishReviewMessage(dependencies, ctx, '⌛ Prüfung abgelaufen.');
      return;
    }

    const reviewer = await ensureUser(dependencies.database, ctx.from);
    if (parsed.decision === 'dismiss') {
      const decisionTime = new Date();
      const dismissed = await dependencies.database.moderationReview.updateMany({
        where: {
          id: review.id,
          status: ModerationReviewStatus.PENDING,
          expiresAt: { gt: decisionTime },
        },
        data: {
          status: ModerationReviewStatus.DISMISSED,
          reviewedById: reviewer.id,
          reviewedAt: decisionTime,
          messageText: '',
        },
      });
      if (dismissed.count !== 1) {
        await ctx.answerCallbackQuery({
          text: 'Über diese Nachricht wurde bereits entschieden.',
          show_alert: true,
        });
        return;
      }
      await ctx.answerCallbackQuery({ text: 'Keine Verwarnung – Nachricht bleibt stehen.' });
      await finishReviewMessage(
        dependencies,
        ctx,
        `✅ ${displayName(ctx.from)}: keine Verwarnung.`,
      );
      await dependencies.adminLog.send(ctx.group.id, 'KI-Prüfung abgelehnt', {
        Nutzer: review.targetUser.telegramId.toString(),
        Admin: ctx.from.id,
        Prüfung: review.id,
      });
      return;
    }

    const targetMember = await ctx.api.getChatMember(
      ctx.group.telegramId.toString(),
      Number(review.targetUser.telegramId),
    );
    if (targetMember.status === 'administrator' || targetMember.status === 'creator') {
      await ctx.answerCallbackQuery({
        text: 'Administratoren und Eigentümer dürfen nicht verwarnt werden.',
        show_alert: true,
      });
      return;
    }

    const reason = quotedMessageReason(review.messageText, REVIEW_TEXT_LIMIT);
    const groupId = ctx.group.id;
    await ctx.answerCallbackQuery({ text: 'Entscheidung wird verarbeitet …' });
    const approved = await dependencies.database.$transaction(async (transaction) => {
      const decisionTime = new Date();
      const claimed = await transaction.moderationReview.updateMany({
        where: {
          id: review.id,
          status: ModerationReviewStatus.PENDING,
          expiresAt: { gt: decisionTime },
        },
        data: {
          status: ModerationReviewStatus.APPROVED,
          reviewedById: reviewer.id,
          reviewedAt: decisionTime,
          messageText: '',
        },
      });
      if (claimed.count !== 1) return null;
      const warning = await transaction.warning.create({
        data: {
          groupId,
          userId: review.targetUserId,
          moderatorId: reviewer.id,
          reason,
          originalMessageId: review.originalMessageId,
        },
      });
      await transaction.moderationReview.update({
        where: { id: review.id },
        data: { warningId: warning.id },
      });
      await transaction.moderationAction.create({
        data: {
          groupId,
          targetUserId: review.targetUserId,
          moderatorId: reviewer.id,
          type: ModerationActionType.FILTER,
          reason,
          originalMessageId: review.originalMessageId,
          metadata: {
            action: FilterActionType.WARN,
            ai: {
              category: review.aiCategory,
              confidence: review.aiConfidence,
              reason: review.aiReason,
            },
            adminReview: { id: review.id, decision: 'approved' },
          },
        },
      });
      return warning;
    });

    if (!approved) {
      return;
    }

    let enforcement;
    try {
      enforcement = await enforceApprovedModerationReview(dependencies, review.id);
    } finally {
      await finishReviewMessage(
        dependencies,
        ctx,
        `⚠️ ${displayName(ctx.from)}: Verwarnung erteilt.`,
      );
    }

    const [fallbackWarningCount, settings] = await Promise.all([
      enforcement
        ? Promise.resolve(enforcement.warningCount)
        : dependencies.database.warning.count({
            where: {
              groupId: ctx.group.id,
              userId: review.targetUserId,
              clearedAt: null,
              deletedAt: null,
            },
          }),
      dependencies.settings.get(ctx.group.id),
    ]);
    const warningCount = enforcement?.warningCount ?? fallbackWarningCount;
    const maxWarnings = enforcement?.maxWarnings ?? settings.maxWarnings;
    const targetName = storedUserDisplayName(review.targetUser);
    const warningMessage = translate(ctx.locale, 'warning_added', {
      user: escapeHtml(targetName),
      count: warningCount,
      max: maxWarnings > 0 ? maxWarnings : '∞',
      reason: escapeHtml(reason),
    });
    await ctx
      .reply(await appendAdministratorMentions(dependencies, ctx, warningMessage), {
        parse_mode: 'HTML',
      })
      .catch((error: unknown) => {
        dependencies.logger.warn(
          { err: error, groupId: ctx.group?.id, reviewId: review.id },
          'Die bestätigte Verwarnung konnte nicht in der Gruppe angekündigt werden',
        );
      });

    if (enforcement?.banned) {
      await ctx.reply(
        translate(ctx.locale, 'automatic_warning_banned', {
          user: escapeHtml(targetName),
          count: warningCount,
        }),
        { parse_mode: 'HTML' },
      );
    }
    await dependencies.adminLog.send(ctx.group.id, 'KI-Prüfung bestätigt', {
      Nutzer: review.targetUser.telegramId.toString(),
      Admin: ctx.from.id,
      Grund: reason,
      Anzahl: warningCount,
      Prüfung: review.id,
    });
  });
}

function storedUserDisplayName(user: {
  firstName: string;
  lastName: string | null;
  username: string | null;
}): string {
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return user.username ? `${fullName} (@${user.username})` : fullName;
}

async function finishReviewMessage(
  dependencies: Dependencies,
  ctx: BotContext,
  decisionText: string,
): Promise<void> {
  const resolvedText = [
    '🔎 Admin-Prüfung abgeschlossen',
    '',
    decisionText,
    '',
    'Der geprüfte Nachrichtentext wurde aus diesem Bot-Hinweis entfernt.',
  ].join('\n');
  try {
    await ctx.editMessageText(resolvedText, {
      reply_markup: new InlineKeyboard(),
    });
    if (ctx.group && ctx.callbackQuery?.message) {
      await dependencies.database.moderationReview.updateMany({
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
      'Die Admin-Prüfnachricht konnte nicht abgeschlossen werden',
    );
  }
}
