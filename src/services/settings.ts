import type { GroupSettings } from '../generated/prisma/client.js';
import type { Database } from '../database/client.js';
import type { RedisClient } from './redis.js';

const CACHE_SECONDS = 60;

export class SettingsService {
  public constructor(
    private readonly database: Database,
    private readonly redis: RedisClient,
  ) {}

  public async get(groupId: string): Promise<GroupSettings> {
    const key = `settings:${groupId}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as GroupSettings;
    const settings = await this.database.groupSettings.findUniqueOrThrow({ where: { groupId } });
    await this.redis.set(key, JSON.stringify(settings), 'EX', CACHE_SECONDS);
    return settings;
  }

  public async update(
    groupId: string,
    data: Parameters<Database['groupSettings']['update']>[0]['data'],
  ) {
    const result = await this.database.groupSettings.update({ where: { groupId }, data });
    await this.invalidate(groupId);
    return result;
  }

  public async invalidate(groupId: string): Promise<void> {
    await this.redis.del(`settings:${groupId}`);
  }
}
