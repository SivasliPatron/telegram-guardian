import { z } from 'zod';

const timezoneSchema = z
  .string()
  .min(1)
  .superRefine((value, context) => {
    try {
      new Intl.DateTimeFormat('de-DE', { timeZone: value }).format();
    } catch {
      context.addIssue({ code: 'custom', message: 'Ungültige IANA-Zeitzone' });
    }
  });

export const envSchema = z.object({
  BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/, 'Ungültiges Telegram-Bot-Token'),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  REDIS_URL: z.string().startsWith('redis://'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DEFAULT_TIMEZONE: timezoneSchema.default('Europe/Berlin'),
  OWNER_TELEGRAM_ID: z.string().regex(/^\d+$/, 'Telegram-ID muss numerisch sein'),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined>): Env {
  return envSchema.parse(source);
}
