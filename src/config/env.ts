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

const booleanEnvSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

export const envSchema = z
  .object({
    BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/, 'Ungültiges Telegram-Bot-Token'),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    REDIS_URL: z.string().startsWith('redis://'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DEFAULT_TIMEZONE: timezoneSchema.default('Europe/Berlin'),
    OWNER_TELEGRAM_ID: z.string().regex(/^\d+$/, 'Telegram-ID muss numerisch sein'),
    HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    AI_FILTER_ENABLED: booleanEnvSchema.default(false),
    GEMINI_API_KEY: z.string().min(20).optional(),
    AI_MODEL: z.string().min(1).default('gemini-3.1-flash-lite'),
    AI_FILTER_TIMEOUT_MS: z.coerce.number().int().min(500).max(15_000).default(3_000),
    AI_FILTER_LOG_THRESHOLD: z.coerce.number().min(0).max(1).default(0.72),
    AI_FILTER_WARN_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
    AI_FILTER_CACHE_TTL_SEC: z.coerce.number().int().min(60).max(86_400).default(3_600),
    AI_AUDIO_FILTER_ENABLED: booleanEnvSchema.default(false),
    AI_AUDIO_MAX_DURATION_SEC: z.coerce.number().int().min(5).max(600).default(120),
    AI_AUDIO_MAX_BYTES: z.coerce.number().int().min(100_000).max(20_000_000).default(10_000_000),
    AI_AUDIO_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  })
  .superRefine((env, context) => {
    if (env.AI_FILTER_ENABLED && !env.GEMINI_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY ist bei aktiviertem KI-Filter erforderlich',
      });
    }
    if (env.AI_FILTER_LOG_THRESHOLD >= env.AI_FILTER_WARN_THRESHOLD) {
      context.addIssue({
        code: 'custom',
        path: ['AI_FILTER_WARN_THRESHOLD'],
        message: 'Die Verwarnschwelle muss über der Logschwelle liegen',
      });
    }
    if (env.AI_AUDIO_FILTER_ENABLED && !env.AI_FILTER_ENABLED) {
      context.addIssue({
        code: 'custom',
        path: ['AI_AUDIO_FILTER_ENABLED'],
        message: 'Der Text-KI-Filter muss als Grundlage ebenfalls aktiviert sein',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined>): Env {
  return envSchema.parse(source);
}
