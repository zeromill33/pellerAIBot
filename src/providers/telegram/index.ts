import { AppError, createAppError, ERROR_CODES } from "../../orchestrator/errors.js";
import { loadPublishConfig } from "../../config/load.js";
import type { PublishConfig } from "../../config/config.schema.js";

export type TelegramPublisher = {
  publishToChannel(text: string): Promise<{ message_id: string }>;
};

export type TelegramPublisherOptions = {
  bot_token?: string;
  publishConfig?: PublishConfig;
  fetch?: typeof fetch;
  retries?: number;
  retryBaseDelayMs?: number;
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type TelegramResponse = {
  ok: boolean;
  result?: { message_id?: number | string };
  description?: string;
  parameters?: { retry_after?: number };
};

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_MIN_INTERVAL_MS = 80;

function resolveBotToken(options: TelegramPublisherOptions): string {
  const token = options.bot_token?.trim() ?? process.env.TG_BOT_TOKEN?.trim();
  if (!token) {
    throw createAppError({
      code: ERROR_CODES.PROVIDER_TG_REQUEST_FAILED,
      message: "Telegram bot token is not configured",
      category: "PUBLISH",
      retryable: false
    });
  }
  return token;
}

function resolvePublishConfig(
  options: TelegramPublisherOptions
): PublishConfig {
  return options.publishConfig ?? loadPublishConfig();
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(
  response: TelegramResponse,
  retryAfterHeader: string | null
): number | null {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }
  }
  const retryAfter = response.parameters?.retry_after;
  if (typeof retryAfter === "number" && Number.isFinite(retryAfter)) {
    return Math.max(0, retryAfter * 1000);
  }
  return null;
}

export function createTelegramPublisher(
  options: TelegramPublisherOptions = {}
): TelegramPublisher {
  const fetchImpl = options.fetch ?? fetch;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? defaultSleep;
  let lastSentAt = 0;
  let queue: Promise<void> = Promise.resolve();

  const enqueue = async <T>(task: () => Promise<T>): Promise<T> => {
    const run = async () => {
      const elapsed = now() - lastSentAt;
      const waitMs = Math.max(0, minIntervalMs - elapsed);
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      const result = await task();
      lastSentAt = now();
      return result;
    };
    const resultPromise = queue.then(run, run);
    queue = resultPromise.then(
      () => undefined,
      () => undefined
    );
    return resultPromise;
  };

  return {
    async publishToChannel(text: string): Promise<{ message_id: string }> {
      return enqueue(async () => {
        const token = resolveBotToken(options);
        const config = resolvePublishConfig(options);
        if (!config.channel_chat_id) {
          throw createAppError({
            code: ERROR_CODES.PROVIDER_TG_REQUEST_FAILED,
            message: "Telegram channel chat_id is not configured",
            category: "PUBLISH",
            retryable: false
          });
        }

        let attempt = 0;
        let lastError: unknown;
        while (attempt <= retries) {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            DEFAULT_TIMEOUT_MS
          );
          try {
            const response = await fetchImpl(
              `https://api.telegram.org/bot${token}/sendMessage`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  chat_id: config.channel_chat_id,
                  text,
                  parse_mode: config.parse_mode,
                  disable_web_page_preview: config.disable_web_page_preview
                }),
                signal: controller.signal
              }
            );

            const json = (await response.json()) as TelegramResponse;
            if (!response.ok || !json.ok) {
              const retryable = response.status >= 500 || response.status === 429;
              const error = createAppError({
                code: ERROR_CODES.PROVIDER_TG_REQUEST_FAILED,
                message:
                  json.description ?? `Telegram API failed (${response.status})`,
                category: "PUBLISH",
                retryable
              });
              const retryAfterMs = parseRetryAfterMs(
                json,
                response.headers?.get("retry-after") ?? null
              );
              if (retryable && attempt < retries) {
                const delayMs =
                  retryAfterMs ?? Math.max(0, retryBaseDelayMs * (attempt + 1));
                if (delayMs > 0) {
                  await sleep(delayMs);
                }
                attempt += 1;
                continue;
              }
              throw error;
            }

            const messageId = json.result?.message_id;
            if (!messageId) {
              throw createAppError({
                code: ERROR_CODES.PROVIDER_TG_RESPONSE_INVALID,
                message: "Telegram API response missing message_id",
                category: "PUBLISH",
                retryable: false
              });
            }

            return { message_id: String(messageId) };
          } catch (error) {
            lastError = error;
            if (error instanceof Error && error.name === "AbortError") {
              if (attempt < retries) {
                await sleep(retryBaseDelayMs * (attempt + 1));
                attempt += 1;
                continue;
              }
              throw createAppError({
                code: ERROR_CODES.PROVIDER_TG_REQUEST_FAILED,
                message: "Telegram API request timed out",
                category: "PUBLISH",
                retryable: true
              });
            }
            if (error instanceof AppError) {
              throw error;
            }
            throw error;
          } finally {
            clearTimeout(timeout);
          }
        }
        throw lastError;
      });
    }
  };
}
