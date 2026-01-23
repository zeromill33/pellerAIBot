import type { AppError, ErrorCategory, ErrorSuggestion } from "./errors.js";

export type ErrorReceipt = {
  code: string;
  message: string;
  category: ErrorCategory;
  retryable: boolean;
  details?: Record<string, unknown>;
  suggestion?: ErrorSuggestion;
};

export type InvalidUrlResult = {
  url: string;
  error: AppError;
};

export type UrlParseResult = {
  event_slugs: string[];
  invalid_urls: InvalidUrlResult[];
};

export type PublishItemSuccess = {
  event_slug: string;
  run_id: string;
  status: "success";
};

export type PublishItemFailure = {
  event_slug: string;
  run_id: string;
  status: "failed";
  error: AppError;
};

export type PublishBatchSummary = {
  total: number;
  succeeded: number;
  failed: number;
  invalid: number;
};

export type PublishBatchInput = {
  request_id: string;
  urls: string[];
  concurrency?: number;
};

export type PublishPipelineInput = {
  request_id: string;
  run_id: string;
  event_slug: string;
};

export type PublishPipelineResult = PublishItemSuccess | PublishItemFailure;

export type PublishBatchResult = UrlParseResult & {
  request_id: string;
  successes: PublishItemSuccess[];
  failures: PublishItemFailure[];
  summary: PublishBatchSummary;
};

export type GammaMarket = {
  market_id: string;
  question?: string;
  outcomes: string[];
  outcomePrices: number[];
  clobTokenIds: string[];
  volume?: number;
  liquidity?: number;
};

export type MarketContext = {
  event_id: string;
  slug: string;
  title: string;
  description?: string;
  resolution_rules_raw?: string;
  end_time?: string;
  markets: GammaMarket[];
  primary_market_id?: string;
  outcomePrices?: number[];
  clobTokenIds?: string[];
};
