import type { User as TelegramUser } from 'grammy/types';
import { InternalRole, ModerationActionType } from '../../generated/prisma/enums.js';
import { ensureUser } from '../../database/repositories.js';
import { translate } from '../../locales/index.js';
import { hasMinimumRole } from '../../services/permissions.js';
import {
  NameGuardService,
  visibleProfileName,
  type ForbiddenNameMatch,
} from '../../services/name-guard.js';
import type { BotContext } from '../../types/context.js';
import type { Dependencies } from '../../types/dependencies.js';
import { UserFacingError } from '../../utils/errors.js';
import { setDisplayNamePresets } from './presets.js';
import { commandArguments, commandRemainder, escapeHtml } from '../../utils/telegram.js';

async function recordNameViolation(
  dependencies: Dependencies,
  groupId: string,
  user: TelegramUser,
  pattern: string,
  context: 'join-request' | 'member',
): Promise<void> {
  const storedUser = await ensureUser(dependencies.database, user);
  await dependencies.database.moderationAction.create({
    data: {
      groupId,
      targetUserId: storedUser.id,
      type: ModerationActionType.KICK,
      reason:
        context === 'join-request'
          ? `Beitrittsanfrage wegen verbotenem Namen abgelehnt: ${pattern}`
          : `Wegen verbotenem Namen entfernt: ${pattern}`,
      metadata: { nameGuard: true, pattern, context },
    },
  });
}

async function isTelegramAdministrator(ctx: BotContext, userId: number): Promise<boolean> {
  if (!ctx.chat) return true;
  const member = await ctx.api.getChatMember(ctx.chat.id, userId);
  return member.status === 'administrator' || member.status === 'creator';
}

async function findNameViolation(
  dependencies: Dependencies,
  service: NameGuardService,
  groupId: string,
  user: TelegramUser,
): Promise<ForbiddenNameMatch | null> {
  const presetViolation = await service.findViolation(groupId, user);
  if (presetViolation) return presetViolation;

  const result = await dependencies.aiModeration.classifyDisplayName(visibleProfileName(user));
  if (!result) return null;
  const decision = dependencies.aiModeration.decideDisplayName(result);
  dependencies.logger.info(
    {
      groupId,
      mediaType: 'display-name',
      decision,
      category: result.category,
      confidence: result.confidence,
    },
    'KI-Namensprüfung abgeschlossen',
  );
  if (decision === 'log') {
    await dependencies.adminLog.send(groupId, 'KI-Namensprüfung – Prüfung empfohlen', {
      Nutzer: user.id,
      Name: visibleProfileName(user),
      Kategorie: result.category,
      Sicherheit: `${Math.round(result.confidence * 100)} %`,
      Grund: result.reason,
    });
    return null;
  }
  if (decision !== 'warn') return null;
  return {
    id: `gemini-name-${result.category}`,
    pattern: `KI-${result.category}: ${result.reason}`,
  };
}

async function removeMemberForName(
  dependencies: Dependencies,
  ctx: BotContext,
  user: TelegramUser,
  pattern: string,
  configuredMessage: string,
): Promise<boolean> {
  if (!ctx.group || !ctx.chat) return false;
  if (await isTelegramAdministrator(ctx, user.id)) return false;
  await dependencies.permissions.requireBotRestrictionRights(ctx);
  await ctx.api.banChatMember(ctx.chat.id, user.id);
  await ctx.api.unbanChatMember(ctx.chat.id, user.id, { only_if_banned: true });
  await recordNameViolation(dependencies, ctx.group.id, user, pattern, 'member');
  await dependencies.adminLog.send(ctx.group.id, 'Namensschutz', {
    Nutzer: user.id,
    Name: visibleProfileName(user),
    Treffer: pattern,
  });
  await ctx.reply(
    translate(ctx.locale, 'name_guard_removed', {
      name: escapeHtml(visibleProfileName(user)),
      message: escapeHtml(configuredMessage),
    }),
    { parse_mode: 'HTML' },
  );
  return true;
}

export function registerNameGuardModule(dependencies: Dependencies): void {
  const service = new NameGuardService(dependencies.database, dependencies.redis);

  dependencies.bot.command('nameguard', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const value = commandArguments(ctx)[0]?.toLowerCase();
    const names = await service.list(ctx.group.id);
    if (value !== 'on' && value !== 'off') {
      const settings = await dependencies.settings.get(ctx.group.id);
      await ctx.reply(
        translate(ctx.locale, 'name_guard_status', {
          status: translate(
            ctx.locale,
            settings.nameProtectionEnabled ? 'night_enabled' : 'night_disabled',
          ),
          count: names.length,
        }),
      );
      return;
    }
    if (value === 'on') {
      await setDisplayNamePresets(
        dependencies.database,
        dependencies.redis,
        ctx.group.id,
        BigInt(ctx.from?.id ?? dependencies.env.OWNER_TELEGRAM_ID),
      );
      await Promise.all([
        dependencies.permissions.requireBotRestrictionRights(ctx),
        dependencies.permissions.requireBotInviteRights(ctx),
      ]);
    }
    await dependencies.settings.update(ctx.group.id, { nameProtectionEnabled: value === 'on' });
    await ctx.reply(translate(ctx.locale, 'setting_saved'));
  });

  dependencies.bot.command('addforbiddenname', async (ctx) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const pattern = commandRemainder(ctx);
    const stored = await service.add(ctx.group.id, pattern, BigInt(ctx.from.id));
    if (!stored) throw new UserFacingError('error_forbidden_name');
    await ctx.reply(translate(ctx.locale, 'forbidden_name_added', { pattern: stored.pattern }));
  });

  dependencies.bot.command('removeforbiddenname', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const id = commandArguments(ctx)[0];
    if (!id) throw new UserFacingError('error_remove_forbidden_name');
    if (!(await service.remove(ctx.group.id, id))) {
      throw new UserFacingError('forbidden_name_not_found');
    }
    await ctx.reply(translate(ctx.locale, 'forbidden_name_removed'));
  });

  dependencies.bot.command('forbiddennames', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const names = await service.list(ctx.group.id);
    await ctx.reply(names.map(({ id, pattern }) => `${id}: ${pattern}`).join('\n') || '–');
  });

  dependencies.bot.on('chat_join_request', async (ctx, next) => {
    if (!ctx.group) {
      await next();
      return;
    }
    const settings = await dependencies.settings.get(ctx.group.id);
    if (!settings.nameProtectionEnabled) {
      await next();
      return;
    }
    const request = ctx.chatJoinRequest;
    const violation = await findNameViolation(dependencies, service, ctx.group.id, request.from);
    if (!violation) {
      await ctx.api.approveChatJoinRequest(request.chat.id, request.from.id);
      return;
    }
    await ctx.api
      .sendMessage(request.user_chat_id, settings.nameProtectionMessage)
      .catch(() => undefined);
    await ctx.api.declineChatJoinRequest(request.chat.id, request.from.id);
    await recordNameViolation(
      dependencies,
      ctx.group.id,
      request.from,
      violation.pattern,
      'join-request',
    );
    await dependencies.adminLog.send(ctx.group.id, 'Beitrittsanfrage abgelehnt', {
      Nutzer: request.from.id,
      Name: visibleProfileName(request.from),
      Treffer: violation.pattern,
    });
  });

  dependencies.bot.on('message:new_chat_members', async (ctx, next) => {
    if (!ctx.group) {
      await next();
      return;
    }
    const settings = await dependencies.settings.get(ctx.group.id);
    if (!settings.nameProtectionEnabled) {
      await next();
      return;
    }
    let removed = false;
    for (const user of ctx.message.new_chat_members) {
      if (user.is_bot) continue;
      const violation = await findNameViolation(dependencies, service, ctx.group.id, user);
      if (!violation) continue;
      const wasRemoved = await removeMemberForName(
        dependencies,
        ctx,
        user,
        violation.pattern,
        settings.nameProtectionMessage,
      );
      removed = wasRemoved || removed;
    }
    if (!removed) await next();
  });

  dependencies.bot.on('message', async (ctx, next) => {
    if (
      !ctx.group ||
      ctx.from.is_bot ||
      ('new_chat_members' in ctx.message && Boolean(ctx.message.new_chat_members))
    ) {
      await next();
      return;
    }
    const settings = await dependencies.settings.get(ctx.group.id);
    if (!settings.nameProtectionEnabled) {
      await next();
      return;
    }
    const role = await dependencies.permissions.roleFor(ctx, ctx.group.id, BigInt(ctx.from.id));
    if (hasMinimumRole(role, InternalRole.ADMIN)) {
      await next();
      return;
    }
    const violation = await findNameViolation(dependencies, service, ctx.group.id, ctx.from);
    if (!violation) {
      await next();
      return;
    }
    await removeMemberForName(
      dependencies,
      ctx,
      ctx.from,
      violation.pattern,
      settings.nameProtectionMessage,
    );
  });
}
