import { describe, expect, it, vi } from 'vitest';
import { FilterActionType, FilterMatchType, InternalRole } from '../src/generated/prisma/enums.js';
import { registerFilterModule } from '../src/modules/filters/index.js';
import { learnedReviewFilterKey } from '../src/services/learned-filter.js';
import type { BotContext } from '../src/types/context.js';
import type { Dependencies } from '../src/types/dependencies.js';

type TextMessageHandler = (ctx: BotContext, next: () => Promise<void>) => Promise<void>;

interface StoredFilter {
  id: string;
  presetKey: string | null;
  learnedKey?: string | null;
  pattern: string;
  matchType: FilterMatchType;
  action: FilterActionType;
  ignoreCase: boolean;
  muteDurationSeconds: number | null;
  responseText: string | null;
}

const HIGH_CONFIDENCE_VIOLATION = {
  violation: true,
  reviewRecommended: false,
  category: 'insult' as const,
  confidence: 0.99,
  reason: 'Eindeutige persönliche Beleidigung',
};

function createHarness(filters: StoredFilter[] = []) {
  let textHandler: TextMessageHandler | undefined;
  const warningCreate = vi.fn().mockResolvedValue({ id: 'warning-1' });
  const reviewCreate = vi.fn().mockResolvedValue({ id: 'review-1' });
  const deleteMessage = vi.fn().mockResolvedValue(true);
  const classify = vi.fn().mockResolvedValue(HIGH_CONFIDENCE_VIOLATION);
  const decide = vi.fn().mockReturnValue('warn');
  const reply = vi.fn().mockResolvedValue({ message_id: 501 });
  const next = vi.fn().mockResolvedValue(undefined);
  const moderationActionCreate = vi.fn().mockResolvedValue({ id: 'action-1' });
  const userUpsert = vi.fn((input: { where: { telegramId: bigint } }) =>
    Promise.resolve(
      input.where.telegramId === 99n
        ? {
            id: 'target-user',
            telegramId: 99n,
            firstName: 'Zielnutzer',
            lastName: null,
            username: 'ziel',
          }
        : {
            id: 'bot-user',
            telegramId: input.where.telegramId,
            firstName: 'Guardian',
            lastName: null,
            username: 'guardian_bot',
          },
    ),
  );

  const dependencies = {
    bot: {
      command: vi.fn(),
      on: vi.fn((trigger: string | string[], handler: TextMessageHandler) => {
        if (trigger === 'message:text') textHandler = handler;
      }),
      api: { banChatMember: vi.fn().mockResolvedValue(true) },
    },
    database: {
      filter: {
        findMany: vi.fn().mockResolvedValue(filters),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      moderationReview: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: reviewCreate,
        update: vi.fn().mockResolvedValue({ id: 'review-1' }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      user: { upsert: userUpsert },
      warning: {
        create: warningCreate,
        count: vi.fn().mockResolvedValue(1),
      },
      moderationAction: { create: moderationActionCreate },
      groupMember: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $transaction: vi.fn(),
    },
    redis: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue('OK'),
      del: vi.fn().mockResolvedValue(1),
    },
    env: {
      AI_AUDIO_FILTER_ENABLED: false,
      OWNER_TELEGRAM_ID: '7',
    },
    permissions: {
      roleFor: vi.fn().mockResolvedValue(InternalRole.MEMBER),
      requireAdmin: vi.fn(),
    },
    aiModeration: {
      enabled: true,
      classify,
      decide,
    },
    settings: { get: vi.fn().mockResolvedValue({ maxWarnings: 3 }) },
    adminLog: { send: vi.fn().mockResolvedValue(undefined) },
    logger: { warn: vi.fn(), info: vi.fn() },
  } as unknown as Dependencies;

  registerFilterModule(dependencies);

  const context = {
    group: { id: 'group-1', telegramId: -100123n, title: 'Testgruppe' },
    locale: 'de',
    from: { id: 99, is_bot: false, first_name: 'Zielnutzer', username: 'ziel' },
    message: { message_id: 42, text: 'Du bist ein Testschurke' },
    api: {
      getMe: vi.fn().mockResolvedValue({
        id: 777,
        is_bot: true,
        first_name: 'Guardian',
        username: 'guardian_bot',
      }),
      getChatAdministrators: vi.fn().mockResolvedValue([
        {
          status: 'creator',
          user: { id: 7, is_bot: false, first_name: 'Admin' },
        },
      ]),
      deleteMessage,
    },
    deleteMessage,
    reply,
  } as unknown as BotContext;

  return {
    classify,
    context,
    decide,
    deleteMessage,
    handler: () => {
      if (!textHandler) throw new Error('Text-Handler wurde nicht registriert');
      return textHandler;
    },
    moderationActionCreate,
    next,
    reply,
    reviewCreate,
    warningCreate,
  };
}

describe('verbindliche Moderationsrichtlinie für neue und gelernte Sätze', () => {
  it('legt selbst bei einer eindeutigen hohen KI-Warnentscheidung nur einen Admin-Prüffall an', async () => {
    const harness = createHarness();

    await harness.handler()(harness.context, harness.next);

    expect(harness.classify).toHaveBeenCalledWith('Du bist ein Testschurke');
    expect(harness.decide).toHaveBeenCalledWith(HIGH_CONFIDENCE_VIOLATION);
    expect(harness.reviewCreate).toHaveBeenCalledOnce();
    const reviewCall = harness.reviewCreate.mock.calls[0] as unknown as
      | [
          {
            data: {
              groupId: string;
              targetUserId: string;
              originalMessageId: bigint;
              messageText: string;
            };
          },
        ]
      | undefined;
    expect(reviewCall?.[0].data).toMatchObject({
      groupId: 'group-1',
      targetUserId: 'target-user',
      originalMessageId: 42n,
      messageText: 'Du bist ein Testschurke',
    });
    const replyCall = harness.reply.mock.calls[0] as unknown as
      | [
          string,
          {
            reply_markup: unknown;
            reply_parameters: { message_id: number };
          },
        ]
      | undefined;
    expect(replyCall?.[0]).toContain('Admin-Prüfung erforderlich');
    expect(replyCall?.[1].reply_markup).toBeDefined();
    expect(replyCall?.[1].reply_parameters.message_id).toBe(42);
    expect(harness.warningCreate).not.toHaveBeenCalled();
    expect(harness.moderationActionCreate).not.toHaveBeenCalled();
    expect(harness.deleteMessage).not.toHaveBeenCalled();
    expect(harness.next).not.toHaveBeenCalled();
  });

  it('verwarnt denselben zuvor bestätigten Satz künftig automatisch ohne neue KI-Prüfung', async () => {
    const phrase = 'Du bist ein Testschurke';
    const harness = createHarness([
      {
        id: 'learned-filter-1',
        presetKey: null,
        learnedKey: learnedReviewFilterKey(phrase),
        pattern: phrase,
        matchType: FilterMatchType.EXACT,
        action: FilterActionType.WARN,
        ignoreCase: true,
        muteDurationSeconds: null,
        responseText: null,
      },
    ]);

    const message = harness.context.message;
    if (!message || !('text' in message)) throw new Error('Textnachricht fehlt');
    message.text = 'DU BIST EIN TESTSCHURKE';
    await harness.handler()(harness.context, harness.next);

    expect(harness.classify).not.toHaveBeenCalled();
    expect(harness.decide).not.toHaveBeenCalled();
    expect(harness.reviewCreate).not.toHaveBeenCalled();
    expect(harness.deleteMessage).toHaveBeenCalledOnce();
    expect(harness.warningCreate).toHaveBeenCalledOnce();
    expect(harness.warningCreate).toHaveBeenCalledWith({
      data: {
        groupId: 'group-1',
        userId: 'target-user',
        moderatorId: 'bot-user',
        reason: 'Nachricht: „DU BIST EIN TESTSCHURKE“',
        originalMessageId: 42n,
      },
    });
    expect(harness.reply).toHaveBeenCalledWith(
      expect.stringContaining('automatisch verwarnt (1/3)'),
      { parse_mode: 'HTML' },
    );
  });

  it('bevorzugt einen bestätigten WARN-Satz vor einem gleichzeitig passenden generischen Filter', async () => {
    const phrase = 'Du bist ein Testschurke';
    const harness = createHarness([
      {
        id: 'generic-delete-filter',
        presetKey: null,
        pattern: phrase,
        matchType: FilterMatchType.EXACT,
        action: FilterActionType.DELETE,
        ignoreCase: true,
        muteDurationSeconds: null,
        responseText: null,
      },
      {
        id: 'learned-filter-1',
        presetKey: null,
        learnedKey: learnedReviewFilterKey(phrase),
        pattern: phrase,
        matchType: FilterMatchType.EXACT,
        action: FilterActionType.WARN,
        ignoreCase: true,
        muteDurationSeconds: null,
        responseText: null,
      },
    ]);

    await harness.handler()(harness.context, harness.next);

    expect(harness.warningCreate).toHaveBeenCalledOnce();
    expect(harness.classify).not.toHaveBeenCalled();
  });
});
