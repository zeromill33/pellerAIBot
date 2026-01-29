import { createAppError, ERROR_CODES } from "../errors.js";
import type { ReportV1Json } from "../../providers/llm/types.js";
import { renderTelegramReport } from "../../renderer/index.js";

export type TelegramRenderInput = {
  event_slug: string;
  report_json: ReportV1Json;
};

export type TelegramRenderOutput = {
  report_json: ReportV1Json;
  tg_post_text: string;
};

export async function renderTelegramDraft(
  input: TelegramRenderInput
): Promise<TelegramRenderOutput> {
  if (!input.report_json) {
    throw createAppError({
      code: ERROR_CODES.STEP_TELEGRAM_RENDER_MISSING_INPUT,
      message: "Missing report_json for telegram.render",
      category: "RENDER",
      retryable: false,
      details: { event_slug: input.event_slug }
    });
  }

  const tg_post_text = renderTelegramReport(input.report_json);
  return { report_json: input.report_json, tg_post_text };
}
