import 'dotenv/config';
import { parseEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createDatabase } from './database/client.js';
import { createRedis } from './services/redis.js';
import { createBot } from './bot/create-bot.js';
import { SettingsService } from './services/settings.js';
import { PermissionService } from './services/permissions.js';
import { AdminLogService } from './services/admin-log.js';
import { JobScheduler } from './jobs/scheduler.js';
import type { Dependencies } from './types/dependencies.js';
import { deduplicateUpdates, commandRateLimit } from './middleware/security.js';
import { groupContextMiddleware } from './middleware/group-context.js';
import { registerModules } from './bot/register-modules.js';
import { handleBotError } from './middleware/error-handler.js';
import { commandRegistry } from './commands/registry.js';
import { startHealthServer } from './services/health.js';
import { TargetResolver } from './services/target-resolver.js';
import { InternalRole } from './generated/prisma/enums.js';
import { AiModerationService } from './services/ai-moderation.js';
import { InactivityCleanupService } from './services/inactivity-cleanup.js';
import { memberActivityMiddleware } from './middleware/member-activity.js';

const env = parseEnv(process.env);
const logger = createLogger(env);
const database = createDatabase(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const bot = createBot(env);
const settings = new SettingsService(database, redis);
const permissions = new PermissionService(database, BigInt(env.OWNER_TELEGRAM_ID), redis);
const adminLog = new AdminLogService(database, bot.api, logger);
const inactivityCleanup = new InactivityCleanupService(
  database,
  redis,
  bot.api,
  logger,
  adminLog,
  BigInt(env.OWNER_TELEGRAM_ID),
);
const jobs = new JobScheduler(
  database,
  redis,
  bot,
  logger,
  env.REDIS_URL,
  adminLog,
  inactivityCleanup,
);
const targets = new TargetResolver(database, redis);
const aiModeration = new AiModerationService(env, redis, logger);
const dependencies: Dependencies = {
  bot,
  database,
  redis,
  env,
  logger,
  settings,
  permissions,
  adminLog,
  jobs,
  targets,
  aiModeration,
};

bot.use(deduplicateUpdates(redis));
bot.use(groupContextMiddleware(dependencies));
bot.use(memberActivityMiddleware(dependencies));
bot.use(commandRateLimit(redis));
registerModules(dependencies);
bot.catch((error) => handleBotError(error, logger, adminLog));

await Promise.all([database.$connect(), redis.ping()]);
await jobs.start();
const telegramCommands = (definitions: typeof commandRegistry) =>
  definitions.slice(0, 100).map(({ command, description }) => ({ command, description }));
const memberCommands = commandRegistry.filter(({ role }) => role === InternalRole.MEMBER);
const administratorCommands = commandRegistry.filter(({ role }) => role !== InternalRole.OWNER);
const privateCommandNames = new Set(['mydata', 'deletemydata']);
const privateCommands = commandRegistry.filter(({ command }) => privateCommandNames.has(command));
await bot.api.deleteMyCommands();
await Promise.all([
  bot.api.setMyCommands(telegramCommands(privateCommands), {
    scope: { type: 'all_private_chats' },
  }),
  bot.api.setMyCommands(telegramCommands(memberCommands), {
    scope: { type: 'all_group_chats' },
  }),
  bot.api.setMyCommands(telegramCommands(administratorCommands), {
    scope: { type: 'all_chat_administrators' },
  }),
]);
const healthServer = startHealthServer(env.HEALTH_PORT, database, redis);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Graceful Shutdown gestartet');
  await bot.stop();
  healthServer.close();
  await Promise.allSettled([jobs.close(), database.$disconnect(), redis.quit()]);
  logger.info('Graceful Shutdown abgeschlossen');
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

logger.info('Telegram-Bot startet im Long-Polling-Modus');
await bot.start({
  allowed_updates: [
    'message',
    'callback_query',
    'chat_member',
    'my_chat_member',
    'chat_join_request',
  ],
  onStart: ({ username }) => {
    inactivityCleanup.markPollingStarted();
    logger.info({ username }, 'Telegram-Bot ist bereit');
  },
});
