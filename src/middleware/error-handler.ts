import { GrammyError, HttpError, type BotError } from 'grammy';
import type { Logger } from 'pino';
import type { BotContext } from '../types/context.js';
import { UserFacingError } from '../utils/errors.js';
import { translate, type TranslationKey } from '../locales/index.js';
import type { AdminLogService } from '../services/admin-log.js';

export async function handleBotError(
  error: BotError<BotContext>,
  logger: Logger,
  adminLog?: AdminLogService,
): Promise<void> {
  const cause = error.error;
  if (cause instanceof UserFacingError) {
    await error.ctx.reply(translate(error.ctx.locale, cause.translationKey as TranslationKey));
    return;
  }
  if (cause instanceof GrammyError) {
    logger.error({ method: cause.method, description: cause.description }, 'Telegram-API-Fehler');
  } else if (cause instanceof HttpError) {
    logger.error({ err: cause }, 'Telegram-Netzwerkfehler');
  } else {
    logger.error({ err: cause, updateId: error.ctx.update.update_id }, 'Unbehandelter Botfehler');
  }
  if (error.ctx.group && adminLog) {
    await adminLog.send(error.ctx.group.id, 'Botfehler', {
      Update: error.ctx.update.update_id,
      Typ: cause instanceof Error ? cause.name : 'UnknownError',
    });
  }
  try {
    await error.ctx.reply(translate(error.ctx.locale, 'error_generic'));
  } catch (replyError) {
    logger.warn({ err: replyError }, 'Fehlermeldung konnte nicht gesendet werden');
  }
}
