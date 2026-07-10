import 'dotenv/config';
import { parseEnv } from '../config/env.js';
import { createDatabase } from '../database/client.js';
import { createRedis } from '../services/redis.js';
import { applyRecommendedGroupSetup } from '../services/group-setup.js';

const env = parseEnv(process.env);
const database = createDatabase(env.DATABASE_URL);
const redis = createRedis(env.REDIS_URL);

try {
  await Promise.all([database.$connect(), redis.ping()]);
  const groups = await database.telegramGroup.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  for (const group of groups) {
    await applyRecommendedGroupSetup(database, redis, group.id, BigInt(env.OWNER_TELEGRAM_ID));
  }
  process.stdout.write(`Empfohlenes Setup auf ${groups.length} aktive Gruppe(n) angewendet.\n`);
} finally {
  await Promise.allSettled([database.$disconnect(), redis.quit()]);
}
