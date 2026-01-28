import { createAppError, ERROR_CODES } from "../errors.js";
import type { ReportV1Json } from "../../providers/llm/types.js";
import { validateReport } from "../../validator/index.js";

type ReportValidateInput = {
  event_slug: string;
  report_json: ReportV1Json | string;
};

type ReportValidateOutput = {
  report_json: ReportV1Json;
};

export async function validateReportJson(
  input: ReportValidateInput
): Promise<ReportValidateOutput> {
  if (input.report_json === null || input.report_json === undefined) {
    throw createAppError({
      code: ERROR_CODES.STEP_REPORT_VALIDATE_MISSING_INPUT,
      message: "Missing report_json for report.validate",
      category: "VALIDATION",
      retryable: false,
      details: { event_slug: input.event_slug }
    });
  }

  const result = validateReport(input.report_json);
  if (!result.ok) {
    throw createAppError({
      code: result.code,
      message: result.message,
      category: "VALIDATION",
      retryable: false,
      details: {
        event_slug: input.event_slug,
        ...(result.details ?? {})
      },
      suggestion: result.suggestion
    });
  }

  return { report_json: result.report };
}

export type { ReportValidateInput, ReportValidateOutput };
