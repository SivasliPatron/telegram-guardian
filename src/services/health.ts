import { createServer, type Server, type ServerResponse } from 'node:http';
import type { Database } from '../database/client.js';
import type { RedisClient } from './redis.js';

export function startHealthServer(port: number, database: Database, redis: RedisClient): Server {
  const server = createServer((request, response) => {
    void respondToHealthRequest(request.url, response, database, redis);
  });
  server.listen(port, '0.0.0.0');
  return server;
}

async function respondToHealthRequest(
  requestUrl: string | undefined,
  response: ServerResponse,
  database: Database,
  redis: RedisClient,
): Promise<void> {
  if (requestUrl !== '/health') {
    response.writeHead(404).end();
    return;
  }
  try {
    await Promise.all([database.$queryRaw`SELECT 1`, redis.ping()]);
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
  } catch {
    response.writeHead(503, { 'content-type': 'application/json' }).end('{"status":"unhealthy"}');
  }
}
