import type { ErrorReceipt } from "./types.js";

export type ErrorCategory =
  | "VALIDATION"
  | "PROVIDER"
  | "RATE_LIMIT"
  | "STORE"
  | "RENDER"
  | "PUBLISH"
  | "LLM"
  | "INTERNAL"
  | "UNKNOWN";

export type ErrorSuggestion = {
  action: "retry" | "supplement_search" | "enable_lane";
  preferred_lane?: "C" | "D";
  message?: string;
};

export class AppError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  readonly suggestion?: ErrorSuggestion;

  constructor(params: {
    code: string;
    message: string;
    category: ErrorCategory;
    retryable: boolean;
    details?: Record<string, unknown>;
    suggestion?: ErrorSuggestion;
  }) {
    super(params.message);
    this.name = "AppError";
    this.code = params.code;
    this.category = params.category;
    this.retryable = params.retryable;
    this.details = params.details;
    this.suggestion = params.suggestion;
  }
}

export const ERROR_CODES = {
  BOT_EMPTY_URL_LIST: "BOT_EMPTY_URL_LIST",
  BOT_INVALID_URL: "BOT_INVALID_URL",
  STEP_URL_PARSE_INVALID_URL: "STEP_URL_PARSE_INVALID_URL",
  ORCH_BATCH_PIPELINE_FAILED: "ORCH_BATCH_PIPELINE_FAILED"
} as const;

export function createAppError(params: {
  code: string;
  message: string;
  category: ErrorCategory;
  retryable: boolean;
  details?: Record<string, unknown>;
  suggestion?: ErrorSuggestion;
}): AppError {
  return new AppError(params);
}

export function toErrorReceipt(error: AppError): ErrorReceipt {
  return {
    code: error.code,
    message: error.message,
    category: error.category,
    retryable: error.retryable,
    details: error.details,
    suggestion: error.suggestion
  };
}
