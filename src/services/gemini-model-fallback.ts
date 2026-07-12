import type { Logger } from 'pino';

const RATE_LIMIT_COOLDOWN_MS = 60_000;
const SERVICE_COOLDOWN_MS = 30_000;
const NETWORK_COOLDOWN_MS = 10_000;
const MISSING_MODEL_COOLDOWN_MS = 24 * 60 * 60 * 1_000;
const MAXIMUM_RETRY_DELAY_MS = 24 * 60 * 60 * 1_000;
const MAXIMUM_BACKOFF_MULTIPLIER = 64;

type Clock = () => number;

export class NoGeminiModelAvailableError extends Error {
  public constructor() {
    super('Alle konfigurierten Gemini-Modelle befinden sich vorübergehend in einer Sperrzeit.');
    this.name = 'NoGeminiModelAvailableError';
  }
}

function errorRecord(error: unknown): Record<string, unknown> | null {
  return typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : null;
}

export function geminiErrorStatus(error: unknown): number | null {
  const record = errorRecord(error);
  if (record && typeof record.status === 'number') return record.status;
  if (record && typeof record.code === 'number') return record.code;

  const message = error instanceof Error ? error.message : String(error);
  const match = /(?:^|\[|\b)(4\d{2}|5\d{2})(?:\b|\s)/u.exec(message);
  return match?.[1] ? Number(match[1]) : null;
}

function parseDurationMilliseconds(value: string): number | null {
  let milliseconds = 0;
  let matched = false;
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)\s*([hms])/giu)) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) continue;
    matched = true;
    if (match[2]?.toLowerCase() === 'h') milliseconds += amount * 60 * 60 * 1_000;
    if (match[2]?.toLowerCase() === 'm') milliseconds += amount * 60 * 1_000;
    if (match[2]?.toLowerCase() === 's') milliseconds += amount * 1_000;
  }
  return matched ? milliseconds : null;
}

export function geminiRetryDelayMilliseconds(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const structured = /retryDelay["']?\s*[:=]\s*["']?([^"'\],}]+)/iu.exec(message)?.[1];
  const natural = /retry(?:\s+in|\s+after)\s+((?:\d+(?:\.\d+)?\s*[hms]\s*)+)/iu.exec(message)?.[1];
  const parsed = parseDurationMilliseconds(structured ?? natural ?? '');
  if (parsed === null) return null;
  return Math.min(MAXIMUM_RETRY_DELAY_MS, Math.max(1_000, Math.ceil(parsed)));
}

export function isGeminiModelFallbackError(error: unknown): boolean {
  const status = geminiErrorStatus(error);
  if (status === 404 || status === 408 || status === 429) return true;
  if (status !== null && status >= 500 && status <= 504) return true;
  if (status !== null) return false;

  const record = errorRecord(error);
  const code = typeof record?.code === 'string' ? record.code.toUpperCase() : '';
  if (['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) {
    return true;
  }

  const name = error instanceof Error ? error.name : '';
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    /fetch failed|network error|socket hang up|timed out/iu.test(message)
  );
}

export function geminiModelCooldownMilliseconds(error: unknown): number {
  const retryDelay = geminiRetryDelayMilliseconds(error);
  if (retryDelay !== null) return retryDelay;

  const status = geminiErrorStatus(error);
  if (status === 404) return MISSING_MODEL_COOLDOWN_MS;
  if (status === 429) return RATE_LIMIT_COOLDOWN_MS;
  if (status === 408 || (status !== null && status >= 500 && status <= 504)) {
    return SERVICE_COOLDOWN_MS;
  }
  return NETWORK_COOLDOWN_MS;
}

export class GeminiModelFallback {
  private readonly unavailableUntil = new Map<string, number>();
  private readonly consecutiveFailures = new Map<string, number>();

  public constructor(
    public readonly models: readonly string[],
    private readonly logger: Pick<Logger, 'warn'>,
    private readonly clock: Clock = Date.now,
  ) {
    if (models.length === 0) throw new Error('Mindestens ein Gemini-Modell ist erforderlich.');
  }

  public async run<T>(operation: string, attempt: (model: string) => Promise<T>): Promise<T> {
    const now = this.clock();
    const availableModels = this.models.filter(
      (model) => (this.unavailableUntil.get(model) ?? 0) <= now,
    );
    if (availableModels.length === 0) throw new NoGeminiModelAvailableError();

    let lastError: unknown;
    for (const [index, model] of availableModels.entries()) {
      try {
        const result = await attempt(model);
        this.consecutiveFailures.delete(model);
        this.unavailableUntil.delete(model);
        return result;
      } catch (error) {
        if (!isGeminiModelFallbackError(error)) throw error;
        lastError = error;
        const failures = (this.consecutiveFailures.get(model) ?? 0) + 1;
        this.consecutiveFailures.set(model, failures);
        const multiplier = Math.min(2 ** (failures - 1), MAXIMUM_BACKOFF_MULTIPLIER);
        const baseCooldownMs = geminiModelCooldownMilliseconds(error);
        const cooldownMs = Math.min(MAXIMUM_RETRY_DELAY_MS, baseCooldownMs * multiplier);
        this.unavailableUntil.set(model, this.clock() + cooldownMs);
        this.logger.warn(
          {
            operation,
            model,
            nextModel: availableModels[index + 1] ?? null,
            status: geminiErrorStatus(error),
            cooldownMs,
            consecutiveFailures: failures,
          },
          'Gemini-Modell vorübergehend nicht verfügbar; Fallback wird versucht',
        );
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new NoGeminiModelAvailableError();
  }
}
