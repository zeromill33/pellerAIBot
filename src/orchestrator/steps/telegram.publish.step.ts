import { AppError, createAppError, ERROR_CODES } from "../errors.js";
import { createTelegramPublisher, type TelegramPublisher } from "../../providers/telegram/index.js";
import { getDefaultSqliteStorageAdapter, type StorageAdapter } from "../../storage/index.js";

export type TelegramPublishInput = {
  request_id: string;
  event_slug: string;
  run_id: string;
  tg_post_text?: string | null;
};

export type TelegramPublishOutput = {
  message_id: string;
};

export type TelegramPublishOptions = {
  publisher?: TelegramPublisher;
  storage?: StorageAdapter;
};

export async function publishTelegramMessage(
  input: TelegramPublishInput,
  options: TelegramPublishOptions = {}
): Promise<TelegramPublishOutput> {
  const text = input.tg_post_text?.trim();
  if (!text) {
    throw createAppError({
      code: ERROR_CODES.STEP_TELEGRAM_PUBLISH_MISSING_INPUT,
      message: "Missing tg_post_text for telegram.publish",
      category: "PUBLISH",
      retryable: false,
      details: { event_slug: input.event_slug }
    });
  }

  const publisher = options.publisher ?? createTelegramPublisher();
  const storage = options.storage ?? getDefaultSqliteStorageAdapter();

  try {
    const result = await publisher.publishToChannel(text);
    storage.updateReportPublish({
      report_id: `report_${input.run_id}`,
      status: "published",
      tg_message_id: result.message_id
    });
    console.info({
      message: "telegram.publish.success",
      step_id: "telegram.publish",
      request_id: input.request_id,
      run_id: input.run_id,
      event_slug: input.event_slug,
      message_id: result.message_id
    });
    return { message_id: result.message_id };
  } catch (error) {
    const appError =
      error instanceof AppError
        ? error
        : createAppError({
            code: ERROR_CODES.PROVIDER_TG_REQUEST_FAILED,
            message:
              error instanceof Error ? error.message : "Telegram publish failed",
            category: "PUBLISH",
            retryable: true,
            details: { event_slug: input.event_slug }
          });
    try {
      storage.updateReportStatus({
        report_id: `report_${input.run_id}`,
        status: "blocked",
        validator_code: appError.code,
        validator_message: appError.message
      });
    } catch (persistError) {
      console.error({
        message: "telegram.publish.status_update_failed",
        step_id: "telegram.publish",
        request_id: input.request_id,
        run_id: input.run_id,
        event_slug: input.event_slug,
        error: persistError instanceof Error ? persistError.message : String(persistError)
      });
    }
    console.info({
      message: "telegram.publish.failed",
      step_id: "telegram.publish",
      request_id: input.request_id,
      run_id: input.run_id,
      event_slug: input.event_slug,
      error_code: appError.code,
      error_category: appError.category
    });
    throw appError;
  }
}
