import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import type { Bot } from 'grammy';
import type { Logger } from 'pino';
import type { Database } from '../database/client.js';
import type { RedisClient } from '../services/redis.js';
import type { BotContext } from '../types/context.js';
import { localClock, shouldNightModeBeClosed } from '../utils/time.js';
import { memberPermissions, mutedPermissions } from '../modules/moderation/permissions.js';

type TaskData = { type: 'delete-message'; chatId: string; messageId: number } | { type: 'tick' };

export class JobScheduler {
  private readonly queue: Queue<TaskData, void, string, TaskData, void, string>;
  private readonly worker: Worker<TaskData, void>;

  public constructor(
    private readonly database: Database,
    private readonly redis: RedisClient,
    private readonly bot: Bot<BotContext>,
    private readonly logger: Logger,
    redisUrl: string,
  ) {
    const connection = redisConnectionOptions(redisUrl);
    this.queue = new Queue<TaskData, void, string, TaskData, void, string>('telegram-tasks', {
      connection,
    });
    this.worker = new Worker<TaskData, void>('telegram-tasks', async (job) => this.process(job), {
      connection,
      concurrency: 5,
    });
    this.worker.on('failed', (job, error) => {
      this.logger.error(
        { err: error, jobId: job?.id, jobName: job?.name },
        'Hintergrundjob fehlgeschlagen',
      );
    });
  }

  public async start(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'minute-tick',
      { every: 60_000 },
      {
        name: 'tick',
        data: { type: 'tick' },
        opts: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2_000 },
          removeOnComplete: 100,
        },
      },
    );
  }

  public async scheduleDeletion(
    chatId: string,
    messageId: number,
    delaySeconds: number,
  ): Promise<void> {
    await this.queue.add(
      'delete-message',
      { type: 'delete-message', chatId, messageId },
      {
        delay: delaySeconds * 1_000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        jobId: `delete-${chatId.replaceAll(':', '_')}-${messageId}`,
        removeOnComplete: true,
        removeOnFail: 1_000,
      },
    );
  }

  public async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }

  private async process(job: Job<TaskData>): Promise<void> {
    if (job.data.type === 'delete-message') {
      await this.bot.api.deleteMessage(job.data.chatId, job.data.messageId).catch(() => undefined);
      return;
    }
    await Promise.all([this.reconcileNightModes(), this.sendScheduledMessages()]);
  }

  private async reconcileNightModes(): Promise<void> {
    const settingsList = await this.database.groupSettings.findMany({
      where: { nightModeEnabled: true, group: { isActive: true } },
      include: { group: true },
    });
    for (const settings of settingsList) {
      const desired = shouldNightModeBeClosed(
        localClock(new Date(), settings.timezone).time,
        settings.nightCloseTime,
        settings.nightOpenTime,
      );
      if (desired === settings.nightClosed) continue;
      const lock = await this.redis.set(`night-lock:${settings.groupId}`, '1', 'EX', 55, 'NX');
      if (lock !== 'OK') continue;
      await this.bot.api.setChatPermissions(
        settings.group.telegramId.toString(),
        desired ? mutedPermissions : memberPermissions,
      );
      await this.database.groupSettings.update({
        where: { groupId: settings.groupId },
        data: { nightClosed: desired, lastNightActionAt: new Date() },
      });
    }
  }

  private async sendScheduledMessages(): Promise<void> {
    const messages = await this.database.scheduledMessage.findMany({
      where: { active: true, deletedAt: null, group: { isActive: true } },
      include: { group: true },
    });
    const now = new Date();
    for (const scheduled of messages) {
      const local = localClock(now, scheduled.timezone);
      if (local.time !== scheduled.time || !scheduled.weekdays.includes(local.weekday)) continue;
      const minuteKey = new Intl.DateTimeFormat('en-CA', {
        timeZone: scheduled.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(now);
      const lock = await this.redis.set(
        `schedule-lock:${scheduled.id}:${minuteKey}`,
        '1',
        'EX',
        172_800,
        'NX',
      );
      if (lock !== 'OK') continue;
      const sent = await this.bot.api.sendMessage(
        scheduled.group.telegramId.toString(),
        scheduled.text,
      );
      await this.database.scheduledMessage.update({
        where: { id: scheduled.id },
        data: { lastSentAt: now },
      });
      if (scheduled.deleteAfterSeconds) {
        await this.scheduleDeletion(
          scheduled.group.telegramId.toString(),
          sent.message_id,
          scheduled.deleteAfterSeconds,
        );
      }
    }
  }
}

function redisConnectionOptions(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  const database = parsed.pathname.length > 1 ? Number.parseInt(parsed.pathname.slice(1), 10) : 0;
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    db: Number.isNaN(database) ? 0 : database,
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
