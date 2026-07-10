import type { Bot } from 'grammy';
import type { Logger } from 'pino';
import type { Env } from '../config/env.js';
import type { Database } from '../database/client.js';
import type { BotContext } from './context.js';
import type { RedisClient } from '../services/redis.js';
import type { SettingsService } from '../services/settings.js';
import type { PermissionService } from '../services/permissions.js';
import type { AdminLogService } from '../services/admin-log.js';
import type { JobScheduler } from '../jobs/scheduler.js';
import type { TargetResolver } from '../services/target-resolver.js';
import type { AiModerationService } from '../services/ai-moderation.js';

export interface Dependencies {
  bot: Bot<BotContext>;
  database: Database;
  redis: RedisClient;
  env: Env;
  logger: Logger;
  settings: SettingsService;
  permissions: PermissionService;
  adminLog: AdminLogService;
  jobs: JobScheduler;
  targets: TargetResolver;
  aiModeration: AiModerationService;
}
