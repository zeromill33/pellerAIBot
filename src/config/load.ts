import {
  validateConfig,
  validatePublishConfig,
  validateTelegramConfig,
  validateTavilyConfig
} from "./config.schema.js";
import type {
  BotConfig,
  TavilyConfig,
  TelegramBotConfig,
  PublishConfig
} from "./config.schema.js";

export function parseAdminUserIds(raw: string | undefined): number[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const adminUserIds = parseAdminUserIds(env.ADMIN_USER_IDS);
  return validateConfig({ admin_user_ids: adminUserIds });
}

export function loadTelegramConfig(
  env: NodeJS.ProcessEnv = process.env
): TelegramBotConfig {
  const adminUserIds = parseAdminUserIds(env.ADMIN_USER_IDS);
  const botToken = env.TG_BOT_TOKEN?.trim();
  return validateTelegramConfig({
    admin_user_ids: adminUserIds,
    bot_token: botToken
  });
}

export function loadTavilyConfig(
  env: NodeJS.ProcessEnv = process.env
): TavilyConfig {
  const apiKey = env.TAVILY_API_KEY?.trim();
  return validateTavilyConfig({ api_key: apiKey });
}

export function loadPublishConfig(
  env: NodeJS.ProcessEnv = process.env
): PublishConfig {
  return validatePublishConfig({
    strategy: env.PUBLISH_STRATEGY?.trim().toLowerCase() as
      | "auto"
      | "approve"
      | undefined,
    channel_chat_id: env.TG_CHANNEL_CHAT_ID?.trim(),
    parse_mode: env.TG_PARSE_MODE?.trim() as
      | "Markdown"
      | "MarkdownV2"
      | "HTML"
      | undefined,
    disable_web_page_preview:
      env.TG_DISABLE_PREVIEW !== undefined
        ? env.TG_DISABLE_PREVIEW === "true" || env.TG_DISABLE_PREVIEW === "1"
        : undefined
  });
}
