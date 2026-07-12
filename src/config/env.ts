import { z } from 'zod';
import {
  DEFAULT_AI_FALLBACK_MODELS,
  DEFAULT_AI_MODEL,
  isValidGeminiFallbackList,
} from './ai-models.js';

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

const privateServiceUrlSchema = z
  .url()
  .max(2_048)
  .superRefine((value, context) => {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      context.addIssue({ code: 'custom', message: 'Nur HTTP- oder HTTPS-Adressen sind erlaubt' });
    }
    if (url.username || url.password || url.search || url.hash) {
      context.addIssue({
        code: 'custom',
        message:
          'Die Dienstadresse darf keine Zugangsdaten, Suchparameter oder Fragmente enthalten',
      });
    }
  });

const privateServiceApiKeySchema = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[\x21-\x7e]+$/u, 'Der API-Schlüssel darf keine Leer- oder Steuerzeichen enthalten');

const optionalGeminiApiKeySchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(20).optional(),
);
const optionalPrivateServiceUrlSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  privateServiceUrlSchema.optional(),
);
const optionalPrivateServiceApiKeySchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  privateServiceApiKeySchema.optional(),
);

function isInsecureHttpUrl(value: string | undefined): boolean {
  return value !== undefined && new URL(value).protocol === 'http:';
}

function connectionUrlSchema(protocols: readonly string[], message: string) {
  return z
    .string()
    .max(2_048)
    .superRefine((value, context) => {
      try {
        const url = new URL(value);
        if (!protocols.includes(url.protocol)) context.addIssue({ code: 'custom', message });
      } catch {
        context.addIssue({ code: 'custom', message });
      }
    });
}

export const envSchema = z
  .object({
    BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/, 'Ungültiges Telegram-Bot-Token'),
    DATABASE_URL: connectionUrlSchema(['postgresql:'], 'Ungültige PostgreSQL-Adresse'),
    REDIS_URL: connectionUrlSchema(['redis:', 'rediss:'], 'Ungültige Redis-/Valkey-Adresse'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DEFAULT_TIMEZONE: timezoneSchema.default('Europe/Berlin'),
    OWNER_TELEGRAM_ID: z.string().regex(/^\d+$/, 'Telegram-ID muss numerisch sein'),
    HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    AI_PROVIDER: z.enum(['gemini', 'local', 'local_gemini_fallback']).default('gemini'),
    AI_FILTER_ENABLED: booleanEnvSchema.default(false),
    GEMINI_API_KEY: optionalGeminiApiKeySchema,
    AI_MODEL: z.string().min(1).default(DEFAULT_AI_MODEL),
    AI_FALLBACK_MODELS: z
      .string()
      .max(500)
      .refine(isValidGeminiFallbackList, 'Ungültige oder zu lange Gemini-Fallbackliste')
      .default(DEFAULT_AI_FALLBACK_MODELS.join(',')),
    AI_FILTER_TIMEOUT_MS: z.coerce.number().int().min(500).max(15_000).default(3_000),
    AI_FILTER_LOG_THRESHOLD: z.coerce.number().min(0).max(1).default(0.45),
    AI_FILTER_WARN_THRESHOLD: z.coerce.number().min(0).max(1).default(0.72),
    AI_FILTER_CACHE_TTL_SEC: z.coerce.number().int().min(60).max(86_400).default(3_600),
    AI_AUDIO_FILTER_ENABLED: booleanEnvSchema.default(false),
    AI_AUDIO_MAX_DURATION_SEC: z.coerce.number().int().min(5).max(600).default(120),
    AI_AUDIO_MAX_BYTES: z.coerce.number().int().min(100_000).max(20_000_000).default(10_000_000),
    AI_AUDIO_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
    AI_AUDIO_LOG_THRESHOLD: z.coerce.number().min(0).max(1).default(0.4),
    AI_AUDIO_WARN_THRESHOLD: z.coerce.number().min(0).max(1).default(0.65),
    AI_NAME_FILTER_ENABLED: booleanEnvSchema.default(false),
    AI_NAME_LOG_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
    AI_NAME_KICK_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
    LOCAL_AI_BASE_URL: optionalPrivateServiceUrlSchema,
    LOCAL_AI_API_KEY: optionalPrivateServiceApiKeySchema,
    LOCAL_AI_MODEL: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:/-]+$/u, 'Ungültige lokale Modellkennung')
      .default('guardian-qwen-3.5-2b'),
    LOCAL_AI_MODEL_REVISION: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._-]+$/u, 'Ungültige lokale Modellrevision')
      .default('84aeb7fe40e7b833d71303d7f1b9f9c1991b931b5dbd214e0aa48d56a0af1f85'),
    LOCAL_AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(8_000),
    LOCAL_AI_CHAT_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(45_000),
    LOCAL_AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(2),
    LOCAL_AI_MAX_QUEUE: z.coerce.number().int().min(1).max(500).default(50),
    LOCAL_AI_QUEUE_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(10_000),
    LOCAL_ASR_BASE_URL: optionalPrivateServiceUrlSchema,
    LOCAL_ASR_API_KEY: optionalPrivateServiceApiKeySchema,
    LOCAL_ASR_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(180_000),
    LOCAL_SERVICES_ALLOW_INSECURE_HTTP: booleanEnvSchema.default(false),
  })
  .superRefine((env, context) => {
    if (env.AI_FILTER_ENABLED && env.AI_PROVIDER !== 'local' && !env.GEMINI_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY ist bei aktiviertem KI-Filter erforderlich',
      });
    }
    if (env.AI_PROVIDER !== 'gemini' && !env.LOCAL_AI_BASE_URL) {
      context.addIssue({
        code: 'custom',
        path: ['LOCAL_AI_BASE_URL'],
        message: 'LOCAL_AI_BASE_URL ist beim lokalen KI-Provider erforderlich',
      });
    }
    if (env.AI_PROVIDER !== 'gemini' && !env.LOCAL_AI_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['LOCAL_AI_API_KEY'],
        message: 'LOCAL_AI_API_KEY ist beim lokalen KI-Provider erforderlich',
      });
    }
    if (
      env.NODE_ENV === 'production' &&
      env.AI_PROVIDER !== 'gemini' &&
      isInsecureHttpUrl(env.LOCAL_AI_BASE_URL) &&
      !env.LOCAL_SERVICES_ALLOW_INSECURE_HTTP
    ) {
      context.addIssue({
        code: 'custom',
        path: ['LOCAL_AI_BASE_URL'],
        message:
          'HTTP für lokale Dienste muss in Produktion ausdrücklich als internes Netz freigegeben werden',
      });
    }
    if (env.AI_PROVIDER === 'local_gemini_fallback' && !env.GEMINI_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY ist für die ausgewählte Gemini-Notreserve erforderlich',
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
    if (env.AI_AUDIO_FILTER_ENABLED && env.AI_PROVIDER !== 'gemini' && !env.LOCAL_ASR_BASE_URL) {
      context.addIssue({
        code: 'custom',
        path: ['LOCAL_ASR_BASE_URL'],
        message: 'LOCAL_ASR_BASE_URL ist für lokale Audiomoderation erforderlich',
      });
    }
    if (env.AI_AUDIO_FILTER_ENABLED && env.AI_PROVIDER !== 'gemini' && !env.LOCAL_ASR_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['LOCAL_ASR_API_KEY'],
        message: 'LOCAL_ASR_API_KEY ist für lokale Audiomoderation erforderlich',
      });
    }
    if (
      env.NODE_ENV === 'production' &&
      env.AI_AUDIO_FILTER_ENABLED &&
      env.AI_PROVIDER !== 'gemini' &&
      isInsecureHttpUrl(env.LOCAL_ASR_BASE_URL) &&
      !env.LOCAL_SERVICES_ALLOW_INSECURE_HTTP
    ) {
      context.addIssue({
        code: 'custom',
        path: ['LOCAL_ASR_BASE_URL'],
        message:
          'HTTP für lokale Dienste muss in Produktion ausdrücklich als internes Netz freigegeben werden',
      });
    }
    if (env.AI_AUDIO_LOG_THRESHOLD >= env.AI_AUDIO_WARN_THRESHOLD) {
      context.addIssue({
        code: 'custom',
        path: ['AI_AUDIO_WARN_THRESHOLD'],
        message: 'Die Audio-Verwarnschwelle muss über der Audio-Logschwelle liegen',
      });
    }
    if (env.AI_NAME_FILTER_ENABLED && !env.AI_FILTER_ENABLED) {
      context.addIssue({
        code: 'custom',
        path: ['AI_NAME_FILTER_ENABLED'],
        message: 'Der Text-KI-Filter muss als Grundlage ebenfalls aktiviert sein',
      });
    }
    if (env.AI_NAME_LOG_THRESHOLD >= env.AI_NAME_KICK_THRESHOLD) {
      context.addIssue({
        code: 'custom',
        path: ['AI_NAME_KICK_THRESHOLD'],
        message: 'Die KI-Namensperre muss über der Namens-Logschwelle liegen',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined>): Env {
  return envSchema.parse(source);
}
