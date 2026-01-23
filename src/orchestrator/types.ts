import type { AppError } from "./errors.js";

export type InvalidUrlResult = {
  url: string;
  error: AppError;
};

export type UrlParseResult = {
  event_slugs: string[];
  invalid_urls: InvalidUrlResult[];
};

export type PublishBatchInput = {
  request_id: string;
  urls: string[];
};

export type PublishBatchResult = UrlParseResult & {
  request_id: string;
};
