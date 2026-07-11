import type { Dependencies } from '../../types/dependencies.js';
import { translate } from '../../locales/index.js';
import { UserFacingError } from '../../utils/errors.js';
import { commandArguments } from '../../utils/telegram.js';

const ENABLE_ARGUMENTS = new Set(['an', 'on', 'ein']);
const DISABLE_ARGUMENTS = new Set(['aus', 'off']);

function formatTrackingStart(
  startedAt: Date | string | null,
  timezone: string,
  locale: string,
): string {
  if (!startedAt) return translate(locale, 'inactivity_tracking_not_started');
  const date = startedAt instanceof Date ? startedAt : new Date(startedAt);
  if (Number.isNaN(date.getTime())) return translate(locale, 'inactivity_tracking_not_started');
  try {
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function registerInactivityModule(dependencies: Dependencies): void {
  dependencies.bot.command('inaktiv', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    const group = ctx.group;
    await dependencies.permissions.requireAdmin(ctx, group.id);

    const argument = commandArguments(ctx)[0]?.toLocaleLowerCase('de-DE');
    if (!argument || argument === 'status') {
      const [settings, knownMembers] = await Promise.all([
        dependencies.settings.get(group.id),
        dependencies.database.groupMember.count({
          where: {
            groupId: group.id,
            deletedAt: null,
            inactivityBannedAt: null,
          },
        }),
      ]);
      await ctx.reply(
        translate(ctx.locale, 'inactivity_status', {
          status: translate(
            ctx.locale,
            settings.inactivityCleanupEnabled ? 'night_enabled' : 'night_disabled',
          ),
          known: knownMembers,
          started: formatTrackingStart(
            settings.inactivityTrackingStartedAt,
            settings.timezone,
            ctx.locale,
          ),
        }),
        { parse_mode: 'HTML' },
      );
      return;
    }

    if (ENABLE_ARGUMENTS.has(argument)) {
      await dependencies.permissions.requireBotRestrictionRights(ctx);
      const now = new Date();
      const changed = await dependencies.database.$transaction(async (transaction) => {
        const enabled = await transaction.groupSettings.updateMany({
          where: {
            groupId: group.id,
            inactivityCleanupEnabled: false,
          },
          data: {
            inactivityCleanupEnabled: true,
            inactivityTrackingStartedAt: now,
            inactivityLastSweepAt: now,
          },
        });
        if (enabled.count === 0) return false;

        await transaction.groupMember.updateMany({
          where: {
            groupId: group.id,
            inactivityRemovalStartedAt: null,
            inactivityBannedAt: null,
          },
          data: {
            lastSeenAt: now,
            inactivityWarnedAt: null,
            inactivityKickDueAt: null,
          },
        });
        return true;
      });
      await dependencies.settings.invalidate(group.id);
      await ctx.reply(
        translate(ctx.locale, changed ? 'inactivity_enabled' : 'inactivity_already_enabled'),
      );
      return;
    }

    if (DISABLE_ARGUMENTS.has(argument)) {
      await dependencies.database.$transaction(async (transaction) => {
        await transaction.groupSettings.update({
          where: { groupId: group.id },
          data: { inactivityCleanupEnabled: false },
        });
        await transaction.groupMember.updateMany({
          where: {
            groupId: group.id,
            inactivityRemovalStartedAt: null,
            inactivityBannedAt: null,
          },
          data: {
            inactivityWarnedAt: null,
            inactivityKickDueAt: null,
          },
        });
      });
      await dependencies.settings.invalidate(group.id);
      await ctx.reply(translate(ctx.locale, 'inactivity_disabled'));
      return;
    }

    throw new UserFacingError('error_inactivity_usage');
  });
}
