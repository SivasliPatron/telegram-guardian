import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from 'grammy';
import type { Logger } from 'pino';
import { InternalRole } from '../src/generated/prisma/enums.js';
import type { Database } from '../src/database/client.js';
import type { RedisClient } from '../src/services/redis.js';
import type { AdminLogService } from '../src/services/admin-log.js';
import { activityMarkerKey } from '../src/services/activity-marker.js';
import {
  INACTIVITY_DAYS,
  INACTIVITY_GRACE_HOURS,
  INACTIVITY_MAX_KICKS_PER_UTC_DAY,
  INACTIVITY_MAX_MENTIONS_PER_MESSAGE,
  INACTIVITY_MAX_WARNINGS_PER_UTC_DAY,
  INACTIVITY_STARTUP_GRACE_MINUTES,
  InactivityCleanupService,
} from '../src/services/inactivity-cleanup.js';

const NOW = new Date('2026-07-12T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1_000;

interface TestUser {
  id: string;
  telegramId: bigint;
  firstName: string;
  lastName: string | null;
}

interface TestMember {
  id: string;
  groupId: string;
  userId: string;
  user: TestUser;
  role: InternalRole;
  joinedAt: Date;
  lastSeenAt: Date;
  mutedUntil: Date | null;
  deletedAt: Date | null;
  inactivityWarnedAt: Date | null;
  inactivityKickDueAt: Date | null;
  inactivityRemovalStartedAt: Date | null;
  inactivityBannedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TestSettings {
  id: string;
  groupId: string;
  inactivityCleanupEnabled: boolean;
  inactivityTrackingStartedAt: Date | null;
  inactivityLastSweepAt: Date | null;
  group: {
    id: string;
    telegramId: bigint;
    title: string;
    isActive: boolean;
  };
}

type LiveStatus =
  | 'member'
  | 'administrator'
  | 'creator'
  | 'left'
  | 'kicked'
  | 'restricted-present'
  | 'restricted-absent'
  | 'bot';

interface HarnessOptions {
  settings?: Partial<TestSettings>;
  members?: TestMember[];
  ownerTelegramId?: bigint;
  botCanRestrict?: boolean;
  liveStatuses?: Readonly<Record<string, LiveStatus>>;
  initialDailyCounts?: Readonly<Record<string, number>>;
  failKickClaim?: boolean;
  failPersistBannedAt?: boolean;
  activityMarkers?: Readonly<Record<string, number>>;
  activityDuringBan?: boolean;
  newActionsAllowedAt?: Date | null;
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function member(
  id: string,
  telegramId: bigint,
  overrides: Partial<Omit<TestMember, 'id' | 'userId' | 'user'>> & {
    user?: Partial<TestUser>;
  } = {},
): TestMember {
  const userId = `user-${id}`;
  const { user: userOverrides, ...memberOverrides } = overrides;
  return {
    id,
    groupId: 'group-1',
    userId,
    user: {
      id: userOverrides?.id ?? userId,
      telegramId: userOverrides?.telegramId ?? telegramId,
      firstName: userOverrides?.firstName ?? `Nutzer ${id}`,
      lastName: userOverrides?.lastName ?? null,
    },
    role: InternalRole.MEMBER,
    joinedAt: daysAgo(20),
    lastSeenAt: daysAgo(8),
    mutedUntil: null,
    deletedAt: null,
    inactivityWarnedAt: null,
    inactivityKickDueAt: null,
    inactivityRemovalStartedAt: null,
    inactivityBannedAt: null,
    createdAt: daysAgo(20),
    updatedAt: daysAgo(8),
    ...memberOverrides,
  };
}

function sameDate(left: unknown, right: Date | null): boolean {
  return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
}

function dateConditionMatches(value: Date | null, condition: unknown): boolean {
  if (condition === undefined) return true;
  if (condition === null) return value === null;
  if (condition instanceof Date) return sameDate(condition, value);
  if (typeof condition !== 'object') return true;
  const candidate = condition as { lte?: Date; not?: null };
  if (candidate.not === null && value === null) return false;
  if (candidate.lte && (!value || value.getTime() > candidate.lte.getTime())) return false;
  return true;
}

function createHarness(options: HarnessOptions = {}) {
  const settings: TestSettings = {
    id: 'settings-1',
    groupId: 'group-1',
    inactivityCleanupEnabled: true,
    inactivityTrackingStartedAt: daysAgo(10),
    inactivityLastSweepAt: new Date(NOW.getTime() - 60_000),
    group: { id: 'group-1', telegramId: -100123n, title: 'Testgruppe', isActive: true },
    ...options.settings,
  };
  const members = options.members ?? [];
  const liveStatuses = new Map(Object.entries(options.liveStatuses ?? {}));
  const locks = new Map<string, string>();
  const counters = new Map(Object.entries(options.initialDailyCounts ?? {}));
  const activityMarkers = new Map(Object.entries(options.activityMarkers ?? {}));
  const actions: Record<string, unknown>[] = [];

  const groupSettingsFindMany = vi
    .fn()
    .mockImplementation(() => Promise.resolve(settings.group.isActive ? [settings] : []));
  const groupSettingsUpdate = vi
    .fn()
    .mockImplementation((input: { data: Partial<TestSettings> }) => {
      Object.assign(settings, input.data);
      return Promise.resolve(settings);
    });
  const groupSettingsUpdateMany = vi
    .fn()
    .mockImplementation((input: { data: Partial<TestSettings> }) => {
      Object.assign(settings, input.data);
      return Promise.resolve({ count: 1 });
    });

  const groupMemberFindMany = vi
    .fn()
    .mockImplementation((input: { where: Record<string, unknown> }) => {
      const where = input.where;
      let result: TestMember[];
      if ('OR' in where) {
        result = members.filter(
          (entry) => entry.inactivityRemovalStartedAt !== null || entry.inactivityBannedAt !== null,
        );
      } else if (
        typeof where.inactivityKickDueAt === 'object' &&
        where.inactivityKickDueAt !== null &&
        'lte' in where.inactivityKickDueAt
      ) {
        result = members.filter(
          (entry) =>
            entry.groupId === where.groupId &&
            entry.role === InternalRole.MEMBER &&
            entry.deletedAt === null &&
            entry.inactivityWarnedAt !== null &&
            dateConditionMatches(entry.inactivityKickDueAt, where.inactivityKickDueAt) &&
            entry.inactivityRemovalStartedAt === null &&
            entry.inactivityBannedAt === null,
        );
      } else {
        result = members.filter(
          (entry) =>
            entry.groupId === where.groupId &&
            entry.role === InternalRole.MEMBER &&
            entry.deletedAt === null &&
            dateConditionMatches(entry.lastSeenAt, where.lastSeenAt) &&
            entry.inactivityWarnedAt === null &&
            entry.inactivityKickDueAt === null &&
            entry.inactivityRemovalStartedAt === null &&
            entry.inactivityBannedAt === null,
        );
      }
      return Promise.resolve(result.slice(0, 100));
    });

  const matchesMemberWhere = (entry: TestMember, where: Record<string, unknown>): boolean => {
    if (where.id !== undefined && entry.id !== where.id) return false;
    if (where.groupId !== undefined && entry.groupId !== where.groupId) return false;
    if (where.role !== undefined && entry.role !== where.role) return false;
    if (where.deletedAt === null && entry.deletedAt !== null) return false;
    for (const field of [
      'lastSeenAt',
      'inactivityWarnedAt',
      'inactivityKickDueAt',
      'inactivityRemovalStartedAt',
      'inactivityBannedAt',
    ] as const) {
      if (!dateConditionMatches(entry[field], where[field])) return false;
    }
    return true;
  };

  const groupMemberUpdateMany = vi
    .fn()
    .mockImplementation((input: { where: Record<string, unknown>; data: Partial<TestMember> }) => {
      if (
        options.failKickClaim &&
        input.data.inactivityRemovalStartedAt instanceof Date &&
        input.where.inactivityRemovalStartedAt === null
      ) {
        return Promise.resolve({ count: 0 });
      }
      if (
        options.failPersistBannedAt &&
        input.data.inactivityBannedAt instanceof Date &&
        input.where.inactivityBannedAt === null
      ) {
        options.failPersistBannedAt = false;
        return Promise.reject(new Error('PostgreSQL nicht erreichbar'));
      }
      const matching = members.filter((entry) => matchesMemberWhere(entry, input.where));
      for (const entry of matching) Object.assign(entry, input.data);
      return Promise.resolve({ count: matching.length });
    });
  const groupMemberUpdate = vi
    .fn()
    .mockImplementation((input: { where: { id: string }; data: Partial<TestMember> }) => {
      const found = members.find(({ id }) => id === input.where.id);
      if (!found) throw new Error('Mitglied fehlt');
      Object.assign(found, input.data);
      return Promise.resolve(found);
    });
  const groupMemberFindUnique = vi
    .fn()
    .mockImplementation((input: { where: { id: string } }) =>
      Promise.resolve(members.find(({ id }) => id === input.where.id) ?? null),
    );
  const moderationActionCreate = vi
    .fn()
    .mockImplementation((input: { data: Record<string, unknown> }) => {
      actions.push(input.data);
      return Promise.resolve({ id: `action-${actions.length}`, ...input.data });
    });

  const transactionClient = {
    groupMember: { updateMany: groupMemberUpdateMany },
    moderationAction: { create: moderationActionCreate },
  };
  const transaction = vi.fn().mockImplementation((operation: unknown) => {
    if (typeof operation === 'function') {
      return (operation as (client: typeof transactionClient) => Promise<unknown>)(
        transactionClient,
      );
    }
    return Promise.all(operation as Promise<unknown>[]);
  });

  const database = {
    groupSettings: {
      findMany: groupSettingsFindMany,
      update: groupSettingsUpdate,
      updateMany: groupSettingsUpdateMany,
    },
    groupMember: {
      findMany: groupMemberFindMany,
      findUnique: groupMemberFindUnique,
      update: groupMemberUpdate,
      updateMany: groupMemberUpdateMany,
    },
    moderationAction: { create: moderationActionCreate },
    $transaction: transaction,
  } as unknown as Database;

  const redisSet = vi.fn().mockImplementation((key: string, value: string) => {
    if (locks.has(key)) return Promise.resolve(null);
    locks.set(key, value);
    return Promise.resolve('OK');
  });
  const redisDel = vi.fn().mockImplementation((key: string) => {
    locks.delete(key);
    return Promise.resolve(1);
  });
  const redisEval = vi
    .fn()
    .mockImplementation((_script: string, _keys: number, key: string, token: string) => {
      if (locks.get(key) !== token) return Promise.resolve(0);
      locks.delete(key);
      return Promise.resolve(1);
    });
  const redisIncr = vi.fn().mockImplementation((key: string) => {
    const next = (counters.get(key) ?? 0) + 1;
    counters.set(key, next);
    return Promise.resolve(next);
  });
  const decrementCounter = (key: string, count: number): Promise<number> => {
    const next = (counters.get(key) ?? 0) - count;
    counters.set(key, next);
    return Promise.resolve(next);
  };
  const redisDecrby = vi.fn(decrementCounter);
  const redisDecr = vi.fn((key: string): Promise<number> => decrementCounter(key, 1));
  const redis = {
    set: redisSet,
    del: redisDel,
    eval: redisEval,
    get: vi.fn((key: string): Promise<string | null> => {
      const value = activityMarkers.get(key);
      return Promise.resolve(value === undefined ? null : String(value));
    }),
    incr: redisIncr,
    decr: redisDecr,
    decrby: redisDecrby,
    expire: vi.fn().mockResolvedValue(1),
  } as unknown as RedisClient;

  const getMe = vi.fn().mockResolvedValue({ id: 999, is_bot: true, first_name: 'Guardian' });
  const getChatMember = vi.fn().mockImplementation((_chatId: string, telegramId: number) => {
    if (telegramId === 999) {
      return Promise.resolve(
        options.botCanRestrict === false
          ? {
              status: 'administrator',
              can_restrict_members: false,
              user: { id: 999, is_bot: true, first_name: 'Guardian' },
            }
          : {
              status: 'administrator',
              can_restrict_members: true,
              user: { id: 999, is_bot: true, first_name: 'Guardian' },
            },
      );
    }
    const status = liveStatuses.get(String(telegramId)) ?? 'member';
    const user = {
      id: telegramId,
      is_bot: status === 'bot',
      first_name: `Telegram ${telegramId}`,
    };
    if (status === 'restricted-present' || status === 'restricted-absent') {
      return Promise.resolve({
        status: 'restricted',
        is_member: status === 'restricted-present',
        user,
      });
    }
    return Promise.resolve({ status: status === 'bot' ? 'member' : status, user });
  });
  const sendMessage = vi.fn().mockResolvedValue({ message_id: 500 });
  const banChatMember = vi.fn().mockImplementation((_chatId: string, telegramId: number) => {
    if (options.activityDuringBan) {
      activityMarkers.set(activityMarkerKey('group-1', BigInt(telegramId)), NOW.getTime());
    }
    liveStatuses.set(String(telegramId), 'kicked');
    return Promise.resolve(true);
  });
  const unbanChatMember = vi.fn().mockImplementation((_chatId: string, telegramId: number) => {
    liveStatuses.set(String(telegramId), 'left');
    return Promise.resolve(true);
  });
  const api = {
    getMe,
    getChatMember,
    sendMessage,
    banChatMember,
    unbanChatMember,
  } as unknown as Api;

  const logger = {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  } as unknown as Logger;
  const adminLogSend = vi.fn().mockResolvedValue(undefined);
  const adminLog = { send: adminLogSend } as unknown as AdminLogService;
  const service = new InactivityCleanupService(
    database,
    redis,
    api,
    logger,
    adminLog,
    options.ownerTelegramId ?? 777n,
    options.newActionsAllowedAt === undefined ? daysAgo(1) : options.newActionsAllowedAt,
  );

  return {
    service,
    settings,
    members,
    actions,
    counters,
    groupMemberFindMany,
    groupMemberUpdateMany,
    groupMemberUpdate,
    groupSettingsUpdate,
    groupSettingsUpdateMany,
    redisSet,
    redisEval,
    redisIncr,
    getMe,
    getChatMember,
    sendMessage,
    banChatMember,
    unbanChatMember,
    adminLogSend,
  };
}

describe('Inaktivitätsbereinigung', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('setzt beim ersten Lauf nur die sichere Tracking-Baseline', async () => {
    const stale = member('stale', 10n);
    const harness = createHarness({
      settings: { inactivityTrackingStartedAt: null, inactivityLastSweepAt: null },
      members: [stale],
    });

    await harness.service.run(NOW);

    expect(harness.settings.inactivityTrackingStartedAt).toEqual(NOW);
    expect(harness.settings.inactivityLastSweepAt).toEqual(NOW);
    expect(harness.sendMessage).not.toHaveBeenCalled();
    expect(harness.banChatMember).not.toHaveBeenCalled();
  });

  it('setzt nach mehr als 24 Stunden Ausfall Baseline und offene Warnungen zurück', async () => {
    const stale = member('stale', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: daysAgo(1),
    });
    const harness = createHarness({
      settings: { inactivityLastSweepAt: new Date(NOW.getTime() - DAY - 1) },
      members: [stale],
    });

    await harness.service.run(NOW);

    expect(stale.inactivityWarnedAt).toBeNull();
    expect(stale.inactivityKickDueAt).toBeNull();
    expect(harness.settings.inactivityTrackingStartedAt).toEqual(NOW);
    expect(harness.banChatMember).not.toHaveBeenCalled();
  });

  it('startet nach einem Prozessneustart während der Grace-Zeit keine neuen Warnungen oder Kicks', async () => {
    const due = member('due', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: NOW,
    });
    const harness = createHarness({
      members: [due],
      newActionsAllowedAt: new Date(NOW.getTime() + 10 * 60_000),
    });

    await harness.service.run(NOW);

    expect(harness.banChatMember).not.toHaveBeenCalled();
    expect(harness.sendMessage).not.toHaveBeenCalled();
    expect(harness.settings.inactivityLastSweepAt).toEqual(NOW);
    expect(due.inactivityKickDueAt).toEqual(NOW);
  });

  it('bleibt bis zum Polling-Start gesperrt und beginnt die Grace-Zeit erst dann', async () => {
    const due = member('due', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: NOW,
    });
    const harness = createHarness({ members: [due], newActionsAllowedAt: null });

    await harness.service.run(NOW);
    harness.service.markPollingStarted(NOW);
    await harness.service.run(
      new Date(NOW.getTime() + INACTIVITY_STARTUP_GRACE_MINUTES * 60_000 - 1),
    );

    expect(harness.banChatMember).not.toHaveBeenCalled();

    await harness.service.run(new Date(NOW.getTime() + INACTIVITY_STARTUP_GRACE_MINUTES * 60_000));

    expect(harness.banChatMember).toHaveBeenCalledOnce();
  });

  it('warnt nicht vor sieben vollen Tagen und warnt exakt an der Grenze', async () => {
    const early = member('early', 10n, { lastSeenAt: new Date(daysAgo(7).getTime() + 1) });
    const exact = member('exact', 11n, { lastSeenAt: daysAgo(7) });
    const harness = createHarness({ members: [early, exact] });

    await harness.service.run(NOW);

    expect(early.inactivityWarnedAt).toBeNull();
    expect(exact.inactivityWarnedAt).toEqual(NOW);
    expect(exact.inactivityKickDueAt).toEqual(
      new Date(NOW.getTime() + INACTIVITY_GRACE_HOURS * 60 * 60 * 1_000),
    );
    expect(harness.sendMessage).toHaveBeenCalledOnce();
  });

  it('markiert höchstens 15 Mitglieder pro Nachricht, escaped Namen und bleibt unter 4000 Zeichen', async () => {
    const members = Array.from({ length: INACTIVITY_MAX_WARNINGS_PER_UTC_DAY }, (_, index) =>
      member(`m${index}`, BigInt(1_000 + index), {
        user: { firstName: `<Name & ${index}>`, lastName: 'X'.repeat(100) },
      }),
    );
    const harness = createHarness({ members });

    await harness.service.run(NOW);

    expect(harness.sendMessage).toHaveBeenCalledTimes(
      Math.ceil(INACTIVITY_MAX_WARNINGS_PER_UTC_DAY / INACTIVITY_MAX_MENTIONS_PER_MESSAGE),
    );
    const texts = harness.sendMessage.mock.calls.map((call) => String(call[1]));
    for (const text of texts) {
      expect(text.length).toBeLessThanOrEqual(4_000);
      expect((text.match(/tg:\/\/user\?id=/gu) ?? []).length).toBeLessThanOrEqual(
        INACTIVITY_MAX_MENTIONS_PER_MESSAGE,
      );
      expect(text).not.toContain('<Name &');
    }
    expect(texts.join('\n')).toContain('&lt;Name &amp; 0&gt;');
    expect(members.filter(({ inactivityWarnedAt }) => inactivityWarnedAt !== null)).toHaveLength(
      INACTIVITY_MAX_WARNINGS_PER_UTC_DAY,
    );
  });

  it('warnt pro Gruppe und UTC-Tag nie mehr als 25 Mitglieder', async () => {
    const members = Array.from({ length: 30 }, (_, index) =>
      member(`m${index}`, BigInt(2_000 + index)),
    );
    const harness = createHarness({ members });

    await harness.service.run(NOW);

    expect(members.filter(({ inactivityWarnedAt }) => inactivityWarnedAt !== null)).toHaveLength(
      INACTIVITY_MAX_WARNINGS_PER_UTC_DAY,
    );
    expect(harness.counters.get('inactivity-cleanup:daily:group-1:warnings:2026-07-12')).toBe(
      INACTIVITY_MAX_WARNINGS_PER_UTC_DAY,
    );
  });

  it('nimmt interne Rollen, Owner, Bots und aktuelle Telegram-Admins aus und markiert Abwesende lokal', async () => {
    const trusted = member('trusted', 10n, { role: InternalRole.TRUSTED });
    const moderator = member('moderator', 11n, { role: InternalRole.MODERATOR });
    const owner = member('owner', 777n);
    const bot = member('bot', 13n);
    const admin = member('admin', 14n);
    const left = member('left', 15n);
    const restrictedAbsent = member('restricted', 16n);
    const normal = member('normal', 17n);
    const harness = createHarness({
      members: [trusted, moderator, owner, bot, admin, left, restrictedAbsent, normal],
      liveStatuses: {
        '13': 'bot',
        '14': 'administrator',
        '15': 'left',
        '16': 'restricted-absent',
      },
    });

    await harness.service.run(NOW);

    for (const exempt of [trusted, moderator, owner, bot, admin]) {
      expect(exempt.inactivityWarnedAt).toBeNull();
    }
    for (const liveExempt of [owner, bot, admin]) expect(liveExempt.lastSeenAt).toEqual(NOW);
    expect(left.deletedAt).toEqual(NOW);
    expect(restrictedAbsent.deletedAt).toEqual(NOW);
    expect(normal.inactivityWarnedAt).toEqual(NOW);
  });

  it('arbeitet bei fehlenden Botrechten vollständig fail-closed', async () => {
    const due = member('due', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: daysAgo(1),
    });
    const harness = createHarness({ members: [due], botCanRestrict: false });

    await harness.service.run(NOW);

    expect(harness.sendMessage).not.toHaveBeenCalled();
    expect(harness.banChatMember).not.toHaveBeenCalled();
    expect(due.deletedAt).toBeNull();
  });

  it('arbeitet bei einem Telegram-Statusfehler für das Ziel fail-closed', async () => {
    const stale = member('stale', 10n);
    const harness = createHarness({ members: [stale] });
    harness.getChatMember
      .mockResolvedValueOnce({
        status: 'administrator',
        can_restrict_members: true,
        user: { id: 999, is_bot: true, first_name: 'Guardian' },
      })
      .mockRejectedValueOnce(new Error('Netzwerkfehler'));

    await harness.service.run(NOW);

    expect(stale.inactivityWarnedAt).toBeNull();
    expect(stale.deletedAt).toBeNull();
    expect(harness.sendMessage).not.toHaveBeenCalled();
  });

  it('nimmt eine nicht gesendete Warnung zurück, sodass sie wiederholbar bleibt', async () => {
    const stale = member('stale', 10n);
    const harness = createHarness({ members: [stale] });
    harness.sendMessage.mockRejectedValueOnce(new Error('Telegram 429'));

    await harness.service.run(NOW);

    expect(stale.inactivityWarnedAt).toBeNull();
    expect(stale.inactivityKickDueAt).toBeNull();
    expect(harness.banChatMember).not.toHaveBeenCalled();
  });

  it('setzt einen nach Crash unvollständigen Warn-Claim zurück und sendet die Warnung neu', async () => {
    const staleClaim = member('stale-claim', 10n, {
      inactivityWarnedAt: daysAgo(1),
      inactivityKickDueAt: null,
    });
    const harness = createHarness({ members: [staleClaim] });

    await harness.service.run(NOW);

    expect(harness.banChatMember).not.toHaveBeenCalled();
    expect(harness.sendMessage).toHaveBeenCalledOnce();
    expect(staleClaim.inactivityWarnedAt).toEqual(NOW);
    expect(staleClaim.inactivityKickDueAt).toEqual(new Date(NOW.getTime() + DAY));
  });

  it('kickt nicht vor Ablauf der 24 Stunden und storniert bei Aktivität während der Grace-Phase', async () => {
    const warnedAt = new Date(NOW.getTime() - DAY);
    const notDue = member('not-due', 10n, {
      inactivityWarnedAt: warnedAt,
      inactivityKickDueAt: new Date(NOW.getTime() + 1),
    });
    const active = member('active', 11n, {
      lastSeenAt: new Date(warnedAt.getTime() + 1),
      inactivityWarnedAt: warnedAt,
      inactivityKickDueAt: NOW,
    });
    const harness = createHarness({ members: [notDue, active] });

    await harness.service.run(NOW);

    expect(harness.banChatMember).not.toHaveBeenCalled();
    expect(notDue.inactivityWarnedAt).not.toBeNull();
    expect(active.inactivityWarnedAt).toBeNull();
    expect(active.inactivityKickDueAt).toBeNull();
  });

  it('verhindert einen Kick über den Redis-Aktivitätsmarker auch bei fehlgeschlagenem DB-Tracking', async () => {
    const due = member('due', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: NOW,
    });
    const harness = createHarness({
      members: [due],
      activityMarkers: {
        [activityMarkerKey('group-1', 10n)]: NOW.getTime(),
      },
    });

    await harness.service.run(NOW);

    expect(harness.banChatMember).not.toHaveBeenCalled();
    expect(due.lastSeenAt).toEqual(NOW);
    expect(due.inactivityWarnedAt).toBeNull();
    expect(due.inactivityKickDueAt).toBeNull();
  });

  it('führt an der 24-Stunden-Grenze Ban, persistiertes bannedAt, Unban und Finalisierung aus', async () => {
    const due = member('due', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: NOW,
    });
    const harness = createHarness({ members: [due] });

    await harness.service.run(NOW);

    expect(harness.banChatMember).toHaveBeenCalledOnce();
    expect(harness.unbanChatMember).toHaveBeenCalledWith('-100123', 10, {
      only_if_banned: true,
    });
    expect(due.deletedAt).toEqual(NOW);
    expect(due.inactivityBannedAt).toBeNull();
    expect(harness.actions).toHaveLength(1);
    expect(harness.actions[0]).toMatchObject({ type: 'KICK', targetUserId: 'user-due' });
    expect(harness.adminLogSend).toHaveBeenCalledOnce();
  });

  it('bricht nach dem Ban sofort ohne Moderationsaktion ab, wenn währenddessen Aktivität eintrifft', async () => {
    const due = member('due', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: NOW,
    });
    const harness = createHarness({ members: [due], activityDuringBan: true });

    await harness.service.run(NOW);

    expect(harness.banChatMember).toHaveBeenCalledOnce();
    expect(harness.unbanChatMember).toHaveBeenCalledOnce();
    expect(harness.actions).toHaveLength(0);
    expect(due.inactivityBannedAt).toBeNull();
    expect(due.inactivityRemovalStartedAt).toBeNull();
  });

  it('finalisiert nichts, wenn der Ban fehlschlägt, und lässt den Start zur Wiederholung stehen', async () => {
    const due = member('due', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: NOW,
    });
    const harness = createHarness({ members: [due] });
    harness.banChatMember.mockRejectedValueOnce(new Error('Telegram 500'));

    await harness.service.run(NOW);

    expect(due.inactivityRemovalStartedAt).toEqual(NOW);
    expect(due.inactivityBannedAt).toBeNull();
    expect(harness.unbanChatMember).not.toHaveBeenCalled();
    expect(harness.actions).toHaveLength(0);
    expect(due.deletedAt).toBeNull();
  });

  it('führt nach erfolgreichem Ban bei DB-Persistenzfehler sofort best-effort Unban aus', async () => {
    const due = member('due', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: NOW,
    });
    const harness = createHarness({ members: [due], failPersistBannedAt: true });

    await harness.service.run(NOW);

    expect(harness.banChatMember).toHaveBeenCalledOnce();
    expect(harness.unbanChatMember).toHaveBeenCalledOnce();
    expect(due.inactivityBannedAt).toBeNull();
    expect(harness.actions).toHaveLength(0);
  });

  it('führt bei verlorenem DB-CAS durch gleichzeitige Aktivität keinen Ban aus', async () => {
    const due = member('due', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: NOW,
    });
    const harness = createHarness({ members: [due], failKickClaim: true });

    await harness.service.run(NOW);

    expect(harness.banChatMember).not.toHaveBeenCalled();
    expect(harness.unbanChatMember).not.toHaveBeenCalled();
    expect(harness.actions).toHaveLength(0);
  });

  it('behält bannedAt bei Unban-Fehler und recovered auch bei später deaktivierter Funktion', async () => {
    const due = member('due', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: NOW,
    });
    const harness = createHarness({ members: [due] });
    harness.unbanChatMember.mockRejectedValueOnce(new Error('Telegram 500'));

    await harness.service.run(NOW);

    expect(harness.banChatMember).toHaveBeenCalledOnce();
    expect(due.inactivityBannedAt).toEqual(NOW);
    expect(due.deletedAt).toBeNull();
    expect(harness.actions).toHaveLength(0);

    harness.settings.inactivityCleanupEnabled = false;
    await harness.service.run(new Date(NOW.getTime() + 60_000));

    expect(harness.banChatMember).toHaveBeenCalledOnce();
    expect(harness.unbanChatMember).toHaveBeenCalledTimes(2);
    expect(due.inactivityBannedAt).toBeNull();
    expect(due.deletedAt).toEqual(new Date(NOW.getTime() + 60_000));
    expect(harness.actions).toHaveLength(1);
  });

  it('recovered einen Crash nach erfolgreichem Ban anhand von removalStartedAt und Live-kicked', async () => {
    const interrupted = member('interrupted', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: daysAgo(1),
      inactivityRemovalStartedAt: daysAgo(1),
    });
    const harness = createHarness({
      settings: { inactivityCleanupEnabled: false },
      members: [interrupted],
      liveStatuses: { '10': 'kicked' },
    });

    await harness.service.run(NOW);

    expect(harness.banChatMember).not.toHaveBeenCalled();
    expect(harness.unbanChatMember).toHaveBeenCalledOnce();
    expect(interrupted.deletedAt).toEqual(NOW);
    expect(harness.actions).toHaveLength(1);
  });

  it('unbannt nach einem Crash zuerst, wenn ein Aktivitätsmarker den Removal-Claim überholt hat', async () => {
    const interrupted = member('interrupted', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: daysAgo(1),
      inactivityRemovalStartedAt: daysAgo(1),
    });
    const harness = createHarness({
      members: [interrupted],
      liveStatuses: { '10': 'kicked' },
      activityMarkers: {
        [activityMarkerKey('group-1', 10n)]: NOW.getTime(),
      },
    });

    await harness.service.run(NOW);

    expect(harness.banChatMember).not.toHaveBeenCalled();
    expect(harness.unbanChatMember).toHaveBeenCalledOnce();
    expect(interrupted.lastSeenAt).toEqual(NOW);
    expect(interrupted.inactivityRemovalStartedAt).toBeNull();
    expect(interrupted.inactivityBannedAt).toBeNull();
    expect(harness.actions).toHaveLength(0);
  });

  it('unbannt nach einem Crash ohne Moderationsaktion, wenn DB-Aktivität Warnfelder löschte', async () => {
    const interrupted = member('interrupted', 10n, {
      lastSeenAt: NOW,
      inactivityWarnedAt: null,
      inactivityKickDueAt: null,
      inactivityRemovalStartedAt: daysAgo(1),
    });
    const harness = createHarness({
      members: [interrupted],
      liveStatuses: { '10': 'kicked' },
    });

    await harness.service.run(NOW);

    expect(harness.banChatMember).not.toHaveBeenCalled();
    expect(harness.unbanChatMember).toHaveBeenCalledOnce();
    expect(interrupted.inactivityRemovalStartedAt).toBeNull();
    expect(harness.actions).toHaveLength(0);
  });

  it('bewahrt einen ungeklärten Removal-Claim beim Ausschalten trotz Telegram-Fehler', async () => {
    const interrupted = member('interrupted', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: daysAgo(1),
      inactivityRemovalStartedAt: daysAgo(1),
    });
    const harness = createHarness({
      settings: { inactivityCleanupEnabled: false },
      members: [interrupted],
    });
    harness.getChatMember
      .mockResolvedValueOnce({
        status: 'administrator',
        can_restrict_members: true,
        user: { id: 999, is_bot: true, first_name: 'Guardian' },
      })
      .mockRejectedValueOnce(new Error('Telegram nicht erreichbar'));

    await harness.service.run(NOW);

    expect(harness.unbanChatMember).not.toHaveBeenCalled();
    expect(interrupted.inactivityWarnedAt).toEqual(daysAgo(2));
    expect(interrupted.inactivityKickDueAt).toEqual(daysAgo(1));
    expect(interrupted.inactivityRemovalStartedAt).toEqual(daysAgo(1));
  });

  it('unbannt bei Persistenzfehler auch einen über Live-kicked erkannten Crash sofort', async () => {
    const interrupted = member('interrupted', 10n, {
      inactivityWarnedAt: daysAgo(2),
      inactivityKickDueAt: daysAgo(1),
      inactivityRemovalStartedAt: daysAgo(1),
    });
    const harness = createHarness({
      settings: { inactivityCleanupEnabled: false },
      members: [interrupted],
      liveStatuses: { '10': 'kicked' },
    });
    harness.groupMemberUpdateMany.mockRejectedValueOnce(new Error('PostgreSQL nicht erreichbar'));

    await harness.service.run(NOW);

    expect(harness.banChatMember).not.toHaveBeenCalled();
    expect(harness.unbanChatMember).toHaveBeenCalledOnce();
    expect(harness.actions).toHaveLength(0);
  });

  it('führt bei parallelen Sweeps dank Gruppenlock Warnung und Claim nur einmal aus', async () => {
    const stale = member('stale', 10n);
    const harness = createHarness({ members: [stale] });

    await Promise.all([harness.service.run(NOW), harness.service.run(NOW)]);

    expect(harness.sendMessage).toHaveBeenCalledOnce();
    expect(stale.inactivityWarnedAt).toEqual(NOW);
  });

  it('verwendet einen langen ownership-sicheren Gruppenlock', async () => {
    const harness = createHarness({ members: [] });

    await harness.service.run(NOW);

    const groupLock = harness.redisSet.mock.calls.find(
      (call) => call[0] === 'inactivity-cleanup:group:group-1',
    );
    expect(groupLock).toEqual([
      'inactivity-cleanup:group:group-1',
      expect.any(String),
      'EX',
      900,
      'NX',
    ]);
    expect(harness.redisEval).toHaveBeenCalled();
  });

  it('filtert persistente Trusted-Zuweisungen bereits in Warn- und Kick-Kandidatenqueries', async () => {
    const stale = member('stale', 10n);
    const harness = createHarness({ members: [stale] });

    await harness.service.run(NOW);

    const candidateCalls = harness.groupMemberFindMany.mock.calls.filter(
      (call) => !('OR' in (call[0] as { where: Record<string, unknown> }).where),
    );
    for (const call of candidateCalls) {
      expect((call[0] as { where: Record<string, unknown> }).where).toMatchObject({
        user: { trustedIn: { none: { groupId: 'group-1' } } },
      });
    }
  });

  it('begrenzt neu initiierte Kicks auf 25 pro Gruppe und UTC-Tag', async () => {
    const members = Array.from({ length: 30 }, (_, index) =>
      member(`due-${index}`, BigInt(3_000 + index), {
        inactivityWarnedAt: daysAgo(2),
        inactivityKickDueAt: NOW,
      }),
    );
    const harness = createHarness({ members });

    await harness.service.run(NOW);

    expect(harness.banChatMember).toHaveBeenCalledTimes(INACTIVITY_MAX_KICKS_PER_UTC_DAY);
    expect(harness.actions).toHaveLength(INACTIVITY_MAX_KICKS_PER_UTC_DAY);
    expect(harness.counters.get('inactivity-cleanup:daily:group-1:kicks:2026-07-12')).toBe(
      INACTIVITY_MAX_KICKS_PER_UTC_DAY,
    );
  });

  it('exportiert die fachlich festgelegten Zeitwerte', () => {
    expect(INACTIVITY_DAYS).toBe(7);
    expect(INACTIVITY_GRACE_HOURS).toBe(24);
  });
});
