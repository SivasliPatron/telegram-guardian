import type { User as TelegramUser } from 'grammy/types';
import type { Database } from '../database/client.js';
import type { RedisClient } from './redis.js';

const CACHE_SECONDS = 60;
const NAME_FILTER_CACHE_REVISION = 'v3';
const PROTECTED_NEUTRAL_NAMES = new Set(['turk', 'türk', 'kurd', 'kürt']);

export function forbiddenNameCacheKey(groupId: string): string {
  return `forbidden-names:${NAME_FILTER_CACHE_REVISION}:${groupId}`;
}

export function allowedNameCacheKey(groupId: string): string {
  return `allowed-names:${NAME_FILTER_CACHE_REVISION}:${groupId}`;
}

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

interface CachedAllowedName {
  id: string;
  displayName: string;
  normalizedName: string;
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

export function isProtectedNeutralName(value: string): boolean {
  return PROTECTED_NEUTRAL_NAMES.has(normalizeName(value).compact);
}

export function normalizedProfileName(user: TelegramUser): NormalizedName {
  return normalizeName(visibleProfileName(user));
}

export function visibleProfileName(user: TelegramUser): string {
  return [user.first_name, user.last_name].filter(Boolean).join(' ');
}

export function isValidForbiddenName(value: string): boolean {
  const candidate = normalizeName(value);
  return candidate.normalized.length <= 64 && candidate.compact.length >= 3;
}

export function matchesForbiddenName(
  name: NormalizedName,
  forbidden: Pick<CachedForbiddenName, 'normalizedPattern' | 'compactPattern'>,
): boolean {
  if (forbidden.compactPattern.length >= 5 && name.compact.includes(forbidden.compactPattern)) {
    return true;
  }
  const flexiblePattern = Array.from(forbidden.compactPattern)
    .map((character) => character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join(String.raw`[^\p{L}\p{N}]*`);
  return new RegExp(String.raw`(?:^|[^\p{L}\p{N}])${flexiblePattern}(?=$|[^\p{L}\p{N}])`, 'u').test(
    name.normalized,
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
    if (isProtectedNeutralName(visibleProfileName(user))) return null;
    const name = normalizedProfileName(user);
    const forbiddenNames = await this.load(groupId);
    return forbiddenNames.find((forbidden) => matchesForbiddenName(name, forbidden)) ?? null;
  }

  public async isAllowed(groupId: string, user: TelegramUser): Promise<boolean> {
    const name = normalizedProfileName(user);
    const allowedNames = await this.loadAllowed(groupId);
    return allowedNames.some((allowed) => allowed.normalizedName === name.normalized);
  }

  public async add(groupId: string, pattern: string, actorTelegramId: bigint) {
    const displayPattern = pattern.replace(/\s+/gu, ' ').trim();
    const normalized = normalizeName(displayPattern);
    if (!isValidForbiddenName(displayPattern) || isProtectedNeutralName(displayPattern))
      return null;
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
    const entries = await this.database.forbiddenName.findMany({
      where: { groupId, enabled: true, deletedAt: null },
      select: { id: true, pattern: true, compactPattern: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return entries
      .filter(({ compactPattern }) => !PROTECTED_NEUTRAL_NAMES.has(compactPattern))
      .map(({ id, pattern }) => ({ id, pattern }));
  }

  public async allow(groupId: string, displayName: string, actorTelegramId: bigint) {
    const normalizedName = normalizeName(displayName).normalized;
    if (!normalizedName || normalizedName.length > 128) return null;
    const result = await this.database.allowedName.upsert({
      where: { groupId_normalizedName: { groupId, normalizedName } },
      create: {
        groupId,
        displayName: displayName.trim(),
        normalizedName,
        createdByTelegramId: actorTelegramId,
      },
      update: {
        displayName: displayName.trim(),
        enabled: true,
        deletedAt: null,
        createdByTelegramId: actorTelegramId,
      },
    });
    await this.invalidateAllowed(groupId);
    return result;
  }

  public async removeAllowed(groupId: string, id: string): Promise<boolean> {
    const result = await this.database.allowedName.updateMany({
      where: { id, groupId, deletedAt: null },
      data: { enabled: false, deletedAt: new Date() },
    });
    if (result.count > 0) await this.invalidateAllowed(groupId);
    return result.count > 0;
  }

  public async listAllowed(groupId: string) {
    return this.database.allowedName.findMany({
      where: { groupId, enabled: true, deletedAt: null },
      select: { id: true, displayName: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
  }

  private async load(groupId: string): Promise<CachedForbiddenName[]> {
    const key = this.cacheKey(groupId);
    const cached = await this.redis.get(key);
    if (cached) {
      return (JSON.parse(cached) as CachedForbiddenName[]).filter(
        ({ compactPattern }) => !PROTECTED_NEUTRAL_NAMES.has(compactPattern),
      );
    }
    const storedEntries = await this.database.forbiddenName.findMany({
      where: { groupId, enabled: true, deletedAt: null },
      select: {
        id: true,
        pattern: true,
        normalizedPattern: true,
        compactPattern: true,
      },
    });
    const entries = storedEntries.filter(
      ({ compactPattern }) => !PROTECTED_NEUTRAL_NAMES.has(compactPattern),
    );
    await this.redis.set(key, JSON.stringify(entries), 'EX', CACHE_SECONDS);
    return entries;
  }

  private async invalidate(groupId: string): Promise<void> {
    await this.redis.del(this.cacheKey(groupId));
  }

  private async loadAllowed(groupId: string): Promise<CachedAllowedName[]> {
    const key = this.allowedCacheKey(groupId);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as CachedAllowedName[];
    const entries = await this.database.allowedName.findMany({
      where: { groupId, enabled: true, deletedAt: null },
      select: { id: true, displayName: true, normalizedName: true },
    });
    await this.redis.set(key, JSON.stringify(entries), 'EX', CACHE_SECONDS);
    return entries;
  }

  private async invalidateAllowed(groupId: string): Promise<void> {
    await this.redis.del(this.allowedCacheKey(groupId));
  }

  private cacheKey(groupId: string): string {
    return forbiddenNameCacheKey(groupId);
  }

  private allowedCacheKey(groupId: string): string {
    return allowedNameCacheKey(groupId);
  }
}
