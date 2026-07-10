import type { User as TelegramUser } from 'grammy/types';
import type { Database } from '../database/client.js';
import type { RedisClient } from './redis.js';

const CACHE_SECONDS = 60;

export interface NormalizedName {
  normalized: string;
  compact: string;
}

export interface ForbiddenNameMatch {
  id: string;
  pattern: string;
}

interface CachedForbiddenName extends ForbiddenNameMatch {
  normalizedPattern: string;
  compactPattern: string;
}

export function normalizeName(value: string): NormalizedName {
  const normalized = value
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .toLocaleLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
  return {
    normalized,
    compact: normalized.replace(/[^\p{L}\p{N}]/gu, ''),
  };
}

export function normalizedProfileName(user: TelegramUser): NormalizedName {
  return normalizeName(
    [user.first_name, user.last_name, user.username ? `@${user.username}` : '']
      .filter(Boolean)
      .join(' '),
  );
}

export function isValidForbiddenName(value: string): boolean {
  const candidate = normalizeName(value);
  return candidate.normalized.length <= 64 && candidate.compact.length >= 3;
}

export function matchesForbiddenName(
  name: NormalizedName,
  forbidden: Pick<CachedForbiddenName, 'normalizedPattern' | 'compactPattern'>,
): boolean {
  return (
    name.normalized.includes(forbidden.normalizedPattern) ||
    name.compact.includes(forbidden.compactPattern)
  );
}

export class NameGuardService {
  public constructor(
    private readonly database: Database,
    private readonly redis: RedisClient,
  ) {}

  public async findViolation(
    groupId: string,
    user: TelegramUser,
  ): Promise<ForbiddenNameMatch | null> {
    const name = normalizedProfileName(user);
    const forbiddenNames = await this.load(groupId);
    return forbiddenNames.find((forbidden) => matchesForbiddenName(name, forbidden)) ?? null;
  }

  public async add(groupId: string, pattern: string, actorTelegramId: bigint) {
    const displayPattern = pattern.replace(/\s+/gu, ' ').trim();
    const normalized = normalizeName(displayPattern);
    if (!isValidForbiddenName(displayPattern)) return null;
    const result = await this.database.forbiddenName.upsert({
      where: {
        groupId_normalizedPattern: {
          groupId,
          normalizedPattern: normalized.normalized,
        },
      },
      create: {
        groupId,
        pattern: displayPattern,
        normalizedPattern: normalized.normalized,
        compactPattern: normalized.compact,
        createdByTelegramId: actorTelegramId,
      },
      update: {
        pattern: displayPattern,
        compactPattern: normalized.compact,
        enabled: true,
        deletedAt: null,
      },
    });
    await this.invalidate(groupId);
    return result;
  }

  public async remove(groupId: string, id: string): Promise<boolean> {
    const result = await this.database.forbiddenName.updateMany({
      where: { id, groupId, deletedAt: null },
      data: { enabled: false, deletedAt: new Date() },
    });
    if (result.count > 0) await this.invalidate(groupId);
    return result.count > 0;
  }

  public async list(groupId: string) {
    return this.database.forbiddenName.findMany({
      where: { groupId, enabled: true, deletedAt: null },
      select: { id: true, pattern: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  private async load(groupId: string): Promise<CachedForbiddenName[]> {
    const key = this.cacheKey(groupId);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as CachedForbiddenName[];
    const entries = await this.database.forbiddenName.findMany({
      where: { groupId, enabled: true, deletedAt: null },
      select: {
        id: true,
        pattern: true,
        normalizedPattern: true,
        compactPattern: true,
      },
    });
    await this.redis.set(key, JSON.stringify(entries), 'EX', CACHE_SECONDS);
    return entries;
  }

  private async invalidate(groupId: string): Promise<void> {
    await this.redis.del(this.cacheKey(groupId));
  }

  private cacheKey(groupId: string): string {
    return `forbidden-names:${groupId}`;
  }
}
