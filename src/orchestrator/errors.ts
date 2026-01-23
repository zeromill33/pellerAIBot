export type ErrorCategory = "VALIDATION" | "INTERNAL";

export class AppError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(params: {
    code: string;
    message: string;
    category: ErrorCategory;
    retryable: boolean;
    details?: Record<string, unknown>;
  }) {
    super(params.message);
    this.name = "AppError";
    this.code = params.code;
    this.category = params.category;
    this.retryable = params.retryable;
    this.details = params.details;
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
}): AppError {
  return new AppError(params);
}
