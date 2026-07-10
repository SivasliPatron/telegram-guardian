import Redis from 'ioredis';

export function createRedis(url: string): Redis {
  return new Redis(url, {
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  });
}

export type RedisClient = ReturnType<typeof createRedis>;
