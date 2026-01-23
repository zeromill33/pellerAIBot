import { handlePublishCommand } from "./commands/publish.js";
import { guardAdminUser } from "./guard.js";
import {
  AppError,
  createAppError,
  ERROR_CODES,
  toErrorReceipt
} from "../orchestrator/errors.js";
import type { ErrorReceipt } from "../orchestrator/types.js";
import type { BotConfig } from "../config/config.schema.js";
import { validateConfig } from "../config/config.schema.js";
import type { PublishBatchReceipt } from "./commands/publish.js";

export type BotCommandInput = {
  user_id: number;
  text: string;
};

export type BotCommandSuccess = {
  status: "ok";
  receipt: PublishBatchReceipt;
};

export type BotCommandFailure = {
  status: "error";
  error: ErrorReceipt;
};

export type BotCommandResult = BotCommandSuccess | BotCommandFailure;

export function createBotHandler(rawConfig: Partial<BotConfig>) {
  const config = validateConfig(rawConfig);
  return async (input: BotCommandInput): Promise<BotCommandResult> =>
    handleBotCommand(input, config);
}

export async function handleBotCommand(
  input: BotCommandInput,
  config: BotConfig
): Promise<BotCommandResult> {
  try {
    guardAdminUser(input.user_id, config.admin_user_ids);

    const trimmed = input.text.trim();
    if (trimmed.startsWith("/publish")) {
      const result = await handlePublishCommand(input.text);
      return { status: "ok", receipt: result.receipt };
    }

    throw createAppError({
      code: ERROR_CODES.BOT_UNKNOWN_COMMAND,
      message: "Unsupported command",
      category: "VALIDATION",
      retryable: false,
      details: { command: input.text }
    });
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : createAppError({
            code: ERROR_CODES.BOT_COMMAND_FAILED,
            message: "Command handling failed",
            category: "UNKNOWN",
            retryable: false,
            details: {
              reason: error instanceof Error ? error.message : String(error)
            }
          });
    return { status: "error", error: toErrorReceipt(appError) };
  }
}
