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
  BOT_COMMAND_FAILED: "BOT_COMMAND_FAILED",
  BOT_UNAUTHORIZED: "BOT_UNAUTHORIZED",
  BOT_UNKNOWN_COMMAND: "BOT_UNKNOWN_COMMAND",
  BOT_EMPTY_URL_LIST: "BOT_EMPTY_URL_LIST",
  BOT_INVALID_URL: "BOT_INVALID_URL",
  STEP_URL_PARSE_INVALID_URL: "STEP_URL_PARSE_INVALID_URL",
  STEP_QUERY_PLAN_EMPTY_INPUT: "STEP_QUERY_PLAN_EMPTY_INPUT",
  ORCH_BATCH_PIPELINE_FAILED: "ORCH_BATCH_PIPELINE_FAILED",
  ORCH_PIPELINE_FAILED: "ORCH_PIPELINE_FAILED",
  PROVIDER_PM_GAMMA_REQUEST_FAILED: "PROVIDER_PM_GAMMA_REQUEST_FAILED",
  PROVIDER_PM_GAMMA_EVENT_NOT_FOUND: "PROVIDER_PM_GAMMA_EVENT_NOT_FOUND",
  PROVIDER_PM_GAMMA_EVENT_NOT_UNIQUE: "PROVIDER_PM_GAMMA_EVENT_NOT_UNIQUE",
  PROVIDER_PM_GAMMA_EVENT_INVALID: "PROVIDER_PM_GAMMA_EVENT_INVALID",
  PROVIDER_PM_GAMMA_MARKETS_EMPTY: "PROVIDER_PM_GAMMA_MARKETS_EMPTY",
  PROVIDER_PM_GAMMA_MARKETS_INVALID: "PROVIDER_PM_GAMMA_MARKETS_INVALID",
  PROVIDER_PM_GAMMA_MARKET_INVALID: "PROVIDER_PM_GAMMA_MARKET_INVALID",
  PROVIDER_PM_CLOB_REQUEST_FAILED: "PROVIDER_PM_CLOB_REQUEST_FAILED",
  PROVIDER_PM_CLOB_TOKEN_INVALID: "PROVIDER_PM_CLOB_TOKEN_INVALID",
  PROVIDER_PM_CLOB_BOOK_INVALID: "PROVIDER_PM_CLOB_BOOK_INVALID",
  PROVIDER_PM_PRICING_REQUEST_FAILED: "PROVIDER_PM_PRICING_REQUEST_FAILED",
  PROVIDER_PM_PRICING_TOKEN_INVALID: "PROVIDER_PM_PRICING_TOKEN_INVALID",
  PROVIDER_PM_PRICING_PRICE_INVALID: "PROVIDER_PM_PRICING_PRICE_INVALID",
  PROVIDER_PM_PRICING_MIDPOINT_INVALID: "PROVIDER_PM_PRICING_MIDPOINT_INVALID",
  PROVIDER_PM_PRICING_HISTORY_INVALID: "PROVIDER_PM_PRICING_HISTORY_INVALID",
  PROVIDER_LLM_NOT_CONFIGURED: "PROVIDER_LLM_NOT_CONFIGURED",
  PROVIDER_LLM_RESPONSE_INVALID: "PROVIDER_LLM_RESPONSE_INVALID",
  PROVIDER_TAVILY_CONFIG_INVALID: "PROVIDER_TAVILY_CONFIG_INVALID",
  PROVIDER_TAVILY_REQUEST_FAILED: "PROVIDER_TAVILY_REQUEST_FAILED",
  PROVIDER_TAVILY_RESPONSE_INVALID: "PROVIDER_TAVILY_RESPONSE_INVALID",
  STEP_TAVILY_QUERY_PLAN_MISSING: "STEP_TAVILY_QUERY_PLAN_MISSING",
  STEP_EVIDENCE_BUILD_MISSING_INPUT: "STEP_EVIDENCE_BUILD_MISSING_INPUT",
  STEP_REPORT_GENERATE_MISSING_INPUT: "STEP_REPORT_GENERATE_MISSING_INPUT",
  STEP_REPORT_VALIDATE_MISSING_INPUT: "STEP_REPORT_VALIDATE_MISSING_INPUT",
  VALIDATOR_JSON_PARSE_FAILED: "VALIDATOR_JSON_PARSE_FAILED",
  VALIDATOR_SCHEMA_INVALID: "VALIDATOR_SCHEMA_INVALID"
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
