import { describe, expect, it, vi } from 'vitest';
import { registerInactivityModule } from '../src/modules/inactivity/index.js';
import type { BotContext } from '../src/types/context.js';
import type { Dependencies } from '../src/types/dependencies.js';
import { UserFacingError } from '../src/utils/errors.js';

type InactivityCommandHandler = (ctx: BotContext) => Promise<void>;

function createHarness(options: { enableChanged?: boolean; adminError?: Error } = {}) {
  let handler: InactivityCommandHandler | undefined;
  const reply = vi.fn().mockResolvedValue({ message_id: 1 });
  const requireAdmin = options.adminError
    ? vi.fn().mockRejectedValue(options.adminError)
    : vi.fn().mockResolvedValue(undefined);
  const requireBotRestrictionRights = vi.fn().mockResolvedValue(undefined);
  const settingsGet = vi.fn().mockResolvedValue({
    inactivityCleanupEnabled: true,
    inactivityTrackingStartedAt: new Date('2026-07-12T08:00:00.000Z'),
    inactivityLastSweepAt: new Date('2026-07-12T08:00:00.000Z'),
    timezone: 'Europe/Berlin',
  });
  const settingsInvalidate = vi.fn().mockResolvedValue(undefined);
  const settingsUpdate = vi.fn().mockResolvedValue({ id: 'settings' });
  const settingsUpdateMany = vi
    .fn()
    .mockResolvedValue({ count: options.enableChanged === false ? 0 : 1 });
  const memberUpdateMany = vi.fn().mockResolvedValue({ count: 4 });
  const memberCount = vi.fn().mockResolvedValue(12);
  const transactionClient = {
    groupSettings: { update: settingsUpdate, updateMany: settingsUpdateMany },
    groupMember: { updateMany: memberUpdateMany },
  };
  const databaseTransaction = vi.fn(
    async (callback: (transaction: typeof transactionClient) => Promise<unknown>) =>
      callback(transactionClient),
  );
  const dependencies = {
    bot: {
      command: vi.fn((command: string, callback: InactivityCommandHandler) => {
        expect(command).toBe('inaktiv');
        handler = callback;
      }),
    },
    database: {
      $transaction: databaseTransaction,
      groupMember: { count: memberCount },
    },
    permissions: { requireAdmin, requireBotRestrictionRights },
    settings: { get: settingsGet, invalidate: settingsInvalidate },
  } as unknown as Dependencies;
  registerInactivityModule(dependencies);

  const run = async (text: string): Promise<void> => {
    if (!handler) throw new Error('Inaktivitäts-Handler wurde nicht registriert');
    await handler({
      group: { id: 'group-db-id', telegramId: -100123n, title: 'Testgruppe' },
      locale: 'de',
      from: { id: 42, is_bot: false, first_name: 'Admin' },
      message: {
        message_id: 10,
        date: 1_783_843_200,
        chat: { id: -100123, type: 'supergroup', title: 'Testgruppe' },
        from: { id: 42, is_bot: false, first_name: 'Admin' },
        text,
      },
      reply,
    } as unknown as BotContext);
  };

  return {
    databaseTransaction,
    memberCount,
    memberUpdateMany,
    reply,
    requireAdmin,
    requireBotRestrictionRights,
    run,
    settingsGet,
    settingsInvalidate,
    settingsUpdate,
    settingsUpdateMany,
  };
}

describe('/inaktiv', () => {
  it.each(['/inaktiv', '/inaktiv status'])(
    'zeigt als Admin den sicheren Status für %s',
    async (command) => {
      const harness = createHarness();

      await harness.run(command);

      expect(harness.requireAdmin).toHaveBeenCalledOnce();
      expect(harness.settingsGet).toHaveBeenCalledWith('group-db-id');
      expect(harness.memberCount).toHaveBeenCalledWith({
        where: {
          groupId: 'group-db-id',
          deletedAt: null,
          inactivityBannedAt: null,
        },
      });
      expect(harness.reply).toHaveBeenCalledWith(
        expect.stringMatching(
          /Bekannte Mitglieder: 12[\s\S]*7 Tagen[\s\S]*24 Stunden[\s\S]*Telegram-Admins/u,
        ),
        { parse_mode: 'HTML' },
      );
      expect(harness.databaseTransaction).not.toHaveBeenCalled();
    },
  );

  it.each(['an', 'on', 'ein'])(
    'aktiviert mit /inaktiv %s und setzt eine atomare Baseline',
    async (argument) => {
      const harness = createHarness();

      await harness.run(`/inaktiv ${argument}`);

      expect(harness.requireBotRestrictionRights).toHaveBeenCalledOnce();
      expect(harness.databaseTransaction).toHaveBeenCalledOnce();
      expect(harness.settingsUpdateMany).toHaveBeenCalledWith({
        where: { groupId: 'group-db-id', inactivityCleanupEnabled: false },
        data: {
          inactivityCleanupEnabled: true,
          inactivityTrackingStartedAt: expect.any(Date) as Date,
          inactivityLastSweepAt: expect.any(Date) as Date,
        },
      });
      const firstSettingsCall = harness.settingsUpdateMany.mock.calls[0]?.[0] as
        | {
            data: {
              inactivityTrackingStartedAt: Date;
              inactivityLastSweepAt: Date;
            };
          }
        | undefined;
      if (!firstSettingsCall) throw new Error('Settings-Baseline wurde nicht geschrieben');
      const settingsData = firstSettingsCall.data;
      expect(settingsData.inactivityLastSweepAt).toBe(settingsData.inactivityTrackingStartedAt);
      expect(harness.memberUpdateMany).toHaveBeenNthCalledWith(1, {
        where: {
          groupId: 'group-db-id',
          inactivityRemovalStartedAt: null,
          inactivityBannedAt: null,
        },
        data: {
          lastSeenAt: settingsData.inactivityTrackingStartedAt,
          inactivityWarnedAt: null,
          inactivityKickDueAt: null,
        },
      });
      expect(harness.memberUpdateMany).toHaveBeenCalledOnce();
      expect(harness.settingsInvalidate).toHaveBeenCalledWith('group-db-id');
      expect(harness.reply).toHaveBeenCalledWith(expect.stringContaining('Beobachtungsphase'));
    },
  );

  it('setzt eine bereits aktive Bereinigung nicht erneut zurück', async () => {
    const harness = createHarness({ enableChanged: false });

    await harness.run('/inaktiv an');

    expect(harness.settingsUpdateMany).toHaveBeenCalledOnce();
    expect(harness.memberUpdateMany).not.toHaveBeenCalled();
    expect(harness.settingsInvalidate).toHaveBeenCalledWith('group-db-id');
    expect(harness.reply).toHaveBeenCalledWith(expect.stringContaining('bereits aktiv'));
  });

  it.each(['aus', 'off'])(
    'schaltet mit /inaktiv %s aus, ohne Recovery-Token zu löschen',
    async (argument) => {
      const harness = createHarness();

      await harness.run(`/inaktiv ${argument}`);

      expect(harness.requireBotRestrictionRights).not.toHaveBeenCalled();
      expect(harness.settingsUpdate).toHaveBeenCalledWith({
        where: { groupId: 'group-db-id' },
        data: { inactivityCleanupEnabled: false },
      });
      expect(harness.memberUpdateMany).toHaveBeenNthCalledWith(1, {
        where: {
          groupId: 'group-db-id',
          inactivityRemovalStartedAt: null,
          inactivityBannedAt: null,
        },
        data: {
          inactivityWarnedAt: null,
          inactivityKickDueAt: null,
        },
      });
      expect(harness.memberUpdateMany).toHaveBeenCalledOnce();
      for (const [input] of harness.memberUpdateMany.mock.calls) {
        const call = input as { data: Record<string, unknown> };
        expect(call.data).not.toHaveProperty('lastSeenAt');
        expect(call.data).not.toHaveProperty('inactivityRemovalStartedAt');
        expect(call.data).not.toHaveProperty('inactivityBannedAt');
      }
      expect(harness.settingsInvalidate).toHaveBeenCalledWith('group-db-id');
    },
  );

  it('führt ohne Adminrechte keine Datenbankaktion aus', async () => {
    const denied = new Error('kein Admin');
    const harness = createHarness({ adminError: denied });

    await expect(harness.run('/inaktiv an')).rejects.toBe(denied);

    expect(harness.requireBotRestrictionRights).not.toHaveBeenCalled();
    expect(harness.databaseTransaction).not.toHaveBeenCalled();
  });

  it('weist unbekannte Argumente mit einem Benutzerfehler zurück', async () => {
    const harness = createHarness();

    await expect(harness.run('/inaktiv vielleicht')).rejects.toBeInstanceOf(UserFacingError);
    expect(harness.databaseTransaction).not.toHaveBeenCalled();
  });
});
