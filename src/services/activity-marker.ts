import type { RedisClient } from './redis.js';

export const ACTIVITY_MARKER_TTL_SECONDS = 10 * 24 * 60 * 60;

export function activityMarkerKey(groupId: string, telegramId: bigint): string {
  return `inactivity-activity:${groupId}:${telegramId}`;
}

export async function recordActivityMarker(
  redis: RedisClient,
  groupId: string,
  telegramId: bigint,
  occurredAt: Date,
): Promise<void> {
  const script = [
    "local current = redis.call('get', KEYS[1])",
    'if (not current) or (tonumber(ARGV[1]) > tonumber(current)) then',
    "  redis.call('set', KEYS[1], ARGV[1], 'EX', ARGV[2])",
    '  return 1',
    'end',
    "redis.call('expire', KEYS[1], ARGV[2])",
    'return 0',
  ].join('\n');
  await redis.eval(
    script,
    1,
    activityMarkerKey(groupId, telegramId),
    occurredAt.getTime().toString(),
    ACTIVITY_MARKER_TTL_SECONDS.toString(),
  );
}

export async function readActivityMarker(
  redis: RedisClient,
  groupId: string,
  telegramId: bigint,
): Promise<Date | null> {
  const raw = await redis.get(activityMarkerKey(groupId, telegramId));
  if (!raw) return null;
  const timestamp = Number(raw);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp);
}
