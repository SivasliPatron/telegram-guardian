import pino, { type Logger } from 'pino';
import type { Env } from './env.js';

export function createLogger(env: Env): Logger {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: ['BOT_TOKEN', 'token', '*.token', 'req.headers.authorization', 'password'],
      censor: '[REDACTED]',
    },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: true } } }
      : {}),
  });
}
