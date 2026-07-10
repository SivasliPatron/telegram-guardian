import { Bot } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import type { Env } from '../config/env.js';
import { BotContext } from '../types/context.js';

export function createBot(env: Env): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.BOT_TOKEN, { ContextConstructor: BotContext });
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));
  return bot;
}
