import { InternalRole, ModerationActionType } from '../../generated/prisma/enums.js';
import type { Dependencies } from '../../types/dependencies.js';
import { hasMinimumRole } from '../../services/permissions.js';
import { detectLinkViolation } from '../../utils/link-detection.js';
import { recordFloodMessage } from './flood.js';
import { mutedPermissions } from '../moderation/permissions.js';
import { findOrCreateUserByTelegramId } from '../../database/repositories.js';
import { commandArguments } from '../../utils/telegram.js';
import { UserFacingError } from '../../utils/errors.js';
import { translate } from '../../locales/index.js';
import type { BotContext } from '../../types/context.js';

async function automaticMute(
  dependencies: Dependencies,
  ctx: BotContext,
  durationSeconds: number,
  reason: string,
  type: ModerationActionType,
): Promise<void> {
  if (!ctx.group || !ctx.from) return;
  await dependencies.permissions.requireBotRestrictionRights(ctx);
  await ctx.api.restrictChatMember(ctx.group.telegramId.toString(), ctx.from.id, mutedPermissions, {
    until_date: Math.floor(Date.now() / 1_000) + durationSeconds,
  });
  const target = await findOrCreateUserByTelegramId(dependencies.database, BigInt(ctx.from.id));
  await dependencies.database.$transaction([
    dependencies.database.moderationAction.create({
      data: {
        groupId: ctx.group.id,
        targetUserId: target.id,
        type,
        reason,
        durationSeconds,
        originalMessageId: BigInt(ctx.message?.message_id ?? 0),
      },
    }),
    dependencies.database.groupMember.upsert({
      where: { groupId_userId: { groupId: ctx.group.id, userId: target.id } },
      create: {
        groupId: ctx.group.id,
        userId: target.id,
        mutedUntil: new Date(Date.now() + durationSeconds * 1_000),
      },
      update: { mutedUntil: new Date(Date.now() + durationSeconds * 1_000) },
    }),
  ]);
}

export function registerProtectionModule(dependencies: Dependencies): void {
  dependencies.bot.on('message:text', async (ctx, next) => {
    if (!ctx.group || ctx.message.text.startsWith('/')) {
      await next();
      return;
    }
    const settings = await dependencies.settings.get(ctx.group.id);
    if (!settings.floodEnabled && !settings.linkProtectionEnabled) {
      await next();
      return;
    }
    const role = await dependencies.permissions.roleFor(ctx, ctx.group.id, BigInt(ctx.from.id));
    const adminExempt = settings.floodExemptAdmins && hasMinimumRole(role, InternalRole.ADMIN);
    const trustedExempt = settings.floodExemptTrusted && hasMinimumRole(role, InternalRole.TRUSTED);

    if (settings.floodEnabled && !adminExempt && !trustedExempt) {
      const count = await recordFloodMessage(
        dependencies.redis,
        ctx.group.id,
        ctx.from.id,
        ctx.update.update_id,
        settings.floodWindowSec,
      );
      if (count > settings.floodMaxMessages) {
        await ctx.deleteMessage().catch(() => undefined);
        await automaticMute(
          dependencies,
          ctx,
          settings.floodMuteDurationSec,
          'Automatischer Flood-Schutz',
          ModerationActionType.FLOOD,
        );
        await dependencies.redis.del(`flood:${ctx.group.id}:${ctx.from.id}`);
        await dependencies.adminLog.send(ctx.group.id, 'Flood erkannt', {
          Nutzer: ctx.from.id,
          Nachrichten: count,
          Zeitraum: `${settings.floodWindowSec}s`,
        });
        await ctx.reply(translate(ctx.locale, 'flood_action', { user: ctx.from.id }));
        return;
      }
    }

    if (settings.linkProtectionEnabled && !hasMinimumRole(role, InternalRole.TRUSTED)) {
      const domainCacheKey = `allowed-domains:${ctx.group.id}`;
      const cachedDomains = await dependencies.redis.get(domainCacheKey);
      let allowedDomains: string[];
      if (cachedDomains) {
        allowedDomains = JSON.parse(cachedDomains) as string[];
      } else {
        const domains = await dependencies.database.allowedDomain.findMany({
          where: { groupId: ctx.group.id },
          select: { domain: true },
        });
        allowedDomains = domains.map(({ domain }) => domain);
        await dependencies.redis.set(domainCacheKey, JSON.stringify(allowedDomains), 'EX', 60);
      }
      const violation = detectLinkViolation(
        ctx.message.text,
        {
          telegramLinks: settings.blockTelegramLinks,
          externalLinks: settings.blockExternalLinks,
          shortLinks: settings.blockShortLinks,
          usernameAds: settings.blockUsernameAds,
          phoneNumbers: settings.blockPhoneNumbers,
          emailAddresses: settings.blockEmailAddresses,
          forwardedChannel: settings.blockForwardedChannels,
          allowedDomains,
        },
        ctx.message.forward_origin?.type === 'channel',
      );
      if (violation) {
        await ctx.deleteMessage();
        const target = await findOrCreateUserByTelegramId(
          dependencies.database,
          BigInt(ctx.from.id),
        );
        await dependencies.database.moderationAction.create({
          data: {
            groupId: ctx.group.id,
            targetUserId: target.id,
            type: ModerationActionType.LINK,
            reason: violation,
            originalMessageId: BigInt(ctx.message.message_id),
          },
        });
        await dependencies.adminLog.send(ctx.group.id, 'Linkschutz', {
          Nutzer: ctx.from.id,
          Verstoß: violation,
          Nachricht: ctx.message.message_id,
        });
        return;
      }
    }
    await next();
  });

  dependencies.bot.command('antilink', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const value = commandArguments(ctx)[0]?.toLowerCase();
    if (value !== 'on' && value !== 'off') throw new UserFacingError('error_reason');
    await dependencies.settings.update(ctx.group.id, { linkProtectionEnabled: value === 'on' });
    await ctx.reply(translate(ctx.locale, 'setting_saved'));
  });

  dependencies.bot.command('allowdomain', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const domain = normalizeDomain(commandArguments(ctx)[0] ?? '');
    if (!domain) throw new UserFacingError('error_reason');
    await dependencies.database.allowedDomain.upsert({
      where: { groupId_domain: { groupId: ctx.group.id, domain } },
      create: { groupId: ctx.group.id, domain },
      update: {},
    });
    await dependencies.redis.del(`allowed-domains:${ctx.group.id}`);
    await ctx.reply(translate(ctx.locale, 'domain_added'));
  });

  dependencies.bot.command('removedomain', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const domain = normalizeDomain(commandArguments(ctx)[0] ?? '');
    if (!domain) throw new UserFacingError('error_reason');
    await dependencies.database.allowedDomain.deleteMany({
      where: { groupId: ctx.group.id, domain },
    });
    await dependencies.redis.del(`allowed-domains:${ctx.group.id}`);
    await ctx.reply(translate(ctx.locale, 'domain_removed'));
  });
}

function normalizeDomain(value: string): string | null {
  const normalized = value
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
  return normalized && /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/u.test(normalized) ? normalized : null;
}
