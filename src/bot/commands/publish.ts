import { guardPublishUrls } from "../guard.js";
import { triggerPublishBatch } from "../../orchestrator/index.js";
import { buildRequestId } from "../../utils/id.js";
import type { PublishBatchResult } from "../../orchestrator/types.js";

export type PublishReceiptSuccess = {
  event_slug: string;
  run_id: string;
};

export type PublishReceiptFailure = {
  event_slug: string;
  run_id: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

export type PublishReceiptInvalidUrl = {
  url: string;
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
};

export type PublishBatchReceipt = {
  request_id: string;
  summary: PublishBatchResult["summary"];
  successes: PublishReceiptSuccess[];
  failures: PublishReceiptFailure[];
  invalid_urls: PublishReceiptInvalidUrl[];
};

export type PublishCommandResult = PublishBatchResult & {
  receipt: PublishBatchReceipt;
};

function buildPublishReceipt(result: PublishBatchResult): PublishBatchReceipt {
  return {
    request_id: result.request_id,
    summary: result.summary,
    successes: result.successes.map((item) => ({
      event_slug: item.event_slug,
      run_id: item.run_id
    })),
    failures: result.failures.map((item) => ({
      event_slug: item.event_slug,
      run_id: item.run_id,
      error: {
        code: item.error.code,
        message: item.error.message,
        retryable: item.error.retryable
      }
    })),
    invalid_urls: result.invalid_urls.map((item) => ({
      url: item.url,
      error: {
        code: item.error.code,
        message: item.error.message,
        retryable: item.error.retryable
      }
    }))
  };
}

export function parsePublishUrls(commandText: string): string[] {
  const trimmed = commandText.trim();
  if (!trimmed) {
    return [];
  }

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return [];
  }

  const first = tokens[0];
  if (!first) {
    return [];
  }

  if (first.startsWith("/publish")) {
    return tokens.slice(1);
  }

  return tokens;
}

export async function handlePublishCommand(
  commandText: string,
  options?: { request_id?: string }
): Promise<PublishCommandResult> {
  const urls = parsePublishUrls(commandText);
  guardPublishUrls(urls);

  const batchResult = await triggerPublishBatch({
    request_id: options?.request_id ?? buildRequestId(),
    urls
  });

  return {
    ...batchResult,
    receipt: buildPublishReceipt(batchResult)
  };
}
