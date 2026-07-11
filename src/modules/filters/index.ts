import {
  FilterActionType,
  FilterMatchType,
  InternalRole,
  ModerationActionType,
} from '../../generated/prisma/enums.js';
import type { Dependencies } from '../../types/dependencies.js';
import {
  commandArguments,
  commandRemainder,
  displayName,
  escapeHtml,
  quotedMessageReason,
} from '../../utils/telegram.js';
import { filterMatches, presetFilterMatches, validateFilterPattern } from '../../utils/filter.js';
import { UserFacingError } from '../../utils/errors.js';
import { translate } from '../../locales/index.js';
import { ensureUser, findOrCreateUserByTelegramId } from '../../database/repositories.js';
import { mutedPermissions } from '../moderation/permissions.js';
import { parseDuration } from '../../utils/duration.js';
import { hasMinimumRole } from '../../services/permissions.js';
import { countEnabledPresetFilters, PRESET_FILTERS, setPresetFilters } from './presets.js';
import type { BotContext } from '../../types/context.js';
import type { AiModerationResult } from '../../services/ai-moderation.js';
import { audioWithinModerationLimits, convertAudioToWav } from '../../services/audio.js';
import {
  banAfterWarningThreshold,
  shouldApplyWarningBan,
} from '../../services/warning-escalation.js';
import { appendAdministratorMentions } from '../../services/admin-mentions.js';

async function applyAiWarning(
  dependencies: Dependencies,
  ctx: BotContext,
  result: AiModerationResult,
  mediaType: 'text' | 'audio',
  messageText?: string,
): Promise<void> {
  if (!ctx.group || !ctx.from || !ctx.message) return;
  const user = await findOrCreateUserByTelegramId(dependencies.database, BigInt(ctx.from.id));
  await ctx.deleteMessage();
  const me = await ctx.api.getMe();
  const moderator = await ensureUser(dependencies.database, me);
  const reason =
    mediaType === 'text' && messageText
      ? quotedMessageReason(messageText)
      : `Sprachnachricht: ${result.reason}`;
  await dependencies.database.warning.create({
    data: {
      groupId: ctx.group.id,
      userId: user.id,
      moderatorId: moderator.id,
      reason,
      originalMessageId: BigInt(ctx.message.message_id),
    },
  });
  const [warningCount, settings] = await Promise.all([
    dependencies.database.warning.count({
      where: {
        groupId: ctx.group.id,
        userId: user.id,
        clearedAt: null,
        deletedAt: null,
      },
    }),
    dependencies.settings.get(ctx.group.id),
  ]);
  const warningMessage = translate(ctx.locale, 'automatic_filter_warning', {
    user: escapeHtml(displayName(ctx.from)),
    count: warningCount,
    max: settings.maxWarnings > 0 ? settings.maxWarnings : '∞',
    reason: escapeHtml(reason),
  });
  await ctx.reply(await appendAdministratorMentions(dependencies, ctx, warningMessage), {
    parse_mode: 'HTML',
  });
  if (shouldApplyWarningBan(warningCount, settings.maxWarnings)) {
    await banAfterWarningThreshold(dependencies, {
      group: ctx.group,
      targetUserId: user.id,
      targetTelegramId: BigInt(ctx.from.id),
      moderatorUserId: moderator.id,
      warningCount,
    });
    await ctx.reply(
      translate(ctx.locale, 'automatic_warning_banned', {
        user: escapeHtml(displayName(ctx.from)),
        count: warningCount,
      }),
      { parse_mode: 'HTML' },
    );
  }
  const filterName = `gemini-${mediaType}-${result.category}`;
  await dependencies.database.moderationAction.create({
    data: {
      groupId: ctx.group.id,
      targetUserId: user.id,
      type: ModerationActionType.FILTER,
      reason,
      originalMessageId: BigInt(ctx.message.message_id),
      metadata: {
        action: FilterActionType.WARN,
        ai: {
          category: result.category,
          confidence: result.confidence,
          mediaType,
          reason: result.reason,
        },
      },
    },
  });
  await dependencies.adminLog.send(ctx.group.id, 'KI-Filter', {
    Nutzer: ctx.from.id,
    Filter: filterName,
    Aktion: FilterActionType.WARN,
    Kategorie: result.category,
    Sicherheit: `${Math.round(result.confidence * 100)} %`,
  });
}

export function registerFilterModule(dependencies: Dependencies): void {
  dependencies.bot.command('presetfilters', async (ctx) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const value = commandArguments(ctx)[0]?.toLowerCase();
    if (value !== 'on' && value !== 'off') {
      const active = await countEnabledPresetFilters(dependencies.database, ctx.group.id);
      await ctx.reply(
        translate(ctx.locale, 'preset_filter_status', {
          status:
            active === PRESET_FILTERS.length
              ? translate(ctx.locale, 'night_enabled')
              : active === 0
                ? translate(ctx.locale, 'night_disabled')
                : `${active}/${PRESET_FILTERS.length} aktiv`,
        }),
      );
      return;
    }
    await setPresetFilters(
      dependencies.database,
      ctx.group.id,
      BigInt(ctx.from.id),
      value === 'on',
    );
    await dependencies.redis.del(`filters:${ctx.group.id}`);
    await dependencies.adminLog.send(ctx.group.id, 'Standard-Wortfilter geändert', {
      Moderator: ctx.from.id,
      Status: value,
    });
    await ctx.reply(translate(ctx.locale, 'setting_saved'));
  });

  dependencies.bot.command('addfilter', async (ctx) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const argumentsList = commandArguments(ctx);
    const matchType = argumentsList[0]?.toUpperCase() as FilterMatchType | undefined;
    const action = argumentsList[1]?.toUpperCase() as FilterActionType | undefined;
    const rawConfiguration = commandRemainder(ctx, 2);
    if (
      !matchType ||
      !Object.values(FilterMatchType).includes(matchType) ||
      !action ||
      !Object.values(FilterActionType).includes(action)
    ) {
      throw new UserFacingError('filter_invalid');
    }
    const duration =
      action === FilterActionType.MUTE ? parseDuration(argumentsList[2] ?? '') : null;
    const rawPatternAndResponse = duration ? commandRemainder(ctx, 3) : rawConfiguration;
    const separator = rawPatternAndResponse.indexOf('|');
    const effectivePattern = (
      separator === -1 ? rawPatternAndResponse : rawPatternAndResponse.slice(0, separator)
    ).trim();
    const responseText = separator === -1 ? '' : rawPatternAndResponse.slice(separator + 1).trim();
    if (
      !validateFilterPattern(effectivePattern, matchType) ||
      (action === FilterActionType.REPLY && !responseText)
    ) {
      throw new UserFacingError('filter_invalid');
    }
    await dependencies.database.filter.create({
      data: {
        groupId: ctx.group.id,
        pattern: effectivePattern,
        matchType,
        action,
        createdByTelegramId: BigInt(ctx.from.id),
        ...(duration ? { muteDurationSeconds: duration } : {}),
        ...(responseText ? { responseText } : {}),
      },
    });
    await dependencies.redis.del(`filters:${ctx.group.id}`);
    await ctx.reply(translate(ctx.locale, 'filter_added'));
  });

  dependencies.bot.command('removefilter', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const id = commandArguments(ctx)[0];
    if (!id) throw new UserFacingError('error_remove_filter');
    const result = await dependencies.database.filter.updateMany({
      where: { id, groupId: ctx.group.id },
      data: { deletedAt: new Date(), enabled: false },
    });
    if (result.count === 0) throw new UserFacingError('filter_not_found');
    await dependencies.redis.del(`filters:${ctx.group.id}`);
    await ctx.reply(translate(ctx.locale, 'filter_removed'));
  });

  dependencies.bot.command('filters', async (ctx) => {
    if (!ctx.group) throw new UserFacingError('error_group_only');
    await dependencies.permissions.requireAdmin(ctx, ctx.group.id);
    const filters = await dependencies.database.filter.findMany({
      where: { groupId: ctx.group.id, deletedAt: null },
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
    await ctx.reply(
      filters
        .map((filter) => {
          const preset = PRESET_FILTERS.find(({ key }) => key === filter.presetKey);
          return `${filter.id}: ${filter.matchType}/${filter.action} – ${preset?.label ?? filter.pattern}`;
        })
        .join('\n') || '–',
    );
  });

  dependencies.bot.on('message:text', async (ctx, next) => {
    if (!ctx.group || ctx.message.text.startsWith('/')) {
      await next();
      return;
    }
    const filterCacheKey = `filters:${ctx.group.id}`;
    const cached = await dependencies.redis.get(filterCacheKey);
    const filters = cached
      ? (JSON.parse(cached) as {
          id: string;
          presetKey?: string | null;
          pattern: string;
          matchType: FilterMatchType;
          action: FilterActionType;
          ignoreCase: boolean;
          muteDurationSeconds: number | null;
          responseText: string | null;
        }[])
      : await dependencies.database.filter.findMany({
          where: { groupId: ctx.group.id, enabled: true, deletedAt: null },
          select: {
            id: true,
            presetKey: true,
            pattern: true,
            matchType: true,
            action: true,
            ignoreCase: true,
            muteDurationSeconds: true,
            responseText: true,
          },
        });
    if (!cached) await dependencies.redis.set(filterCacheKey, JSON.stringify(filters), 'EX', 60);
    const match = filters.find((filter) =>
      filter.presetKey
        ? presetFilterMatches(ctx.message.text, filter.pattern, filter.ignoreCase)
        : filterMatches(ctx.message.text, filter.pattern, filter.matchType, filter.ignoreCase),
    );
    if (!match) {
      const role = await dependencies.permissions.roleFor(ctx, ctx.group.id, BigInt(ctx.from.id));
      if (hasMinimumRole(role, InternalRole.TRUSTED) || !dependencies.aiModeration.enabled) {
        await next();
        return;
      }
      const aiResult = await dependencies.aiModeration.classify(ctx.message.text);
      if (!aiResult) {
        await next();
        return;
      }
      const decision = dependencies.aiModeration.decide(aiResult);
      if (decision === 'allow') {
        await next();
        return;
      }
      if (decision === 'log') {
        await dependencies.adminLog.send(ctx.group.id, 'KI-Filter – Prüfung empfohlen', {
          Nutzer: ctx.from.id,
          Kategorie: aiResult.category,
          Sicherheit: `${Math.round(aiResult.confidence * 100)} %`,
          Grund: aiResult.reason,
        });
        await next();
        return;
      }
      await applyAiWarning(dependencies, ctx, aiResult, 'text', ctx.message.text);
      return;
    }
    const role = await dependencies.permissions.roleFor(ctx, ctx.group.id, BigInt(ctx.from.id));
    if (hasMinimumRole(role, InternalRole.TRUSTED)) return;
    const user = await findOrCreateUserByTelegramId(dependencies.database, BigInt(ctx.from.id));
    if (
      match.action === FilterActionType.DELETE ||
      match.action === FilterActionType.WARN ||
      match.action === FilterActionType.MUTE
    ) {
      await ctx.deleteMessage();
    }
    if (match.action === FilterActionType.MUTE) {
      const duration = match.muteDurationSeconds ?? 600;
      await ctx.api.restrictChatMember(
        ctx.group.telegramId.toString(),
        ctx.from.id,
        mutedPermissions,
        {
          until_date: Math.floor(Date.now() / 1_000) + duration,
        },
      );
      await dependencies.database.groupMember.upsert({
        where: { groupId_userId: { groupId: ctx.group.id, userId: user.id } },
        create: {
          groupId: ctx.group.id,
          userId: user.id,
          mutedUntil: new Date(Date.now() + duration * 1_000),
        },
        update: { mutedUntil: new Date(Date.now() + duration * 1_000) },
      });
    }
    if (match.action === FilterActionType.WARN) {
      const me = await ctx.api.getMe();
      const moderator = await ensureUser(dependencies.database, me);
      const warningReason = quotedMessageReason(ctx.message.text);
      await dependencies.database.warning.create({
        data: {
          groupId: ctx.group.id,
          userId: user.id,
          moderatorId: moderator.id,
          reason: warningReason,
          originalMessageId: BigInt(ctx.message.message_id),
        },
      });
      const [warningCount, settings] = await Promise.all([
        dependencies.database.warning.count({
          where: {
            groupId: ctx.group.id,
            userId: user.id,
            clearedAt: null,
            deletedAt: null,
          },
        }),
        dependencies.settings.get(ctx.group.id),
      ]);
      const warningMessage = translate(ctx.locale, 'automatic_filter_warning', {
        user: escapeHtml(displayName(ctx.from)),
        count: warningCount,
        max: settings.maxWarnings > 0 ? settings.maxWarnings : '∞',
        reason: escapeHtml(warningReason),
      });
      await ctx.reply(await appendAdministratorMentions(dependencies, ctx, warningMessage), {
        parse_mode: 'HTML',
      });
      if (shouldApplyWarningBan(warningCount, settings.maxWarnings)) {
        await banAfterWarningThreshold(dependencies, {
          group: ctx.group,
          targetUserId: user.id,
          targetTelegramId: BigInt(ctx.from.id),
          moderatorUserId: moderator.id,
          warningCount,
        });
        await ctx.reply(
          translate(ctx.locale, 'automatic_warning_banned', {
            user: escapeHtml(displayName(ctx.from)),
            count: warningCount,
          }),
          { parse_mode: 'HTML' },
        );
      }
    }
    if (match.action === FilterActionType.REPLY && match.responseText)
      await ctx.reply(match.responseText);
    await dependencies.database.moderationAction.create({
      data: {
        groupId: ctx.group.id,
        targetUserId: user.id,
        type: ModerationActionType.FILTER,
        reason:
          match.action === FilterActionType.WARN
            ? quotedMessageReason(ctx.message.text)
            : `Filter ${match.presetKey ?? match.id}`,
        originalMessageId: BigInt(ctx.message.message_id),
        metadata: { action: match.action },
      },
    });
    await dependencies.adminLog.send(ctx.group.id, 'Wortfilter', {
      Nutzer: ctx.from.id,
      Filter: match.presetKey ?? match.id,
      Aktion: match.action,
      Inhalt: quotedMessageReason(ctx.message.text),
    });
  });

  dependencies.bot.on(['message:voice', 'message:audio'], async (ctx, next) => {
    if (
      !ctx.group ||
      !dependencies.aiModeration.enabled ||
      !dependencies.env.AI_AUDIO_FILTER_ENABLED
    ) {
      await next();
      return;
    }
    const role = await dependencies.permissions.roleFor(ctx, ctx.group.id, BigInt(ctx.from.id));
    if (hasMinimumRole(role, InternalRole.TRUSTED)) {
      await next();
      return;
    }
    const audio = 'voice' in ctx.message ? ctx.message.voice : ctx.message.audio;
    if (
      !audioWithinModerationLimits(
        {
          durationSeconds: audio.duration,
          ...(audio.file_size === undefined ? {} : { fileSize: audio.file_size }),
        },
        {
          maxDurationSeconds: dependencies.env.AI_AUDIO_MAX_DURATION_SEC,
          maxBytes: dependencies.env.AI_AUDIO_MAX_BYTES,
        },
      )
    ) {
      await next();
      return;
    }

    try {
      const file = await ctx.api.getFile(audio.file_id);
      if (!file.file_path) throw new Error('Telegram lieferte keinen Dateipfad');
      const fileUrl = `https://api.telegram.org/file/bot${dependencies.env.BOT_TOKEN}/${file.file_path}`;
      const response = await fetch(fileUrl, {
        signal: AbortSignal.timeout(dependencies.env.AI_AUDIO_TIMEOUT_MS),
      });
      if (!response.ok)
        throw new Error(`Telegram-Audiodownload fehlgeschlagen: ${response.status}`);
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > dependencies.env.AI_AUDIO_MAX_BYTES) {
        await next();
        return;
      }
      const downloadedAudio = Buffer.from(await response.arrayBuffer());
      if (downloadedAudio.length > dependencies.env.AI_AUDIO_MAX_BYTES) {
        await next();
        return;
      }
      const wavAudio = await convertAudioToWav(
        downloadedAudio,
        dependencies.env.AI_AUDIO_TIMEOUT_MS,
        dependencies.env.AI_AUDIO_MAX_BYTES,
      );
      const aiResult = await dependencies.aiModeration.classifyAudio(wavAudio);
      if (!aiResult) {
        await next();
        return;
      }
      const decision = dependencies.aiModeration.decideAudio(aiResult);
      dependencies.logger.info(
        {
          groupId: ctx.group.id,
          mediaType: 'audio',
          durationSeconds: audio.duration,
          decision,
          category: aiResult.category,
          confidence: aiResult.confidence,
        },
        'KI-Audioanalyse abgeschlossen',
      );
      if (decision === 'allow') {
        await next();
        return;
      }
      if (decision === 'log') {
        await dependencies.adminLog.send(ctx.group.id, 'KI-Audiofilter – Prüfung empfohlen', {
          Nutzer: ctx.from.id,
          Kategorie: aiResult.category,
          Sicherheit: `${Math.round(aiResult.confidence * 100)} %`,
          Grund: aiResult.reason,
        });
        await next();
        return;
      }
      await applyAiWarning(dependencies, ctx, aiResult, 'audio');
    } catch (error) {
      const safeError =
        error instanceof Error
          ? error.message.replaceAll(dependencies.env.BOT_TOKEN, '[REDACTED]')
          : 'Unbekannter Audiofehler';
      dependencies.logger.warn(
        { error: safeError, groupId: ctx.group.id },
        'Audio konnte nicht sicher moderiert werden; Nachricht erlaubt',
      );
      await next();
    }
  });
}
