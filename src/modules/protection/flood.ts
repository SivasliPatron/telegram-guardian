import type { RedisClient } from '../../services/redis.js';

const FLOOD_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local cutoff = tonumber(ARGV[2])
local member = ARGV[3]
local ttl = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
redis.call('ZADD', key, now, member)
local count = redis.call('ZCARD', key)
redis.call('PEXPIRE', key, ttl)
return count
`;

export async function recordFloodMessage(
  redis: RedisClient,
  groupId: string,
  userId: number,
  updateId: number,
  windowSeconds: number,
): Promise<number> {
  const now = Date.now();
  return Number(
    await redis.eval(
      FLOOD_SCRIPT,
      1,
      `flood:${groupId}:${userId}`,
      now,
      now - windowSeconds * 1_000,
      `${now}-${updateId}`,
      windowSeconds * 1_000 + 1_000,
    ),
  );
}
