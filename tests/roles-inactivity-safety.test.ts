import { describe, expect, it, vi } from 'vitest';
import { InternalRole } from '../src/generated/prisma/enums.js';
import { registerRolesModule } from '../src/modules/roles/index.js';
import type { BotContext } from '../src/types/context.js';
import type { Dependencies } from '../src/types/dependencies.js';

type RoleCommandHandler = (ctx: BotContext) => Promise<void>;

function createHarness(member: { role: InternalRole }) {
  const handlers = new Map<string, RoleCommandHandler>();
  const groupMemberUpsert = vi.fn().mockResolvedValue({ id: 'member-1' });
  const groupMemberUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const groupMemberFindUnique = vi.fn().mockResolvedValue(member);
  const trustedUserFindUnique = vi.fn().mockResolvedValue(null);
  const trustedUserDeleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const trustedUserUpsert = vi.fn().mockResolvedValue({ id: 'trusted-1' });
  const userUpsert = vi.fn(({ where }: { where: { telegramId: bigint } }) =>
    Promise.resolve({
      id: where.telegramId === 99n ? 'target-user' : 'grantor-user',
      telegramId: where.telegramId,
    }),
  );
  const transaction = vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations));
  const dependencies = {
    bot: {
      command: vi.fn(
        (commands: string | string[], handler: (ctx: BotContext) => Promise<void> | void) => {
          for (const command of Array.isArray(commands) ? commands : [commands]) {
            handlers.set(command, async (ctx) => handler(ctx));
          }
        },
      ),
    },
    database: {
      $transaction: transaction,
      user: { upsert: userUpsert },
      groupMember: {
        findUnique: groupMemberFindUnique,
        upsert: groupMemberUpsert,
        updateMany: groupMemberUpdateMany,
      },
      trustedUser: {
        findUnique: trustedUserFindUnique,
        upsert: trustedUserUpsert,
        deleteMany: trustedUserDeleteMany,
      },
    },
    permissions: {
      requireAdmin: vi.fn().mockResolvedValue(undefined),
      roleFor: vi.fn().mockResolvedValue(InternalRole.OWNER),
    },
    redis: { del: vi.fn().mockResolvedValue(1) },
    targets: {
      resolve: vi.fn().mockResolvedValue({ telegramId: 99n, remainingArguments: [] }),
    },
  } as unknown as Dependencies;
  registerRolesModule(dependencies);

  const run = async (command: string): Promise<void> => {
    const handler = handlers.get(command);
    if (!handler) throw new Error(`Handler /${command} wurde nicht registriert`);
    await handler({
      group: { id: 'group-1', telegramId: -100123n, title: 'Testgruppe' },
      locale: 'de',
      from: { id: 42, is_bot: false, first_name: 'Admin' },
      message: {
        message_id: 10,
        date: 1_783_843_200,
        chat: { id: -100123, type: 'supergroup', title: 'Testgruppe' },
        from: { id: 42, is_bot: false, first_name: 'Admin' },
        text: `/${command} 99`,
      },
      reply: vi.fn().mockResolvedValue({ message_id: 11 }),
    } as unknown as BotContext);
  };

  return {
    groupMemberFindUnique,
    groupMemberUpdateMany,
    groupMemberUpsert,
    run,
    transaction,
  };
}

describe('Rollenwechsel während der Inaktivitätsbereinigung', () => {
  it('trennt den normalen und jeden laufenden Recovery-Moderatorwechsel atomar', async () => {
    const harness = createHarness({ role: InternalRole.MEMBER });

    await harness.run('promotemod');

    expect(harness.groupMemberFindUnique).not.toHaveBeenCalled();
    expect(harness.transaction).toHaveBeenCalledOnce();
    expect(harness.groupMemberUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { role: InternalRole.MODERATOR },
      }),
    );
    expect(harness.groupMemberUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        groupId: 'group-1',
        userId: 'target-user',
        inactivityRemovalStartedAt: null,
        inactivityBannedAt: null,
      },
      data: {
        lastSeenAt: new Date('2026-07-12T08:00:00.000Z'),
        inactivityWarnedAt: null,
        inactivityKickDueAt: null,
        inactivityRemovalStartedAt: null,
        inactivityBannedAt: null,
      },
    });
    expect(harness.groupMemberUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        groupId: 'group-1',
        userId: 'target-user',
        OR: [{ inactivityRemovalStartedAt: { not: null } }, { inactivityBannedAt: { not: null } }],
      },
      data: { inactivityWarnedAt: null, inactivityKickDueAt: null },
    });

    const bannedUpdateCall = harness.groupMemberUpdateMany.mock.calls[1]?.[0] as
      { data: Record<string, unknown> } | undefined;
    expect(bannedUpdateCall?.data).not.toHaveProperty('lastSeenAt');
    expect(bannedUpdateCall?.data).not.toHaveProperty('inactivityRemovalStartedAt');
    expect(bannedUpdateCall?.data).not.toHaveProperty('inactivityBannedAt');
  });

  it('legt ein neues Mitglied mit einer vollständigen sauberen Baseline an', async () => {
    const harness = createHarness({ role: InternalRole.MEMBER });

    await harness.run('promotemod');

    expect(harness.groupMemberUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: {
          groupId: 'group-1',
          userId: 'target-user',
          role: InternalRole.MODERATOR,
          lastSeenAt: new Date('2026-07-12T08:00:00.000Z'),
          inactivityWarnedAt: null,
          inactivityKickDueAt: null,
          inactivityRemovalStartedAt: null,
          inactivityBannedAt: null,
        },
      }),
    );
  });

  it('trennt auch beim Entfernen des Vertrauensstatus beide Zustände atomar', async () => {
    const harness = createHarness({ role: InternalRole.TRUSTED });

    await harness.run('untrust');

    expect(harness.groupMemberFindUnique).toHaveBeenCalledWith({
      where: { groupId_userId: { groupId: 'group-1', userId: 'target-user' } },
      select: { role: true },
    });
    expect(harness.groupMemberUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        groupId: 'group-1',
        userId: 'target-user',
        role: InternalRole.TRUSTED,
        inactivityRemovalStartedAt: null,
        inactivityBannedAt: null,
      },
      data: {
        role: InternalRole.MEMBER,
        lastSeenAt: new Date('2026-07-12T08:00:00.000Z'),
        inactivityWarnedAt: null,
        inactivityKickDueAt: null,
        inactivityRemovalStartedAt: null,
        inactivityBannedAt: null,
      },
    });
    expect(harness.groupMemberUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        groupId: 'group-1',
        userId: 'target-user',
        role: InternalRole.TRUSTED,
        OR: [{ inactivityRemovalStartedAt: { not: null } }, { inactivityBannedAt: { not: null } }],
      },
      data: {
        role: InternalRole.MEMBER,
        inactivityWarnedAt: null,
        inactivityKickDueAt: null,
      },
    });

    const bannedUpdateCall = harness.groupMemberUpdateMany.mock.calls[1]?.[0] as
      { data: Record<string, unknown> } | undefined;
    expect(bannedUpdateCall?.data).not.toHaveProperty('lastSeenAt');
    expect(bannedUpdateCall?.data).not.toHaveProperty('inactivityRemovalStartedAt');
    expect(bannedUpdateCall?.data).not.toHaveProperty('inactivityBannedAt');
  });
});
