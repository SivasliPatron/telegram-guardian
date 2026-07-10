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

const env = parseEnv(process.env);
const logger = createLogger(env);
const database = createDatabase(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);
const bot = createBot(env);
const settings = new SettingsService(database, redis);
const permissions = new PermissionService(database, BigInt(env.OWNER_TELEGRAM_ID), redis);
const adminLog = new AdminLogService(database, bot.api, logger);
const jobs = new JobScheduler(database, redis, bot, logger, env.REDIS_URL);
const targets = new TargetResolver(database, redis);
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
};

bot.use(deduplicateUpdates(redis));
bot.use(groupContextMiddleware(dependencies));
bot.use(commandRateLimit(redis));
registerModules(dependencies);
bot.catch((error) => handleBotError(error, logger, adminLog));

await Promise.all([database.$connect(), redis.ping()]);
await jobs.start();
await bot.api.setMyCommands(
  commandRegistry.slice(0, 100).map(({ command, description }) => ({ command, description })),
);
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
  allowed_updates: ['message', 'callback_query', 'chat_member', 'my_chat_member'],
  onStart: ({ username }) => logger.info({ username }, 'Telegram-Bot ist bereit'),
});
