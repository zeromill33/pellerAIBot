import { Bot } from "grammy";
import { createBotHandler } from "./index.js";
import { validateTelegramConfig } from "../config/config.schema.js";
import type { TelegramBotConfig } from "../config/config.schema.js";
import type { BotCommandResult } from "./index.js";
import type { PublishBatchReceipt } from "./commands/publish.js";
import type { ErrorReceipt } from "../orchestrator/types.js";

function formatPublishReceipt(receipt: PublishBatchReceipt): string {
  const summary = receipt.summary;
  const lines: string[] = [
    `request_id: ${receipt.request_id}`,
    `summary: total=${summary.total} succeeded=${summary.succeeded} failed=${summary.failed} invalid=${summary.invalid}`
  ];

  if (receipt.successes.length > 0) {
    lines.push(
      `successes: ${receipt.successes
        .map((item) => item.event_slug)
        .join(", ")}`
    );
  }

  if (receipt.failures.length > 0) {
    lines.push(
      `failures: ${receipt.failures
        .map((item) => `${item.event_slug} (${item.error.code})`)
        .join(", ")}`
    );
  }

  if (receipt.invalid_urls.length > 0) {
    lines.push(
      `invalid_urls: ${receipt.invalid_urls.map((item) => item.url).join(", ")}`
    );
  }

  return lines.join("\n");
}

function formatErrorReceipt(error: ErrorReceipt): string {
  const lines = [
    `error_code: ${error.code}`,
    `message: ${error.message}`,
    `category: ${error.category}`,
    `retryable: ${error.retryable}`
  ];

  if (error.suggestion) {
    const suggestion = [
      `action=${error.suggestion.action}`,
      error.suggestion.preferred_lane
        ? `preferred_lane=${error.suggestion.preferred_lane}`
        : null,
      error.suggestion.message ? `message=${error.suggestion.message}` : null
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(`suggestion: ${suggestion}`);
  }

  return lines.join("\n");
}

function formatBotResponse(result: BotCommandResult): string {
  if (result.status === "ok") {
    return formatPublishReceipt(result.receipt);
  }

  return formatErrorReceipt(result.error);
}

export function createTelegramBot(rawConfig: Partial<TelegramBotConfig>): Bot {
  const config = validateTelegramConfig(rawConfig);
  const handler = createBotHandler(config);
  const bot = new Bot(config.bot_token);

  bot.command("publish", async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) {
      await ctx.reply("Unable to identify user");
      return;
    }

    const text = ctx.message?.text ?? "/publish";
    const result = await handler({ user_id: userId, text });
    await ctx.reply(formatBotResponse(result));
  });

  bot.catch((error) => {
    console.error({
      message: "telegram_bot_error",
      error: error.error instanceof Error ? error.error.message : String(error)
    });
  });

  return bot;
}

export async function startTelegramBot(
  rawConfig: Partial<TelegramBotConfig>
): Promise<Bot> {
  const bot = createTelegramBot(rawConfig);
  await bot.start();
  return bot;
}
