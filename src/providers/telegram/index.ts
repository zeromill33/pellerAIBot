import { createAppError, ERROR_CODES } from "../../orchestrator/errors.js";
import { loadPublishConfig } from "../../config/load.js";
import type { PublishConfig } from "../../config/config.schema.js";

export type TelegramPublisher = {
  publishToChannel(text: string): Promise<{ message_id: string }>;
};

export type TelegramPublisherOptions = {
  bot_token?: string;
  publishConfig?: PublishConfig;
  fetch?: typeof fetch;
};

type TelegramResponse = {
  ok: boolean;
  result?: { message_id?: number | string };
  description?: string;
};

const DEFAULT_TIMEOUT_MS = 15000;

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

export function createTelegramPublisher(
  options: TelegramPublisherOptions = {}
): TelegramPublisher {
  const fetchImpl = options.fetch ?? fetch;

  return {
    async publishToChannel(text: string): Promise<{ message_id: string }> {
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

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
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
          throw createAppError({
            code: ERROR_CODES.PROVIDER_TG_REQUEST_FAILED,
            message: json.description ?? `Telegram API failed (${response.status})`,
            category: "PUBLISH",
            retryable: response.status >= 500 || response.status === 429
          });
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
        if (error instanceof Error && error.name === "AbortError") {
          throw createAppError({
            code: ERROR_CODES.PROVIDER_TG_REQUEST_FAILED,
            message: "Telegram API request timed out",
            category: "PUBLISH",
            retryable: true
          });
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}
