import type { Message, User as TelegramUser } from 'grammy/types';
import { describe, expect, it, vi } from 'vitest';
import { ensureMember } from '../src/database/repositories.js';
import {
  isUserActivityMessage,
  memberActivityMiddleware,
} from '../src/middleware/member-activity.js';
import { registerWelcomeModule } from '../src/modules/welcome/index.js';
import type { BotContext } from '../src/types/context.js';
import type { Dependencies } from '../src/types/dependencies.js';

function createHarness() {
  const userUpsert = vi.fn(({ where }: { where: { telegramId: bigint } }) =>
    Promise.resolve({
      id: `user-${where.telegramId}`,
      telegramId: where.telegramId,
    }),
  );
  const groupMemberUpsert = vi.fn().mockResolvedValue({ id: 'member' });
  const groupMemberUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const loggerWarn = vi.fn();
  const database = {
    user: { upsert: userUpsert },
    groupMember: { upsert: groupMemberUpsert, updateMany: groupMemberUpdateMany },
  };
  const redisEval = vi.fn().mockResolvedValue(1);
  return {
    database,
    dependencies: {
      database,
      redis: { eval: redisEval },
      logger: { warn: loggerWarn },
    } as unknown as Dependencies,
    groupMemberUpdateMany,
    groupMemberUpsert,
    loggerWarn,
    redisEval,
    userUpsert,
  };
}

const group = { id: 'group-1', telegramId: -100123n, title: 'Testgruppe' };
const ada: TelegramUser = { id: 42, is_bot: false, first_name: 'Ada' };

describe('Mitgliederaktivität', () => {
  it('löscht beim Erfassen normaler Aktivität den offenen Warnstatus', async () => {
    const { database, groupMemberUpdateMany, groupMemberUpsert } = createHarness();
    const occurredAt = new Date('2026-07-12T01:02:03.000Z');

    await ensureMember(database as never, group.id, ada, occurredAt);

    expect(groupMemberUpsert).toHaveBeenCalledWith({
      where: { groupId_userId: { groupId: group.id, userId: 'user-42' } },
      create: {
        groupId: group.id,
        userId: 'user-42',
        lastSeenAt: occurredAt,
        inactivityWarnedAt: null,
        inactivityKickDueAt: null,
        inactivityRemovalStartedAt: null,
        inactivityBannedAt: null,
      },
      update: {},
    });
    expect(groupMemberUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'member',
        lastSeenAt: { lte: occurredAt },
        inactivityRemovalStartedAt: null,
        inactivityBannedAt: null,
        OR: [{ deletedAt: null }, { deletedAt: { lte: occurredAt } }],
      },
      data: {
        lastSeenAt: occurredAt,
        deletedAt: null,
        inactivityWarnedAt: null,
        inactivityKickDueAt: null,
      },
    });
  });

  it('bewahrt einen laufenden Removal-Recovery-Token bei neuer Aktivität', async () => {
    const removalStartedAt = new Date('2026-07-12T01:00:00.000Z');
    const occurredAt = new Date('2026-07-12T01:02:03.000Z');
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    const database = {
      user: {
        upsert: vi.fn().mockResolvedValue({ id: 'user-42', telegramId: 42n }),
      },
      groupMember: {
        upsert: vi.fn().mockResolvedValue({
          id: 'member',
          lastSeenAt: new Date('2026-07-05T01:00:00.000Z'),
          inactivityRemovalStartedAt: removalStartedAt,
          inactivityBannedAt: null,
        }),
        updateMany,
      },
    };

    await ensureMember(database as never, group.id, ada, occurredAt);

    expect(updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'member',
        lastSeenAt: { lte: occurredAt },
        OR: [{ inactivityRemovalStartedAt: { not: null } }, { inactivityBannedAt: { not: null } }],
      },
      data: {
        lastSeenAt: occurredAt,
        inactivityWarnedAt: null,
        inactivityKickDueAt: null,
      },
    });
    const recoveryUpdate = updateMany.mock.calls[1]?.[0] as
      { data: Record<string, unknown> } | undefined;
    expect(recoveryUpdate?.data).not.toHaveProperty('inactivityRemovalStartedAt');
    expect(recoveryUpdate?.data).not.toHaveProperty('inactivityBannedAt');
    expect(recoveryUpdate?.data).not.toHaveProperty('deletedAt');
  });

  it('überschreibt einen neueren Aktivitätszeitpunkt nicht mit einem verspäteten Update', async () => {
    const newer = new Date('2026-07-12T02:00:00.000Z');
    const delayed = new Date('2026-07-12T01:00:00.000Z');
    const database = {
      user: {
        upsert: vi.fn().mockResolvedValue({ id: 'user-42', telegramId: 42n }),
      },
      groupMember: {
        upsert: vi.fn().mockResolvedValue({ id: 'member', lastSeenAt: newer, deletedAt: null }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const result = await ensureMember(database as never, group.id, ada, delayed);

    expect(database.groupMember.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ lastSeenAt: { lte: delayed } }) as unknown,
      }),
    );
    expect(result.member.lastSeenAt).toEqual(newer);
  });

  it.each([
    ['Text und Commands', { text: '/help' }],
    ['formatierte Nachricht', { rich_message: {} }],
    ['Foto', { photo: [] }],
    ['Live-Foto', { live_photo: {} }],
    ['Dokument', { document: {} }],
    ['Sticker', { sticker: {} }],
    ['Video', { video: {} }],
    ['Sprachnachricht', { voice: {} }],
    ['Audio', { audio: {} }],
    ['Umfrage', { poll: {} }],
    ['Standort', { location: {} }],
  ])('erkennt %s als echte Aktivität', (_label, content) => {
    expect(isUserActivityMessage(content as unknown as Message)).toBe(true);
  });

  it.each([
    ['Beitritt', { new_chat_members: [ada] }],
    ['Austritt', { left_chat_member: ada }],
    ['angeheftete Nachricht', { pinned_message: {} }],
    ['neuer Gruppenname', { new_chat_title: 'Neu' }],
    ['neues Forum-Thema', { forum_topic_created: {} }],
    ['Web-App-Daten', { web_app_data: {} }],
  ])('wertet die Service-Nachricht „%s“ nicht als Aktivität des Absenders', (_label, content) => {
    expect(isUserActivityMessage(content as unknown as Message)).toBe(false);
  });

  it('verwendet bei normalen Nachrichten die Telegram-Zeit und ruft danach weitere Handler auf', async () => {
    const { dependencies, groupMemberUpdateMany } = createHarness();
    const next = vi.fn().mockResolvedValue(undefined);
    const telegramTimestamp = 1_783_817_323;
    const ctx = {
      group,
      from: ada,
      message: { date: telegramTimestamp, text: 'Hallo' },
    } as unknown as BotContext;

    await memberActivityMiddleware(dependencies)(ctx, next);

    expect(groupMemberUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastSeenAt: new Date(telegramTimestamp * 1_000),
          inactivityKickDueAt: null,
        }) as unknown,
      }),
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('schreibt den Redis-Sicherheitsmarker vor dem DB-Tracking', async () => {
    const { dependencies, groupMemberUpsert, redisEval } = createHarness();
    const next = vi.fn().mockResolvedValue(undefined);
    const telegramTimestamp = 1_783_817_323;
    groupMemberUpsert.mockRejectedValueOnce(new Error('PostgreSQL nicht erreichbar'));
    const ctx = {
      group,
      from: ada,
      message: { date: telegramTimestamp, text: 'Ich bin aktiv' },
    } as unknown as BotContext;

    await expect(memberActivityMiddleware(dependencies)(ctx, next)).rejects.toThrow(
      'PostgreSQL nicht erreichbar',
    );

    expect(redisEval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      'inactivity-activity:group-1:42',
      String(telegramTimestamp * 1_000),
      expect.any(String),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('speichert Aktivität in PostgreSQL, wenn der Redis-Marker ausfällt', async () => {
    const { dependencies, groupMemberUpdateMany, loggerWarn, redisEval } = createHarness();
    const next = vi.fn().mockResolvedValue(undefined);
    const telegramTimestamp = 1_783_817_323;
    redisEval.mockRejectedValueOnce(new Error('Redis nicht erreichbar'));
    const ctx = {
      group,
      from: ada,
      message: { date: telegramTimestamp, text: 'Ich bin weiterhin aktiv' },
    } as unknown as BotContext;

    await memberActivityMiddleware(dependencies)(ctx, next);

    expect(groupMemberUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastSeenAt: new Date(telegramTimestamp * 1_000),
          inactivityKickDueAt: null,
        }) as unknown,
      }),
    );
    expect(loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: group.id, telegramId: ada.id }),
      expect.stringContaining('PostgreSQL-Aktivität wurde gespeichert'),
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('ignoriert Nachrichten von Bots und anonymen Service-Absendern', async () => {
    const { dependencies, groupMemberUpsert } = createHarness();
    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      group,
      from: { id: 1087968824, is_bot: true, first_name: 'GroupAnonymousBot' },
      senderChat: { id: -100123, type: 'supergroup', title: 'Testgruppe' },
      message: { date: 1_783_817_323, text: 'Anonyme Admin-Nachricht' },
    } as unknown as BotContext;

    await memberActivityMiddleware(dependencies)(ctx, next);

    expect(groupMemberUpsert).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('speichert neue Mitglieder aus Service-Nachrichten, aber nicht den Einladenden', async () => {
    const { dependencies, groupMemberUpsert, userUpsert } = createHarness();
    const next = vi.fn().mockResolvedValue(undefined);
    const joined = { id: 99, is_bot: false, first_name: 'Neu' };
    const telegramTimestamp = 1_783_817_323;
    const ctx = {
      group,
      from: ada,
      message: { date: telegramTimestamp, new_chat_members: [joined] },
    } as unknown as BotContext;

    await memberActivityMiddleware(dependencies)(ctx, next);

    expect(userUpsert).toHaveBeenCalledOnce();
    expect(userUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { telegramId: 99n } }),
    );
    expect(groupMemberUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          lastSeenAt: new Date(telegramTimestamp * 1_000),
        }) as unknown,
      }),
    );
  });

  it('speichert neue Mitglieder im Welcome-Modul auch bei deaktivierter Begrüßung', async () => {
    const { database, groupMemberUpsert } = createHarness();
    let welcomeHandler: ((ctx: BotContext) => Promise<void>) | undefined;
    const bot = {
      on: vi.fn((trigger: string, handler: (ctx: BotContext) => Promise<void>) => {
        if (trigger === 'message:new_chat_members') welcomeHandler = handler;
      }),
      command: vi.fn(),
    };
    const settingsGet = vi.fn(() => {
      expect(groupMemberUpsert).toHaveBeenCalledOnce();
      return Promise.resolve({ welcomeEnabled: false });
    });
    const dependencies = {
      bot,
      database,
      settings: { get: settingsGet },
    } as unknown as Dependencies;
    registerWelcomeModule(dependencies);
    if (!welcomeHandler) throw new Error('Welcome-Handler wurde nicht registriert');
    const reply = vi.fn().mockResolvedValue({ message_id: 1 });
    const ctx = {
      group,
      message: {
        date: 1_783_817_323,
        new_chat_members: [{ id: 99, is_bot: false, first_name: 'Neu' }],
      },
      reply,
    } as unknown as BotContext;

    await welcomeHandler(ctx);

    expect(settingsGet).toHaveBeenCalledOnce();
    expect(reply).not.toHaveBeenCalled();
  });

  it('erfasst einen Beitritt aus chat_member mit dessen Telegram-Zeit', async () => {
    const { dependencies, groupMemberUpdateMany } = createHarness();
    const next = vi.fn().mockResolvedValue(undefined);
    const joined = { id: 99, is_bot: false, first_name: 'Neu' };
    const telegramTimestamp = 1_783_817_323;
    const ctx = {
      group,
      chatMember: {
        date: telegramTimestamp,
        old_chat_member: { status: 'left', user: joined },
        new_chat_member: { status: 'member', user: joined },
      },
    } as unknown as BotContext;

    await memberActivityMiddleware(dependencies)(ctx, next);

    expect(groupMemberUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastSeenAt: new Date(telegramTimestamp * 1_000),
        }) as unknown,
      }),
    );
  });

  it('baselinet auch eine PRESENT-Statusänderung wie eine Admin-Demotion', async () => {
    const { dependencies, groupMemberUpdateMany } = createHarness();
    const next = vi.fn().mockResolvedValue(undefined);
    const telegramTimestamp = 1_783_817_323;
    const ctx = {
      group,
      chatMember: {
        date: telegramTimestamp,
        old_chat_member: { status: 'administrator', user: ada },
        new_chat_member: { status: 'member', user: ada },
      },
    } as unknown as BotContext;

    await memberActivityMiddleware(dependencies)(ctx, next);

    expect(groupMemberUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastSeenAt: new Date(telegramTimestamp * 1_000),
          inactivityWarnedAt: null,
        }) as unknown,
      }),
    );
  });

  it('zählt eine reine Restriktionsänderung nicht als geschriebene Aktivität', async () => {
    const { dependencies, groupMemberUpsert, groupMemberUpdateMany } = createHarness();
    const next = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      group,
      chatMember: {
        date: 1_783_817_323,
        old_chat_member: { status: 'member', user: ada },
        new_chat_member: { status: 'restricted', is_member: true, user: ada },
      },
    } as unknown as BotContext;

    await memberActivityMiddleware(dependencies)(ctx, next);

    expect(groupMemberUpsert).not.toHaveBeenCalled();
    expect(groupMemberUpdateMany).not.toHaveBeenCalled();
  });

  it('markiert einen Austritt aus chat_member, ohne ihn als Aktivität zu behandeln', async () => {
    const { dependencies, groupMemberUpdateMany, groupMemberUpsert } = createHarness();
    const next = vi.fn().mockResolvedValue(undefined);
    const telegramTimestamp = 1_783_817_323;
    const ctx = {
      group,
      chatMember: {
        date: telegramTimestamp,
        old_chat_member: { status: 'member', user: ada },
        new_chat_member: { status: 'left', user: ada },
      },
    } as unknown as BotContext;

    await memberActivityMiddleware(dependencies)(ctx, next);

    expect(groupMemberUpsert).not.toHaveBeenCalled();
    expect(groupMemberUpdateMany).toHaveBeenNthCalledWith(1, {
      where: { groupId: group.id, user: { telegramId: 42n } },
      data: { deletedAt: new Date(telegramTimestamp * 1_000) },
    });
    expect(groupMemberUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        groupId: group.id,
        user: { telegramId: 42n },
        inactivityRemovalStartedAt: null,
        inactivityBannedAt: null,
      },
      data: {
        inactivityWarnedAt: null,
        inactivityKickDueAt: null,
      },
    });
  });
});
