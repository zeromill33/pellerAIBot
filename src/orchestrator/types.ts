import type { AppError } from "./errors.js";

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
