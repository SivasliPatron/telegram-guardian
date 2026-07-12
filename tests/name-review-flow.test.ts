import { describe, expect, it, vi } from 'vitest';
import { NameReviewContext, NameReviewStatus } from '../src/generated/prisma/enums.js';
import {
  formatNameReviewMessage,
  nameReviewCallbackData,
  nameReviewKeyboard,
  parseNameReviewCallback,
  registerNameReviewModule,
  requestNameReview,
} from '../src/modules/name-review/index.js';
import type { BotContext } from '../src/types/context.js';
import type { Dependencies } from '../src/types/dependencies.js';

type CallbackHandler = (ctx: BotContext) => Promise<void>;

function reviewRecord(context: NameReviewContext) {
  return {
    id: 'namereview123',
    groupId: 'group-db-id',
    targetUserId: 'target-db-id',
    reviewedById: null as string | null,
    context,
    displayName: 'Max A.F.D',
    normalizedName: 'max a.f.d',
    candidatePattern: 'afd',
    source: 'preset',
    reason: 'Möglicher Regelverstoß',
    confidence: null,
    requestUserChatId: context === NameReviewContext.JOIN_REQUEST ? 12345n : null,
    reviewMessageId: 501n as bigint | null,
    status: NameReviewStatus.PENDING,
    expiresAt: new Date(Date.now() + 60_000),
    reviewedAt: null as Date | null,
    enforcedAt: null as Date | null,
    group: { id: 'group-db-id', telegramId: -100123n, title: 'Testgruppe' },
    targetUser: {
      id: 'target-db-id',
      telegramId: 99n,
      firstName: 'Max A.F.D',
      lastName: null,
      username: null,
    },
  };
}

function callbackHarness(context: NameReviewContext) {
  let handler: CallbackHandler | undefined;
  const review = reviewRecord(context);
  const callbackQuery = vi.fn(
    (_pattern: RegExp, callback: CallbackHandler) => void (handler = callback),
  );
  const nameReviewUpdateMany = vi.fn(
    (input: {
      where: { status?: NameReviewStatus; enforcedAt?: null; reviewMessageId?: bigint };
      data: Partial<typeof review>;
    }) => {
      if (input.where.status && review.status !== input.where.status) return { count: 0 };
      if ('enforcedAt' in input.where && review.enforcedAt !== input.where.enforcedAt) {
        return { count: 0 };
      }
      if (
        input.where.reviewMessageId !== undefined &&
        review.reviewMessageId !== input.where.reviewMessageId
      ) {
        return { count: 0 };
      }
      Object.assign(review, input.data);
      return { count: 1 };
    },
  );
  const allowedNameUpsert = vi
    .fn<(input: unknown) => Promise<{ id: string }>>()
    .mockResolvedValue({ id: 'allowed-1' });
  const forbiddenNameUpsert = vi
    .fn<(input: unknown) => Promise<{ id: string }>>()
    .mockResolvedValue({ id: 'forbidden-1' });
  const moderationActionCreate = vi.fn().mockResolvedValue({ id: 'action-1' });
  const groupMemberUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const transactionClient = {
    nameReview: { updateMany: nameReviewUpdateMany },
    allowedName: { upsert: allowedNameUpsert },
    forbiddenName: { upsert: forbiddenNameUpsert },
    moderationAction: { create: moderationActionCreate },
  };
  const runTransaction = vi.fn((operation: unknown) => {
    if (typeof operation === 'function') {
      return (operation as (client: typeof transactionClient) => Promise<unknown>)(
        transactionClient,
      );
    }
    return Promise.all(operation as Promise<unknown>[]);
  });
  const getChatMember = vi.fn((_chatId: string, userId: number) =>
    Promise.resolve({ status: userId === 7 ? 'administrator' : 'member' }),
  );
  const approveChatJoinRequest = vi.fn().mockResolvedValue(true);
  const declineChatJoinRequest = vi.fn().mockResolvedValue(true);
  const banChatMember = vi.fn().mockResolvedValue(true);
  const unbanChatMember = vi.fn().mockResolvedValue(true);
  const sendMessage = vi.fn().mockResolvedValue({ message_id: 900 });
  const redisDel = vi.fn().mockResolvedValue(1);
  const dependencies = {
    bot: {
      callbackQuery,
      api: {
        approveChatJoinRequest,
        declineChatJoinRequest,
        banChatMember,
        unbanChatMember,
        getChatMember,
        sendMessage,
      },
    },
    env: { OWNER_TELEGRAM_ID: '999999' },
    database: {
      nameReview: {
        findUnique: vi.fn().mockImplementation(() => Promise.resolve(review)),
        updateMany: nameReviewUpdateMany,
      },
      user: {
        upsert: vi.fn().mockResolvedValue({
          id: 'admin-db-id',
          telegramId: 7n,
          firstName: 'Admin',
          lastName: 'Ada',
          username: null,
        }),
      },
      allowedName: { upsert: allowedNameUpsert },
      forbiddenName: { upsert: forbiddenNameUpsert },
      moderationAction: {
        create: moderationActionCreate,
        findFirst: vi.fn().mockResolvedValue(null),
      },
      groupMember: { updateMany: groupMemberUpdateMany },
      groupSettings: {
        findUnique: vi.fn().mockResolvedValue({
          language: 'de',
          nameProtectionMessage: 'Ändere deinen Namen.',
        }),
      },
      $transaction: runTransaction,
    },
    redis: { set: vi.fn().mockResolvedValue('OK'), del: redisDel },
    permissions: {
      requireBotInviteRights: vi.fn().mockResolvedValue(undefined),
      requireBotRestrictionRights: vi.fn().mockResolvedValue(undefined),
      requireUnprotectedTarget: vi.fn().mockResolvedValue(undefined),
    },
    adminLog: { send: vi.fn().mockResolvedValue(undefined) },
    logger: { error: vi.fn(), warn: vi.fn() },
  } as unknown as Dependencies;
  registerNameReviewModule(dependencies);

  function callbackContext(decision: 'allow' | 'forbid') {
    const answerCallbackQuery = vi.fn().mockResolvedValue(true);
    const editMessageText = vi.fn().mockImplementation(() => {
      review.reviewMessageId = null;
      return Promise.resolve(true);
    });
    return {
      context: {
        group: { id: 'group-db-id', telegramId: -100123n, title: 'Testgruppe' },
        locale: 'de',
        from: { id: 7, is_bot: false, first_name: 'Admin', last_name: 'Ada' },
        callbackQuery: {
          data: nameReviewCallbackData(decision, review.id),
          message: { message_id: 501, text: 'Namensprüfung' },
        },
        api: { getChatMember },
        answerCallbackQuery,
        editMessageText,
      } as unknown as BotContext,
      answerCallbackQuery,
      editMessageText,
    };
  }

  return {
    dependencies,
    review,
    handler: () => {
      if (!handler) throw new Error('Callback-Handler fehlt');
      return handler;
    },
    callbackContext,
    allowedNameUpsert,
    forbiddenNameUpsert,
    moderationActionCreate,
    approveChatJoinRequest,
    declineChatJoinRequest,
    banChatMember,
    unbanChatMember,
    sendMessage,
  };
}

describe('Admin-Prüfung für sichtbare Namen', () => {
  it('erzeugt genau die beiden gewünschten Buttons mit sicheren Callback-Daten', () => {
    const allow = nameReviewCallbackData('allow', 'cm123');
    const forbid = nameReviewCallbackData('forbid', 'cm123');
    expect(parseNameReviewCallback(allow)).toEqual({ decision: 'allow', reviewId: 'cm123' });
    expect(parseNameReviewCallback(forbid)).toEqual({ decision: 'forbid', reviewId: 'cm123' });
    expect(parseNameReviewCallback('nr:f:../fremd')).toBeNull();
    expect(nameReviewKeyboard('cm123').inline_keyboard).toEqual([
      [
        { text: '✅ Erlaubt', callback_data: 'nr:a:cm123' },
        { text: '🚫 Nicht erlaubt', callback_data: 'nr:f:cm123' },
      ],
    ]);
  });

  it('erklärt, dass vor der Admin-Entscheidung noch keine Entfernung erfolgt', () => {
    const text = formatNameReviewMessage({
      user: '<Max>',
      visibleName: 'Max <Test>',
      candidatePattern: '<Test>',
      reason: 'Möglicher Treffer',
      joinRequest: false,
    });
    expect(text).toContain('&lt;Max&gt;');
    expect(text).toContain('Max &lt;Test&gt;');
    expect(text).toContain('&lt;Test&gt;');
    expect(text).toContain('bleibt bis zu eurer Entscheidung');
  });

  it('erstellt beim ersten Treffer nur eine markierte Prüfung ohne Filter oder Kick', async () => {
    const nameReviewCreate = vi.fn().mockResolvedValue({ id: 'created-review' });
    const nameReviewUpdate = vi.fn().mockResolvedValue({ id: 'created-review' });
    const reply = vi.fn().mockResolvedValue({ message_id: 501 });
    const banChatMember = vi.fn();
    const forbiddenNameUpsert = vi.fn();
    const dependencies = {
      database: {
        user: {
          upsert: vi.fn().mockResolvedValue({ id: 'target-db-id', telegramId: 99n }),
        },
        nameReview: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: nameReviewCreate,
          update: nameReviewUpdate,
          updateMany: vi.fn(),
        },
        forbiddenName: { upsert: forbiddenNameUpsert },
      },
      redis: {
        set: vi.fn().mockResolvedValue('OK'),
        del: vi.fn().mockResolvedValue(1),
      },
      adminLog: { send: vi.fn().mockResolvedValue(undefined) },
      logger: { warn: vi.fn() },
      bot: { api: { banChatMember } },
    } as unknown as Dependencies;
    const context = {
      group: { id: 'group-db-id', telegramId: -100123n, title: 'Testgruppe' },
      api: {
        getChatAdministrators: vi.fn().mockResolvedValue([
          {
            status: 'creator',
            user: { id: 7, is_bot: false, first_name: 'Admin', last_name: 'Ada' },
          },
        ]),
        deleteMessage: vi.fn(),
      },
      reply,
    } as unknown as BotContext;

    await requestNameReview(dependencies, context, {
      user: { id: 99, is_bot: false, first_name: 'Max', last_name: 'A.F.D' },
      context: NameReviewContext.MEMBER,
      candidate: {
        pattern: 'afd',
        source: 'preset',
        reason: 'Möglicher Regelverstoß',
      },
    });

    expect(nameReviewCreate).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledOnce();
    expect(reply.mock.calls[0]?.[0]).toContain('tg://user?id=7');
    expect(forbiddenNameUpsert).not.toHaveBeenCalled();
    expect(banChatMember).not.toHaveBeenCalled();
  });

  it('speichert bei Erlaubt die Ausnahme und nimmt eine Beitrittsanfrage an', async () => {
    const harness = callbackHarness(NameReviewContext.JOIN_REQUEST);
    const callback = harness.callbackContext('allow');

    await harness.handler()(callback.context);

    expect(harness.review.status).toBe(NameReviewStatus.ALLOWED);
    expect(harness.allowedNameUpsert).toHaveBeenCalledOnce();
    expect(harness.forbiddenNameUpsert).not.toHaveBeenCalled();
    expect(harness.approveChatJoinRequest).toHaveBeenCalledWith('-100123', 99);
    expect(harness.banChatMember).not.toHaveBeenCalled();
    expect(callback.editMessageText.mock.calls[0]?.[0]).toContain('Erlaubt');
  });

  it('speichert bei Nicht erlaubt den Filter und entfernt erst danach das Mitglied', async () => {
    const harness = callbackHarness(NameReviewContext.MEMBER);
    const callback = harness.callbackContext('forbid');

    await harness.handler()(callback.context);

    expect(harness.review.status).toBe(NameReviewStatus.FORBIDDEN);
    const filterInput = harness.forbiddenNameUpsert.mock.calls[0]?.[0] as
      { create: { pattern: string } } | undefined;
    expect(filterInput?.create.pattern).toBe('afd');
    expect(harness.allowedNameUpsert).not.toHaveBeenCalled();
    expect(harness.sendMessage).toHaveBeenCalled();
    expect(harness.banChatMember).toHaveBeenCalledOnce();
    expect(harness.unbanChatMember).toHaveBeenCalledOnce();
    expect(harness.moderationActionCreate).toHaveBeenCalledTimes(2);
    expect(callback.editMessageText.mock.calls[0]?.[0]).toContain('Nicht erlaubt');
  });

  it('lässt einen alten Prüffall für den neutralen Namen Türk nicht sperren', async () => {
    const harness = callbackHarness(NameReviewContext.MEMBER);
    harness.review.displayName = 'Türk';
    harness.review.normalizedName = 'türk';
    harness.review.candidatePattern = 'Türk';
    const callback = harness.callbackContext('forbid');

    await harness.handler()(callback.context);

    expect(harness.review.status).toBe(NameReviewStatus.PENDING);
    expect(harness.forbiddenNameUpsert).not.toHaveBeenCalled();
    expect(harness.banChatMember).not.toHaveBeenCalled();
    expect(callback.answerCallbackQuery).toHaveBeenCalledWith({
      text: 'Dieser neutrale Name darf nicht gesperrt werden.',
      show_alert: true,
    });
  });
});
