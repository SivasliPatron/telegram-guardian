import type { Dependencies } from '../../types/dependencies.js';
import { translate } from '../../locales/index.js';
import { commandRemainder } from '../../utils/telegram.js';
import { UserFacingError } from '../../utils/errors.js';

const MAXIMUM_QUESTION_LENGTH = 1_500;
const MAXIMUM_REQUESTS_PER_MINUTE = 5;

export function registerAiChatModule(dependencies: Dependencies): void {
  dependencies.bot.command('ki', async (ctx) => {
    if (!ctx.group || !ctx.from) throw new UserFacingError('error_group_only');
    const question = commandRemainder(ctx);
    if (!question) {
      await ctx.reply(translate(ctx.locale, 'ai_chat_usage'));
      return;
    }
    if (question.length > MAXIMUM_QUESTION_LENGTH) {
      await ctx.reply(translate(ctx.locale, 'ai_chat_too_long'));
      return;
    }
    if (!dependencies.aiModeration.chatEnabled) {
      await ctx.reply(translate(ctx.locale, 'ai_chat_unavailable'));
      return;
    }

    const rateKey = `ai-chat-rate:${ctx.group.id}:${ctx.from.id}`;
    const requestCount = await dependencies.redis.incr(rateKey);
    if (requestCount === 1) await dependencies.redis.expire(rateKey, 60);
    if (requestCount > MAXIMUM_REQUESTS_PER_MINUTE) {
      await ctx.reply(translate(ctx.locale, 'ai_chat_rate_limited'));
      return;
    }

    await ctx.api.sendChatAction(ctx.group.telegramId.toString(), 'typing');
    const answer = await dependencies.aiModeration.answerQuestion(question);
    await ctx.reply(
      answer ? `🤖 ${answer}` : translate(ctx.locale, 'ai_chat_failed'),
      answer
        ? {
            reply_parameters: { message_id: ctx.message?.message_id ?? 0 },
            link_preview_options: { is_disabled: true },
          }
        : undefined,
    );
  });
}
