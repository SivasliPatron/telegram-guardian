import type { Api } from 'grammy';
import type { Logger } from 'pino';
import { randomUUID } from 'node:crypto';
import { InternalRole, ModerationActionType } from '../generated/prisma/enums.js';
import type { Database } from '../database/client.js';
import type { RedisClient } from './redis.js';
import type { AdminLogService } from './admin-log.js';
import { escapeHtml } from '../utils/telegram.js';
import { readActivityMarker } from './activity-marker.js';

export const INACTIVITY_DAYS = 7;
export const INACTIVITY_GRACE_HOURS = 24;
export const INACTIVITY_MAX_WARNINGS_PER_UTC_DAY = 25;
export const INACTIVITY_MAX_KICKS_PER_UTC_DAY = 25;
export const INACTIVITY_MAX_MENTIONS_PER_MESSAGE = 15;
export const INACTIVITY_STARTUP_GRACE_MINUTES = 10;

const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const INACTIVITY_MILLISECONDS = INACTIVITY_DAYS * DAY_MILLISECONDS;
const GRACE_MILLISECONDS = INACTIVITY_GRACE_HOURS * 60 * 60 * 1_000;
const MAX_SWEEP_GAP_MILLISECONDS = DAY_MILLISECONDS;
const TELEGRAM_WARNING_LIMIT = 4_000;
const MEMBER_QUERY_LIMIT = 100;
const GROUP_LOCK_SECONDS = 15 * 60;
const MEMBER_LOCK_SECONDS = 2 * 60;
const DAILY_COUNTER_SECONDS = 2 * 24 * 60 * 60;
const STARTUP_GRACE_MILLISECONDS = INACTIVITY_STARTUP_GRACE_MINUTES * 60 * 1_000;

type SettingsWithGroup = Awaited<ReturnType<Database['groupSettings']['findMany']>>[number] & {
  group: { id: string; telegramId: bigint; title: string; isActive: boolean };
};

type MemberWithUser = Awaited<ReturnType<Database['groupMember']['findMany']>>[number] & {
  user: {
    id: string;
    telegramId: bigint;
    firstName: string;
    lastName: string | null;
  };
};

type LiveMemberDisposition = 'eligible' | 'exempt' | 'absent' | 'error';

interface ClaimedWarning {
  member: MemberWithUser;
  mention: string;
  warnedAt: Date;
  kickDueAt: Date;
}

export class InactivityCleanupService {
  private newActionsAllowedAt: Date | null;

  public constructor(
    private readonly database: Database,
    private readonly redis: RedisClient,
    private readonly api: Api,
    private readonly logger: Logger,
    private readonly adminLog: AdminLogService,
    private readonly ownerTelegramId: bigint,
    newActionsAllowedAt: Date | null = null,
  ) {
    this.newActionsAllowedAt = newActionsAllowedAt;
  }

  public markPollingStarted(now = new Date()): void {
    this.newActionsAllowedAt = new Date(now.getTime() + STARTUP_GRACE_MILLISECONDS);
  }

  public async run(now = new Date()): Promise<void> {
    let botId: number;
    try {
      botId = (await this.api.getMe()).id;
    } catch (error) {
      this.logger.warn({ err: error }, 'Bot-Identität für Inaktivitätsprüfung nicht verfügbar');
      return;
    }

    const settingsList = (await this.database.groupSettings.findMany({
      where: {
        group: { isActive: true },
        OR: [
          { inactivityCleanupEnabled: true },
          {
            group: {
              members: {
                some: {
                  OR: [
                    { inactivityRemovalStartedAt: { not: null } },
                    { inactivityBannedAt: { not: null } },
                  ],
                },
              },
            },
          },
        ],
      },
      include: { group: true },
    })) as SettingsWithGroup[];

    for (const settings of settingsList) {
      await this.withLock(this.groupLockKey(settings.groupId), GROUP_LOCK_SECONDS, async () => {
        await this.processGroup(settings, botId, now);
      }).catch((error: unknown) => {
        this.logger.error(
          { err: error, groupId: settings.groupId },
          'Inaktivitätsprüfung der Gruppe ist fehlgeschlagen',
        );
      });
    }
  }

  private async processGroup(settings: SettingsWithGroup, botId: number, now: Date): Promise<void> {
    if (!(await this.botCanRemoveMembers(settings, botId))) return;

    const newActionsAllowed =
      this.newActionsAllowedAt !== null && now.getTime() >= this.newActionsAllowedAt.getTime();
    await this.recoverInterruptedRemovals(settings, now, newActionsAllowed);
    if (!settings.inactivityCleanupEnabled) {
      await this.cancelNonBannedWork(settings.groupId);
      return;
    }

    await this.resetUnsentWarningClaims(settings.groupId);

    if (!settings.inactivityTrackingStartedAt) {
      await this.resetTrackingBaseline(settings.groupId, now);
      return;
    }

    if (
      !settings.inactivityLastSweepAt ||
      now.getTime() - settings.inactivityLastSweepAt.getTime() > MAX_SWEEP_GAP_MILLISECONDS
    ) {
      await this.resetTrackingBaseline(settings.groupId, now);
      return;
    }

    if (!newActionsAllowed) {
      await this.touchLastSweep(settings.id, now);
      return;
    }

    await this.processDueKicks(settings, now);

    if (now.getTime() - settings.inactivityTrackingStartedAt.getTime() >= INACTIVITY_MILLISECONDS) {
      await this.processNewWarnings(settings, now);
    }

    await this.touchLastSweep(settings.id, now);
  }

  private async botCanRemoveMembers(settings: SettingsWithGroup, botId: number): Promise<boolean> {
    try {
      const member = await this.api.getChatMember(settings.group.telegramId.toString(), botId);
      const allowed =
        member.status === 'creator' ||
        (member.status === 'administrator' && member.can_restrict_members);
      if (!allowed) {
        this.logger.warn(
          { groupId: settings.groupId },
          'Inaktivitätsprüfung übersprungen: Bot darf keine Mitglieder entfernen',
        );
      }
      return allowed;
    } catch (error) {
      this.logger.warn(
        { err: error, groupId: settings.groupId },
        'Bot-Rechte für Inaktivitätsprüfung konnten nicht geprüft werden',
      );
      return false;
    }
  }

  private async processNewWarnings(settings: SettingsWithGroup, now: Date): Promise<void> {
    const cutoff = new Date(now.getTime() - INACTIVITY_MILLISECONDS);
    const candidates = (await this.database.groupMember.findMany({
      where: {
        groupId: settings.groupId,
        role: InternalRole.MEMBER,
        deletedAt: null,
        lastSeenAt: { lte: cutoff },
        inactivityWarnedAt: null,
        inactivityKickDueAt: null,
        inactivityRemovalStartedAt: null,
        inactivityBannedAt: null,
        user: { trustedIn: { none: { groupId: settings.groupId } } },
      },
      include: { user: true },
      orderBy: [{ lastSeenAt: 'asc' }, { id: 'asc' }],
      take: MEMBER_QUERY_LIMIT,
    })) as MemberWithUser[];

    const claimed: ClaimedWarning[] = [];
    for (const member of candidates) {
      if (claimed.length >= INACTIVITY_MAX_WARNINGS_PER_UTC_DAY) break;
      const result = await this.withLock(
        this.memberLockKey(settings.groupId, member.id),
        MEMBER_LOCK_SECONDS,
        async () => {
          if (member.user.telegramId === this.ownerTelegramId) {
            await this.baselineExemptMember(member.id, now);
            return null;
          }

          const markerState = await this.reconcileActivityMarker(member);
          if (markerState !== 'unchanged') return null;

          const disposition = await this.inspectLiveMember(settings, member);
          if (disposition === 'absent') {
            await this.markLocallyAbsent(member.id, now);
            return null;
          }
          if (disposition === 'exempt') {
            await this.baselineExemptMember(member.id, now);
            return null;
          }
          if (disposition === 'error') return null;

          if (
            !(await this.reserveDailySlot(
              settings.groupId,
              'warnings',
              now,
              INACTIVITY_MAX_WARNINGS_PER_UTC_DAY,
            ))
          ) {
            return 'limit' as const;
          }

          const warnedAt = new Date(now);
          const claimedMember = await this.database.groupMember.updateMany({
            where: {
              id: member.id,
              groupId: settings.groupId,
              role: InternalRole.MEMBER,
              deletedAt: null,
              lastSeenAt: member.lastSeenAt,
              inactivityWarnedAt: null,
              inactivityKickDueAt: null,
              inactivityRemovalStartedAt: null,
              inactivityBannedAt: null,
            },
            data: { inactivityWarnedAt: warnedAt },
          });
          if (claimedMember.count !== 1) {
            await this.releaseDailySlot(settings.groupId, 'warnings', now);
            return null;
          }
          return {
            member,
            mention: this.memberMention(member),
            warnedAt,
            kickDueAt: new Date(now.getTime() + GRACE_MILLISECONDS),
          } satisfies ClaimedWarning;
        },
      );

      if (result === 'limit') break;
      if (result) claimed.push(result);
    }

    for (const chunk of this.warningChunks(claimed)) {
      const text = this.warningText(chunk);
      try {
        await this.api.sendMessage(settings.group.telegramId.toString(), text, {
          parse_mode: 'HTML',
        });
        await Promise.all(
          chunk.map((warning) =>
            this.database.groupMember.updateMany({
              where: {
                id: warning.member.id,
                inactivityWarnedAt: warning.warnedAt,
                inactivityKickDueAt: null,
                inactivityRemovalStartedAt: null,
                inactivityBannedAt: null,
              },
              data: { inactivityKickDueAt: warning.kickDueAt },
            }),
          ),
        );
      } catch (error) {
        this.logger.warn(
          {
            err: error,
            groupId: settings.groupId,
            memberIds: chunk.map(({ member }) => member.id),
          },
          'Inaktivitätswarnung konnte nicht gesendet werden',
        );
        await Promise.all(
          chunk.map((warning) =>
            this.database.groupMember.updateMany({
              where: {
                id: warning.member.id,
                inactivityWarnedAt: warning.warnedAt,
                inactivityKickDueAt: null,
                inactivityRemovalStartedAt: null,
                inactivityBannedAt: null,
              },
              data: { inactivityWarnedAt: null, inactivityKickDueAt: null },
            }),
          ),
        );
        await this.releaseDailySlot(settings.groupId, 'warnings', now, chunk.length);
      }
    }
  }

  private async processDueKicks(settings: SettingsWithGroup, now: Date): Promise<void> {
    const candidates = (await this.database.groupMember.findMany({
      where: {
        groupId: settings.groupId,
        role: InternalRole.MEMBER,
        deletedAt: null,
        inactivityWarnedAt: { not: null },
        inactivityKickDueAt: { lte: now },
        inactivityRemovalStartedAt: null,
        inactivityBannedAt: null,
        user: { trustedIn: { none: { groupId: settings.groupId } } },
      },
      include: { user: true },
      orderBy: [{ inactivityKickDueAt: 'asc' }, { id: 'asc' }],
      take: MEMBER_QUERY_LIMIT,
    })) as MemberWithUser[];

    let initiated = 0;
    for (const member of candidates) {
      if (initiated >= INACTIVITY_MAX_KICKS_PER_UTC_DAY) break;
      const result = await this.withLock(
        this.memberLockKey(settings.groupId, member.id),
        MEMBER_LOCK_SECONDS,
        async () => {
          if (member.user.telegramId === this.ownerTelegramId) {
            await this.baselineExemptMember(member.id, now);
            return 'skip' as const;
          }
          const markerState = await this.reconcileActivityMarker(member);
          if (markerState !== 'unchanged') return 'skip' as const;
          if (
            member.inactivityWarnedAt &&
            member.lastSeenAt.getTime() > member.inactivityWarnedAt.getTime()
          ) {
            await this.clearPendingState(member.id);
            return 'skip' as const;
          }

          const disposition = await this.inspectLiveMember(settings, member);
          if (disposition === 'absent') {
            await this.markLocallyAbsent(member.id, now);
            return 'skip' as const;
          }
          if (disposition === 'exempt') {
            await this.baselineExemptMember(member.id, now);
            return 'skip' as const;
          }
          if (disposition === 'error') return 'skip' as const;

          if (
            !(await this.reserveDailySlot(
              settings.groupId,
              'kicks',
              now,
              INACTIVITY_MAX_KICKS_PER_UTC_DAY,
            ))
          ) {
            return 'limit' as const;
          }

          const claim = new Date(now);
          const claimed = await this.database.groupMember.updateMany({
            where: {
              id: member.id,
              groupId: settings.groupId,
              role: InternalRole.MEMBER,
              deletedAt: null,
              lastSeenAt: member.lastSeenAt,
              inactivityWarnedAt: member.inactivityWarnedAt,
              inactivityKickDueAt: member.inactivityKickDueAt,
              inactivityRemovalStartedAt: null,
              inactivityBannedAt: null,
            },
            data: { inactivityRemovalStartedAt: claim },
          });
          if (claimed.count !== 1) {
            await this.releaseDailySlot(settings.groupId, 'kicks', now);
            return 'skip' as const;
          }

          await this.banThenRecover(settings, member, claim, now);
          return 'initiated' as const;
        },
      );

      if (result === 'limit') break;
      if (result === 'initiated') initiated += 1;
    }
  }

  private async recoverInterruptedRemovals(
    settings: SettingsWithGroup,
    now: Date,
    newActionsAllowed: boolean,
  ): Promise<void> {
    const members = (await this.database.groupMember.findMany({
      where: {
        groupId: settings.groupId,
        OR: [{ inactivityBannedAt: { not: null } }, { inactivityRemovalStartedAt: { not: null } }],
      },
      include: { user: true },
      orderBy: { inactivityRemovalStartedAt: 'asc' },
      take: MEMBER_QUERY_LIMIT,
    })) as MemberWithUser[];

    for (const member of members) {
      await this.withLock(
        this.memberLockKey(settings.groupId, member.id),
        MEMBER_LOCK_SECONDS,
        async () => {
          if (member.inactivityBannedAt) {
            await this.unbanAndFinalize(settings, member, now);
            return;
          }

          const markerState = await this.reconcileActivityMarker(member);
          const live = await this.safeGetMember(settings, member);
          if (!live) return;
          const exempt =
            live.user.is_bot ||
            member.user.telegramId === this.ownerTelegramId ||
            member.role !== InternalRole.MEMBER ||
            live.status === 'administrator' ||
            live.status === 'creator';
          const activityCancelsRemoval =
            markerState === 'changed' ||
            !member.inactivityWarnedAt ||
            !member.inactivityKickDueAt ||
            member.lastSeenAt.getTime() > member.inactivityWarnedAt.getTime();

          if (live.status === 'kicked') {
            if (markerState === 'error' || exempt || activityCancelsRemoval) {
              await this.unbanAbortedRemoval(settings, member, now);
              return;
            }
            try {
              const persisted = await this.database.groupMember.updateMany({
                where: { id: member.id, inactivityRemovalStartedAt: { not: null } },
                data: { inactivityBannedAt: now },
              });
              if (persisted.count !== 1) {
                await this.unbanAbortedRemoval(settings, member, now);
                return;
              }
            } catch (error) {
              this.logger.error(
                { err: error, groupId: settings.groupId, memberId: member.id },
                'Erkannter Inaktivitäts-Ban konnte nicht persistiert werden',
              );
              await this.api
                .unbanChatMember(
                  settings.group.telegramId.toString(),
                  Number(member.user.telegramId),
                  { only_if_banned: true },
                )
                .catch((unbanError: unknown) => {
                  this.logger.error(
                    { err: unbanError, groupId: settings.groupId, memberId: member.id },
                    'Sofortige Freigabe des erkannten Bans ist fehlgeschlagen',
                  );
                });
              return;
            }
            await this.unbanAndFinalize(settings, member, now);
            return;
          }
          if (live.status === 'left' || (live.status === 'restricted' && !live.is_member)) {
            await this.markLocallyAbsent(member.id, now);
            return;
          }
          if (exempt) {
            await this.baselineExemptMember(member.id, now);
            return;
          }
          if (markerState === 'error') return;
          if (!settings.inactivityCleanupEnabled || activityCancelsRemoval) {
            await this.clearPendingState(member.id);
            return;
          }

          if (!newActionsAllowed) return;

          await this.banThenRecover(
            settings,
            member,
            member.inactivityRemovalStartedAt ?? now,
            now,
          );
        },
      );
    }
  }

  private async banThenRecover(
    settings: SettingsWithGroup,
    member: MemberWithUser,
    removalStartedAt: Date,
    now: Date,
  ): Promise<void> {
    const markerBeforeBan = await this.reconcileActivityMarker(member);
    if (markerBeforeBan !== 'unchanged') return;

    const current = await this.database.groupMember.findUnique({
      where: { id: member.id },
      select: {
        lastSeenAt: true,
        inactivityWarnedAt: true,
        inactivityKickDueAt: true,
        inactivityRemovalStartedAt: true,
        inactivityBannedAt: true,
      },
    });
    if (
      current?.inactivityRemovalStartedAt?.getTime() !== removalStartedAt.getTime() ||
      current.inactivityBannedAt
    ) {
      return;
    }
    if (
      current.inactivityWarnedAt &&
      current.lastSeenAt.getTime() > current.inactivityWarnedAt.getTime()
    ) {
      await this.clearPendingState(member.id);
      return;
    }

    try {
      await this.api.banChatMember(
        settings.group.telegramId.toString(),
        Number(member.user.telegramId),
      );
    } catch (error) {
      this.logger.warn(
        { err: error, groupId: settings.groupId, memberId: member.id },
        'Inaktives Mitglied konnte nicht gebannt werden',
      );
      return;
    }

    const markerAfterBan = await this.reconcileActivityMarker(member);
    if (markerAfterBan !== 'unchanged') {
      await this.unbanAbortedRemoval(settings, member, now);
      return;
    }

    try {
      const persisted = await this.database.groupMember.updateMany({
        where: {
          id: member.id,
          lastSeenAt: current.lastSeenAt,
          inactivityWarnedAt: current.inactivityWarnedAt,
          inactivityKickDueAt: current.inactivityKickDueAt,
          inactivityRemovalStartedAt: removalStartedAt,
          inactivityBannedAt: null,
        },
        data: { inactivityBannedAt: now },
      });
      if (persisted.count !== 1) {
        await this.unbanAbortedRemoval(settings, member, now);
        return;
      }
    } catch (error) {
      this.logger.error(
        { err: error, groupId: settings.groupId, memberId: member.id },
        'Erfolgreicher Inaktivitäts-Ban konnte nicht persistiert werden',
      );
      await this.unbanAbortedRemoval(settings, member, now);
      return;
    }
    await this.unbanAndFinalize(settings, member, now);
  }

  private async unbanAbortedRemoval(
    settings: SettingsWithGroup,
    member: MemberWithUser,
    now: Date,
  ): Promise<void> {
    try {
      await this.api.unbanChatMember(
        settings.group.telegramId.toString(),
        Number(member.user.telegramId),
        { only_if_banned: true },
      );
      await this.database.groupMember.updateMany({
        where: { id: member.id, inactivityBannedAt: null },
        data: {
          deletedAt: now,
          inactivityWarnedAt: null,
          inactivityKickDueAt: null,
          inactivityRemovalStartedAt: null,
        },
      });
    } catch (error) {
      this.logger.error(
        { err: error, groupId: settings.groupId, memberId: member.id },
        'Sofortige Freigabe nach verworfenem Inaktivitäts-Ban ist fehlgeschlagen',
      );
      await this.database.groupMember
        .updateMany({
          where: { id: member.id, inactivityBannedAt: null },
          data: { inactivityRemovalStartedAt: now, inactivityBannedAt: now },
        })
        .catch((persistError: unknown) => {
          this.logger.error(
            { err: persistError, groupId: settings.groupId, memberId: member.id },
            'Wiederherstellungsstatus für verworfenen Inaktivitäts-Ban fehlt',
          );
        });
    }
  }

  private async unbanAndFinalize(
    settings: SettingsWithGroup,
    member: MemberWithUser,
    now: Date,
  ): Promise<void> {
    const recordModerationAction = Boolean(member.inactivityWarnedAt && member.inactivityKickDueAt);
    try {
      await this.api.unbanChatMember(
        settings.group.telegramId.toString(),
        Number(member.user.telegramId),
        { only_if_banned: true },
      );
    } catch (error) {
      this.logger.warn(
        { err: error, groupId: settings.groupId, memberId: member.id },
        'Inaktives Mitglied ist gebannt; Freigabe zum späteren Wiedereintritt wird wiederholt',
      );
      return;
    }

    const finalized = await this.database.$transaction(async (transaction) => {
      const changed = await transaction.groupMember.updateMany({
        where: { id: member.id, inactivityBannedAt: { not: null } },
        data: {
          deletedAt: now,
          inactivityWarnedAt: null,
          inactivityKickDueAt: null,
          inactivityRemovalStartedAt: null,
          inactivityBannedAt: null,
        },
      });
      if (changed.count !== 1) return false;
      if (recordModerationAction) {
        await transaction.moderationAction.create({
          data: {
            groupId: settings.groupId,
            targetUserId: member.user.id,
            type: ModerationActionType.KICK,
            reason: 'Automatische Entfernung nach Inaktivitätswarnung und 24 Stunden Schonfrist',
            metadata: { inactivityCleanup: true },
          },
        });
      }
      return true;
    });
    if (!finalized) return;

    if (!recordModerationAction) {
      this.logger.warn(
        { groupId: settings.groupId, memberId: member.id },
        'Abgebrochener Inaktivitäts-Ban wurde ohne Moderationsaktion freigegeben',
      );
      return;
    }

    await this.adminLog.send(settings.groupId, 'Automatische Inaktivitätsentfernung', {
      Nutzer: member.user.telegramId.toString(),
      Gruppe: settings.group.title,
      Grund: 'Nach 7 Tagen Inaktivität gewarnt und weitere 24 Stunden inaktiv',
    });
  }

  private async inspectLiveMember(
    settings: SettingsWithGroup,
    member: MemberWithUser,
  ): Promise<LiveMemberDisposition> {
    const live = await this.safeGetMember(settings, member);
    if (!live) return 'error';
    if (live.user.is_bot || member.user.telegramId === this.ownerTelegramId) return 'exempt';
    if (live.status === 'administrator' || live.status === 'creator') return 'exempt';
    if (
      live.status === 'left' ||
      live.status === 'kicked' ||
      (live.status === 'restricted' && !live.is_member)
    ) {
      return 'absent';
    }
    return 'eligible';
  }

  private async safeGetMember(settings: SettingsWithGroup, member: MemberWithUser) {
    try {
      return await this.api.getChatMember(
        settings.group.telegramId.toString(),
        Number(member.user.telegramId),
      );
    } catch (error) {
      this.logger.warn(
        { err: error, groupId: settings.groupId, memberId: member.id },
        'Telegram-Mitgliedsstatus konnte nicht geprüft werden',
      );
      return null;
    }
  }

  private async cancelNonBannedWork(groupId: string): Promise<void> {
    await this.database.groupMember.updateMany({
      where: {
        groupId,
        inactivityRemovalStartedAt: null,
        inactivityBannedAt: null,
      },
      data: {
        inactivityWarnedAt: null,
        inactivityKickDueAt: null,
      },
    });
  }

  private async resetTrackingBaseline(groupId: string, now: Date): Promise<void> {
    await this.database.$transaction([
      this.database.groupSettings.update({
        where: { groupId },
        data: { inactivityTrackingStartedAt: now, inactivityLastSweepAt: now },
      }),
      this.database.groupMember.updateMany({
        where: {
          groupId,
          inactivityRemovalStartedAt: null,
          inactivityBannedAt: null,
        },
        data: {
          inactivityWarnedAt: null,
          inactivityKickDueAt: null,
        },
      }),
    ]);
  }

  private async clearPendingState(memberId: string): Promise<void> {
    await this.database.groupMember.updateMany({
      where: { id: memberId, inactivityBannedAt: null },
      data: {
        inactivityWarnedAt: null,
        inactivityKickDueAt: null,
        inactivityRemovalStartedAt: null,
      },
    });
  }

  private async baselineExemptMember(memberId: string, now: Date): Promise<void> {
    await this.database.groupMember.updateMany({
      where: { id: memberId, inactivityBannedAt: null },
      data: {
        lastSeenAt: now,
        inactivityWarnedAt: null,
        inactivityKickDueAt: null,
        inactivityRemovalStartedAt: null,
      },
    });
  }

  private async resetUnsentWarningClaims(groupId: string): Promise<void> {
    await this.database.groupMember.updateMany({
      where: {
        groupId,
        inactivityWarnedAt: { not: null },
        inactivityKickDueAt: null,
        inactivityRemovalStartedAt: null,
        inactivityBannedAt: null,
      },
      data: { inactivityWarnedAt: null },
    });
  }

  private async reconcileActivityMarker(
    member: MemberWithUser,
  ): Promise<'unchanged' | 'changed' | 'error'> {
    let marker: Date | null;
    try {
      marker = await readActivityMarker(this.redis, member.groupId, member.user.telegramId);
    } catch (error) {
      this.logger.warn(
        { err: error, groupId: member.groupId, memberId: member.id },
        'Aktivitätsmarker konnte nicht geprüft werden; Entfernung wird ausgesetzt',
      );
      return 'error';
    }
    if (!marker || marker.getTime() <= member.lastSeenAt.getTime()) return 'unchanged';
    try {
      await this.database.groupMember.updateMany({
        where: {
          id: member.id,
          lastSeenAt: { lt: marker },
        },
        data: {
          lastSeenAt: marker,
          deletedAt: null,
          inactivityWarnedAt: null,
          inactivityKickDueAt: null,
        },
      });
    } catch (error) {
      this.logger.warn(
        { err: error, groupId: member.groupId, memberId: member.id },
        'Aktivitätsmarker konnte nicht in PostgreSQL übernommen werden; Entfernung wird ausgesetzt',
      );
      return 'error';
    }
    return 'changed';
  }

  private async touchLastSweep(settingsId: string, now: Date): Promise<void> {
    await this.database.groupSettings.updateMany({
      where: { id: settingsId, inactivityCleanupEnabled: true },
      data: { inactivityLastSweepAt: now },
    });
  }

  private async markLocallyAbsent(memberId: string, now: Date): Promise<void> {
    await this.database.groupMember.updateMany({
      where: { id: memberId, inactivityBannedAt: null },
      data: {
        deletedAt: now,
        inactivityWarnedAt: null,
        inactivityKickDueAt: null,
        inactivityRemovalStartedAt: null,
      },
    });
  }

  private memberMention(member: MemberWithUser): string {
    const label = [member.user.firstName, member.user.lastName]
      .filter((part): part is string => Boolean(part))
      .join(' ')
      .trim()
      .slice(0, 60);
    return `<a href="tg://user?id=${member.user.telegramId}">${escapeHtml(label || 'Mitglied')}</a>`;
  }

  private warningChunks(warnings: readonly ClaimedWarning[]): ClaimedWarning[][] {
    const chunks: ClaimedWarning[][] = [];
    let current: ClaimedWarning[] = [];
    for (const warning of warnings) {
      const proposed = [...current, warning];
      if (
        current.length > 0 &&
        (proposed.length > INACTIVITY_MAX_MENTIONS_PER_MESSAGE ||
          this.warningText(proposed).length > TELEGRAM_WARNING_LIMIT)
      ) {
        chunks.push(current);
        current = [warning];
      } else {
        current = proposed;
      }
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
  }

  private warningText(warnings: readonly ClaimedWarning[]): string {
    return [
      '⚠️ <b>Inaktivitätswarnung</b>',
      '',
      warnings.map(({ mention }) => mention).join(', '),
      '',
      `Ihr habt seit mindestens ${INACTIVITY_DAYS} Tagen nichts in dieser Gruppe geschrieben.`,
      `Schreibt innerhalb der nächsten ${INACTIVITY_GRACE_HOURS} Stunden eine Nachricht, sonst werdet ihr automatisch entfernt.`,
    ].join('\n');
  }

  private async reserveDailySlot(
    groupId: string,
    kind: 'warnings' | 'kicks',
    now: Date,
    limit: number,
  ): Promise<boolean> {
    const day = now.toISOString().slice(0, 10);
    const key = `inactivity-cleanup:daily:${groupId}:${kind}:${day}`;
    try {
      const value = await this.redis.incr(key);
      if (value === 1) {
        await this.redis.expire(key, DAILY_COUNTER_SECONDS).catch((error: unknown) => {
          this.logger.warn(
            { err: error, key },
            'Ablauf des Inaktivitätszählers konnte nicht gesetzt werden',
          );
        });
      }
      if (value <= limit) return true;
      await this.redis.decr(key).catch(() => undefined);
      return false;
    } catch (error) {
      this.logger.warn({ err: error, groupId, kind }, 'Inaktivitäts-Tageslimit nicht verfügbar');
      return false;
    }
  }

  private async releaseDailySlot(
    groupId: string,
    kind: 'warnings' | 'kicks',
    now: Date,
    count = 1,
  ): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    const key = `inactivity-cleanup:daily:${groupId}:${kind}:${day}`;
    await this.redis.decrby(key, count).catch((error: unknown) => {
      this.logger.warn(
        { err: error, key },
        'Inaktivitäts-Tagesplatz konnte nicht freigegeben werden',
      );
    });
  }

  private async withLock<T>(
    key: string,
    seconds: number,
    operation: () => Promise<T>,
  ): Promise<T | null> {
    const token = randomUUID();
    const locked = await this.redis.set(key, token, 'EX', seconds, 'NX');
    if (locked !== 'OK') return null;
    try {
      return await operation();
    } finally {
      await this.redis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          key,
          token,
        )
        .catch(() => undefined);
    }
  }

  private groupLockKey(groupId: string): string {
    return `inactivity-cleanup:group:${groupId}`;
  }

  private memberLockKey(groupId: string, memberId: string): string {
    return `inactivity-cleanup:member:${groupId}:${memberId}`;
  }
}
