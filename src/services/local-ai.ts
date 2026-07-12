import { z } from 'zod';

const MAXIMUM_STRUCTURED_RESPONSE_BYTES = 8 * 1_024;
const MAXIMUM_CHAT_RESPONSE_BYTES = 32 * 1_024;
const CIRCUIT_BREAKER_FAILURES = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

export type LocalAiPriority = 'moderation' | 'chat';

export interface LocalAiGenerateOptions {
  systemInstruction: string;
  input: string;
  temperature: number;
  maxTokens: number;
  priority: LocalAiPriority;
  responseSchema?: object;
}

export interface LocalAiClientOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  requestTimeoutMs: number;
  chatTimeoutMs: number;
  maximumConcurrency: number;
  maximumQueueLength: number;
  queueTimeoutMs: number;
}

interface QueueWaiter {
  priority: LocalAiPriority;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const localAiResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().min(1) }),
        finish_reason: z.string().nullable(),
      }),
    )
    .min(1),
});

export class LocalAiQueueFullError extends Error {
  public constructor() {
    super('Die lokale KI-Warteschlange ist ausgelastet.');
    this.name = 'LocalAiQueueFullError';
  }
}

export class LocalAiQueueTimeoutError extends Error {
  public constructor() {
    super('Die lokale KI-Anfrage hat zu lange in der Warteschlange gewartet.');
    this.name = 'LocalAiQueueTimeoutError';
  }
}

export class LocalAiUnavailableError extends Error {
  public constructor() {
    super('Der lokale KI-Dienst befindet sich vorübergehend in einer Sperrzeit.');
    this.name = 'LocalAiUnavailableError';
  }
}

export class LocalAiHttpError extends Error {
  public constructor(public readonly status: number) {
    super(`Die lokale KI antwortete mit HTTP ${status}.`);
    this.name = 'LocalAiHttpError';
  }
}

function contributesToCircuitBreaker(error: unknown): boolean {
  if (error instanceof LocalAiHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  return (
    error instanceof TypeError ||
    (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
  );
}

async function readLimitedResponseText(response: Response, maximumBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return '';
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    byteCount += chunk.value.byteLength;
    if (byteCount > maximumBytes) {
      await reader.cancel();
      throw new Error('Die lokale KI-Antwort ist zu groß.');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

class LocalAiScheduler {
  private activeTasks = 0;
  private activeChatTasks = 0;
  private readonly waiters: QueueWaiter[] = [];

  public constructor(
    private readonly maximumConcurrency: number,
    private readonly maximumQueueLength: number,
    private readonly queueTimeoutMs: number,
  ) {}

  public async run<T>(priority: LocalAiPriority, task: () => Promise<T>): Promise<T> {
    const release = await this.acquire(priority);
    try {
      return await task();
    } finally {
      release();
    }
  }

  private async acquire(priority: LocalAiPriority): Promise<() => void> {
    if (this.waiters.length >= this.maximumQueueLength) {
      if (priority !== 'moderation') throw new LocalAiQueueFullError();
      const displacedChatIndex = this.waiters.findLastIndex((waiter) => waiter.priority === 'chat');
      if (displacedChatIndex < 0) throw new LocalAiQueueFullError();
      const [displacedChat] = this.waiters.splice(displacedChatIndex, 1);
      if (displacedChat) {
        clearTimeout(displacedChat.timer);
        displacedChat.reject(new LocalAiQueueFullError());
      }
    }

    return await new Promise<() => void>((resolve, reject) => {
      const waiter: QueueWaiter = {
        priority,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new LocalAiQueueTimeoutError());
        }, this.queueTimeoutMs),
      };
      waiter.timer.unref();
      this.waiters.push(waiter);
      this.drain();
    });
  }

  private drain(): void {
    while (this.activeTasks < this.maximumConcurrency) {
      let index = this.waiters.findIndex((waiter) => waiter.priority === 'moderation');
      if (index < 0 && this.activeChatTasks === 0) {
        index = this.waiters.findIndex((waiter) => waiter.priority === 'chat');
      }
      if (index < 0) return;

      const [waiter] = this.waiters.splice(index, 1);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.activeTasks += 1;
      if (waiter.priority === 'chat') this.activeChatTasks += 1;

      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.activeTasks -= 1;
        if (waiter.priority === 'chat') this.activeChatTasks -= 1;
        this.drain();
      });
    }
  }
}

export class LocalAiClient {
  private readonly endpoint: string;
  private readonly scheduler: LocalAiScheduler;
  private consecutiveFailures = 0;
  private unavailableUntil = 0;

  public constructor(private readonly options: LocalAiClientOptions) {
    this.endpoint = `${options.baseUrl.replace(/\/+$/u, '')}/v1/chat/completions`;
    this.scheduler = new LocalAiScheduler(
      options.maximumConcurrency,
      options.maximumQueueLength,
      options.queueTimeoutMs,
    );
  }

  public async generate(options: LocalAiGenerateOptions): Promise<string> {
    if (Date.now() < this.unavailableUntil) throw new LocalAiUnavailableError();
    return await this.scheduler.run(options.priority, async () => {
      if (Date.now() < this.unavailableUntil) throw new LocalAiUnavailableError();
      return await this.request(options);
    });
  }

  private async request(options: LocalAiGenerateOptions): Promise<string> {
    const systemInstruction = options.responseSchema
      ? `${options.systemInstruction}\n\nGib ausschließlich ein JSON-Objekt zurück, das exakt diesem JSON-Schema entspricht: ${JSON.stringify(options.responseSchema)}`
      : options.systemInstruction;
    const requestBody: Record<string, unknown> = {
      model: this.options.model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: options.input },
      ],
      temperature: options.temperature,
      seed: 0,
      max_tokens: options.maxTokens,
      stream: false,
      cache_prompt: true,
      chat_template_kwargs: { enable_thinking: false },
      reasoning_format: 'none',
    };
    if (options.responseSchema) {
      requestBody.response_format = {
        type: 'json_object',
      };
    }

    try {
      const maximumResponseBytes = options.responseSchema
        ? MAXIMUM_STRUCTURED_RESPONSE_BYTES
        : MAXIMUM_CHAT_RESPONSE_BYTES;
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        redirect: 'error',
        signal: AbortSignal.timeout(
          options.priority === 'chat' ? this.options.chatTimeoutMs : this.options.requestTimeoutMs,
        ),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new LocalAiHttpError(response.status);
      }
      this.consecutiveFailures = 0;
      this.unavailableUntil = 0;
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > maximumResponseBytes) {
        await response.body?.cancel();
        throw new Error('Die lokale KI-Antwort ist zu groß.');
      }
      const responseText = await readLimitedResponseText(response, maximumResponseBytes);

      const parsed = localAiResponseSchema.parse(JSON.parse(responseText));
      const firstChoice = parsed.choices[0];
      if (options.responseSchema && firstChoice?.finish_reason !== 'stop') {
        throw new Error('Die strukturierte lokale KI-Antwort wurde nicht vollständig beendet.');
      }
      const content = firstChoice?.message.content.trim();
      if (!content) throw new Error('Die lokale KI lieferte keine Textantwort.');
      return content;
    } catch (error) {
      if (contributesToCircuitBreaker(error)) {
        this.consecutiveFailures += 1;
        if (this.consecutiveFailures >= CIRCUIT_BREAKER_FAILURES) {
          this.unavailableUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
        }
      }
      throw error;
    }
  }
}
