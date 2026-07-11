import { describe, expect, it, vi } from 'vitest';
import { InternalRole, ModerationReviewStatus } from '../src/generated/prisma/enums.js';
import {
  moderationReviewCallbackData,
  registerModerationReviewModule,
  requestModerationReview,
} from '../src/modules/moderation-review/index.js';
import type { AiModerationResult } from '../src/services/ai-moderation.js';
import type { BotContext } from '../src/types/context.js';
import type { Dependencies } from '../src/types/dependencies.js';

type ReviewStatus = (typeof ModerationReviewStatus)[keyof typeof ModerationReviewStatus];
type CallbackHandler = (ctx: BotContext) => Promise<void>;

interface ReviewRecord {
  id: string;
  groupId: string;
  targetUserId: string;
  originalMessageId: bigint;
  reviewMessageId: bigint | null;
  messageText: string;
  aiCategory: string;
  aiConfidence: number;
  aiReason: string;
  status: ReviewStatus;
  expiresAt: Date;
  reviewedById: string | null;
  reviewedAt: Date | null;
  warningId: string | null;
  enforcedAt: Date | null;
  group: { id: string; telegramId: bigint; title: string };
  targetUser: {
    id: string;
    telegramId: bigint;
    firstName: string;
    lastName: string | null;
    username: string | null;
  };
}

interface ReviewUpdateManyInput {
  where: { status?: ReviewStatus };
  data: {
    status?: ReviewStatus;
    reviewedById?: string;
    reviewedAt?: Date;
    messageText?: string;
    enforcedAt?: Date;
  };
}

interface ReviewUpdateInput {
  data: {
    reviewMessageId?: bigint;
    warningId?: string;
  };
}

interface ReviewCreateInput {
  data: {
    groupId: string;
    targetUserId: string;
    originalMessageId: bigint;
    messageText: string;
    aiCategory: string;
    aiConfidence: number;
    aiReason: string;
    expiresAt: Date;
  };
}

interface UserUpsertInput {
  where: { telegramId: bigint };
}

function createReviewRecord(): ReviewRecord {
  return {
    id: 'review123',
    groupId: 'group-db-id',
    targetUserId: 'target-db-id',
    originalMessageId: 42n,
    reviewMessageId: 501n,
    messageText: 'h s Menschen in Afrika haben kein Wasser',
    aiCategory: 'insult',
    aiConfidence: 0.6,
    aiReason: 'Möglicherweise verschleierte beleidigende Abkürzung',
    status: ModerationReviewStatus.PENDING,
    expiresAt: new Date(Date.now() + 60_000),
    reviewedById: null,
    reviewedAt: null,
    warningId: null,
    enforcedAt: null,
    group: { id: 'group-db-id', telegramId: -100123n, title: 'Testgruppe' },
    targetUser: {
      id: 'target-db-id',
      telegramId: 99n,
      firstName: 'Zielnutzer',
      lastName: null,
      username: 'ziel',
    },
  };
}

function createHarness(role: InternalRole = InternalRole.ADMIN) {
  let callbackHandler: CallbackHandler | undefined;
  let review: ReviewRecord | null = createReviewRecord();

  const reviewFindUnique = vi.fn((input: { where: Record<string, unknown> }) =>
    Promise.resolve('groupId_originalMessageId' in input.where ? null : review),
  );
  const reviewCreate = vi.fn((input: ReviewCreateInput) => {
    review = {
      id: 'review-created',
      ...input.data,
      reviewMessageId: null,
      status: ModerationReviewStatus.PENDING,
      reviewedById: null,
      reviewedAt: null,
      warningId: null,
      enforcedAt: null,
      group: { id: 'group-db-id', telegramId: -100123n, title: 'Testgruppe' },
      targetUser: {
        id: 'target-db-id',
        telegramId: 99n,
        firstName: 'Zielnutzer',
        lastName: null,
        username: 'ziel',
      },
    };
    return Promise.resolve(review);
  });
  const reviewUpdateMany = vi.fn((input: ReviewUpdateManyInput) => {
    if (!review || (input.where.status && review.status !== input.where.status)) {
      return Promise.resolve({ count: 0 });
    }
    Object.assign(review, input.data);
    return Promise.resolve({ count: 1 });
  });
  const reviewUpdate = vi.fn((input: ReviewUpdateInput) => {
    if (!review) throw new Error('Prüffall fehlt');
    Object.assign(review, input.data);
    return Promise.resolve(review);
  });
  const reviewDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const warningCreate = vi.fn().mockResolvedValue({ id: 'warning-1' });
  const actionCreate = vi.fn().mockResolvedValue({ id: 'action-1' });
  const transaction = {
    moderationReview: { updateMany: reviewUpdateMany, update: reviewUpdate },
    warning: { create: warningCreate },
    moderationAction: { create: actionCreate },
  };
  const runTransaction = vi.fn((operation: (client: typeof transaction) => Promise<unknown>) =>
    operation(transaction),
  );
  const userUpsert = vi.fn((input: UserUpsertInput) =>
    Promise.resolve(
      input.where.telegramId === 99n
        ? review?.targetUser
        : {
            id: 'admin-db-id',
            telegramId: input.where.telegramId,
            firstName: 'Admin Ada',
            lastName: null,
            username: 'ada',
          },
    ),
  );
  const deleteMessage = vi.fn().mockResolvedValue(true);
  const getChatMember = vi.fn((_chatId: string, userId: number) =>
    Promise.resolve({
      status:
        userId === 7 && (role === InternalRole.ADMIN || role === InternalRole.OWNER)
          ? 'administrator'
          : 'member',
    }),
  );
  const getChatAdministrators = vi.fn().mockResolvedValue([
    {
      status: 'creator',
      user: { id: 7, is_bot: false, first_name: 'Admin', last_name: 'Ada' },
    },
    {
      status: 'administrator',
      user: { id: 8, is_bot: false, first_name: 'Admin', last_name: 'Bora' },
    },
    {
      status: 'administrator',
      user: { id: 9, is_bot: true, first_name: 'Bot' },
    },
  ]);
  const callbackQuery = vi.fn(
    (_pattern: RegExp, handler: CallbackHandler) => void (callbackHandler = handler),
  );
  const adminLogSend = vi.fn().mockResolvedValue(undefined);
  const roleFor = vi.fn().mockResolvedValue(role);

  const dependencies = {
    bot: {
      callbackQuery,
      api: {
        banChatMember: vi.fn().mockResolvedValue(true),
        deleteMessage,
        getChatMember,
      },
    },
    env: { OWNER_TELEGRAM_ID: '999999' },
    redis: {
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    },
    database: {
      user: { upsert: userUpsert },
      moderationReview: {
        findUnique: reviewFindUnique,
        create: reviewCreate,
        updateMany: reviewUpdateMany,
        update: reviewUpdate,
        deleteMany: reviewDeleteMany,
      },
      warning: {
        create: warningCreate,
        count: vi.fn().mockResolvedValue(1),
      },
      moderationAction: { create: actionCreate },
      groupSettings: { findUnique: vi.fn().mockResolvedValue({ maxWarnings: 3 }) },
      $transaction: runTransaction,
    },
    permissions: { roleFor },
    settings: { get: vi.fn().mockResolvedValue({ maxWarnings: 3 }) },
    adminLog: { send: adminLogSend },
    logger: { warn: vi.fn() },
  } as unknown as Dependencies;

  registerModerationReviewModule(dependencies);

  const callbackContext = (decision: 'approve' | 'dismiss') => {
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);
    const editMessageText = vi.fn().mockResolvedValue(true);
    const reply = vi.fn().mockResolvedValue({ message_id: 700 });
    const context = {
      group: { id: 'group-db-id', telegramId: -100123n, title: 'Testgruppe' },
      locale: 'de',
      from: { id: 7, is_bot: false, first_name: 'Admin', last_name: 'Ada' },
      callbackQuery: {
        data: moderationReviewCallbackData(decision, 'review123'),
        message: {
          message_id: 501,
          text: '🔎 Admin-Prüfung erforderlich\nh s Menschen in Afrika haben kein Wasser',
        },
      },
      api: { deleteMessage, getChatMember, getChatAdministrators },
      answerCallbackQuery,
      editMessageText,
      reply,
    } as unknown as BotContext;
    return { context, answerCallbackQuery, editMessageText, reply };
  };

  return {
    dependencies,
    callbackContext,
    handler: () => {
      if (!callbackHandler) throw new Error('Callback-Handler wurde nicht registriert');
      return callbackHandler;
    },
    getReview: () => review,
    reviewCreate,
    reviewUpdate,
    reviewUpdateMany,
    warningCreate,
    actionCreate,
    deleteMessage,
    getChatAdministrators,
    adminLogSend,
  };
}

describe('Admin-Prüfablauf für kritische KI-Grenzfälle', () => {
  it('erstellt eine markierte Admin-Prüfung mit zwei Buttons, aber keine Sanktion', async () => {
    const harness = createHarness();
    const reply = vi.fn().mockResolvedValue({ message_id: 501 });
    const context = {
      group: { id: 'group-db-id', telegramId: -100123n, title: 'Testgruppe' },
      from: { id: 99, is_bot: false, first_name: 'Zielnutzer', username: 'ziel' },
      message: { message_id: 42, text: 'h s Menschen in Afrika haben kein Wasser' },
      api: { getChatAdministrators: harness.getChatAdministrators },
      reply,
    } as unknown as BotContext;
    const result: AiModerationResult = {
      violation: false,
      reviewRecommended: true,
      category: 'insult',
      confidence: 0.6,
      reason: 'Möglicherweise verschleierte beleidigende Abkürzung',
    };

    await requestModerationReview(
      harness.dependencies,
      context,
      result,
      'h s Menschen in Afrika haben kein Wasser',
    );

    expect(harness.reviewCreate).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledOnce();
    const [prompt, options] = reply.mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: unknown[][] }; reply_parameters: { message_id: number } },
    ];
    expect(prompt).toContain('Admin-Prüfung erforderlich');
    expect(prompt).toContain('h s Menschen in Afrika haben kein Wasser');
    expect(prompt).toContain('tg://user?id=7');
    expect(prompt).toContain('tg://user?id=8');
    expect(prompt).not.toContain('tg://user?id=9');
    expect(options.reply_markup.inline_keyboard).toEqual([
      [
        { text: '⚠️ Verwarnung: Ja', callback_data: 'mr:y:review-created' },
        { text: '✅ Verwarnung: Nein', callback_data: 'mr:n:review-created' },
      ],
    ]);
    expect(options.reply_parameters.message_id).toBe(42);
    expect(harness.warningCreate).not.toHaveBeenCalled();
    expect(harness.deleteMessage).not.toHaveBeenCalled();
  });

  it('lässt Nicht-Admins keine Entscheidung treffen', async () => {
    const harness = createHarness(InternalRole.MEMBER);
    const callback = harness.callbackContext('approve');

    await harness.handler()(callback.context);

    expect(callback.answerCallbackQuery).toHaveBeenCalledWith({
      text: 'Nur Administratoren dürfen darüber entscheiden.',
      show_alert: true,
    });
    expect(harness.getReview()?.status).toBe(ModerationReviewStatus.PENDING);
    expect(harness.reviewUpdateMany).not.toHaveBeenCalled();
    expect(harness.warningCreate).not.toHaveBeenCalled();
    expect(harness.deleteMessage).not.toHaveBeenCalled();
  });

  it('behält beim Nein-Button die Nachricht und erstellt keine Verwarnung', async () => {
    const harness = createHarness();
    const callback = harness.callbackContext('dismiss');

    await harness.handler()(callback.context);

    expect(harness.getReview()?.status).toBe(ModerationReviewStatus.DISMISSED);
    expect(callback.answerCallbackQuery).toHaveBeenCalledWith({
      text: 'Keine Verwarnung – Nachricht bleibt stehen.',
    });
    expect(callback.editMessageText).toHaveBeenCalledOnce();
    expect(callback.editMessageText.mock.calls[0]?.[0]).not.toContain('h s Menschen');
    expect(harness.warningCreate).not.toHaveBeenCalled();
    expect(harness.actionCreate).not.toHaveBeenCalled();
    expect(harness.deleteMessage).not.toHaveBeenCalled();
  });

  it('erstellt beim Ja-Button genau eine Verwarnung und löscht die Originalnachricht', async () => {
    const harness = createHarness();
    const callback = harness.callbackContext('approve');

    await harness.handler()(callback.context);

    expect(harness.getReview()?.status).toBe(ModerationReviewStatus.APPROVED);
    expect(harness.warningCreate).toHaveBeenCalledOnce();
    expect(harness.warningCreate).toHaveBeenCalledWith({
      data: {
        groupId: 'group-db-id',
        userId: 'target-db-id',
        moderatorId: 'admin-db-id',
        originalMessageId: 42n,
        reason: 'Nachricht: „h s Menschen in Afrika haben kein Wasser“',
      },
    });
    expect(harness.actionCreate).toHaveBeenCalledOnce();
    expect(harness.deleteMessage).toHaveBeenCalledOnce();
    expect(harness.deleteMessage).toHaveBeenCalledWith('-100123', 42);
    expect(callback.answerCallbackQuery).toHaveBeenCalledWith({
      text: 'Entscheidung wird verarbeitet …',
    });
    expect(callback.editMessageText.mock.calls[0]?.[0]).not.toContain('h s Menschen');
  });

  it('kann auch bei zwei gleichzeitigen Ja-Klicks keine Sanktion duplizieren', async () => {
    const harness = createHarness();
    const first = harness.callbackContext('approve');
    const second = harness.callbackContext('approve');

    await Promise.all([harness.handler()(first.context), harness.handler()(second.context)]);

    expect(harness.warningCreate).toHaveBeenCalledOnce();
    expect(harness.actionCreate).toHaveBeenCalledOnce();
    expect(harness.deleteMessage).toHaveBeenCalledOnce();
    expect(first.answerCallbackQuery).toHaveBeenCalled();
    expect(second.answerCallbackQuery).toHaveBeenCalled();
  });
});
