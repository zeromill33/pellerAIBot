import type { ErrorSuggestion } from "../orchestrator/errors.js";
import { ERROR_CODES } from "../orchestrator/errors.js";
import type { ReportV1Json } from "../providers/llm/types.js";
import { validateReportSchema } from "./ajv.js";

export type ReportValidationSuccess = {
  ok: true;
  report: ReportV1Json;
};

export type ReportValidationFailure = {
  ok: false;
  code: string;
  message: string;
  suggestion?: ErrorSuggestion;
  details?: Record<string, unknown>;
};

export type ReportValidationResult =
  | ReportValidationSuccess
  | ReportValidationFailure;

function parseReportJson(input: unknown):
  | { ok: true; value: unknown }
  | { ok: false; message: string } {
  if (typeof input !== "string") {
    return { ok: true, value: input };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, message: "Report JSON is empty" };
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "string") {
      const inner = parsed.trim();
      if (inner.startsWith("{") && inner.endsWith("}")) {
        return { ok: true, value: JSON.parse(inner) as unknown };
      }
    }
    return { ok: true, value: parsed };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error
          ? `Report JSON parse failed: ${error.message}`
          : "Report JSON parse failed"
    };
  }
}

function formatSchemaErrors(errors: unknown[]): {
  message: string;
  details?: Record<string, unknown>;
} {
  if (errors.length === 0) {
    return { message: "Report JSON schema validation failed" };
  }
  const first = errors[0] as {
    instancePath?: string;
    message?: string;
    params?: Record<string, unknown>;
    keyword?: string;
    schemaPath?: string;
  };
  const instancePath = first.instancePath && first.instancePath.length > 0
    ? first.instancePath
    : "/";
  const detail = first.message ? `: ${first.message}` : "";
  const message = `Schema validation failed at ${instancePath}${detail}`;
  return {
    message,
    details: {
      errors
    }
  };
}

export function validateReport(input: unknown): ReportValidationResult {
  const parsed = parseReportJson(input);
  if (!parsed.ok) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATOR_JSON_PARSE_FAILED,
      message: parsed.message
    };
  }

  const schemaResult = validateReportSchema(parsed.value);
  if (!schemaResult.ok) {
    const formatted = formatSchemaErrors(schemaResult.errors);
    return {
      ok: false,
      code: ERROR_CODES.VALIDATOR_SCHEMA_INVALID,
      message: formatted.message,
      details: formatted.details
    };
  }

  return {
    ok: true,
    report: parsed.value as ReportV1Json
  };
}
