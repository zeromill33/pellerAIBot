import {
  AppError,
  createAppError,
  ERROR_CODES
} from "./errors.js";
import { runPublishPipeline } from "./pipeline.js";
import { parseUrlsToSlugs } from "./steps/url.parse.step.js";
import type {
  PublishBatchInput,
  PublishBatchResult,
  PublishItemFailure,
  PublishItemSuccess,
  PublishPipelineInput,
  PublishPipelineResult
} from "./types.js";
import { buildRunId } from "../utils/id.js";

type BatchRuntimeOptions = {
  runPipeline?: (input: PublishPipelineInput) => Promise<PublishPipelineResult>;
};

const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 10;

function resolveConcurrency(value: number | undefined): number {
  const envValue = process.env.PUBLISH_BATCH_CONCURRENCY;
  const raw =
    typeof value === "number"
      ? value
      : envValue
        ? Number(envValue)
        : undefined;
  if (!raw || Number.isNaN(raw) || raw < 1) {
    return DEFAULT_CONCURRENCY;
  }
  return Math.min(Math.floor(raw), MAX_CONCURRENCY);
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const queue = [...items];
  const workerCount = Math.min(concurrency, queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        return;
      }
      await handler(item);
    }
  });
  await Promise.all(workers);
}

function logBatchItemStart(params: {
  request_id: string;
  run_id: string;
  event_slug: string;
}) {
  console.info({
    message: "publish_batch_item_start",
    ...params
  });
}

function logBatchItemSuccess(params: {
  request_id: string;
  run_id: string;
  event_slug: string;
}) {
  console.info({
    message: "publish_batch_item_success",
    ...params
  });
}

function logBatchItemFailure(params: {
  request_id: string;
  run_id: string;
  event_slug: string;
  error: AppError;
}) {
  console.error({
    message: "publish_batch_item_failed",
    request_id: params.request_id,
    run_id: params.run_id,
    event_slug: params.event_slug,
    error_code: params.error.code,
    error_category: params.error.category
  });
}

function toBatchError(error: unknown, eventSlug: string): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return createAppError({
    code: ERROR_CODES.ORCH_BATCH_PIPELINE_FAILED,
    message: "Publish pipeline failed",
    category: "INTERNAL",
    retryable: true,
    details: { event_slug: eventSlug }
  });
}

export async function runPublishBatch(
  input: PublishBatchInput,
  options?: BatchRuntimeOptions
): Promise<PublishBatchResult> {
  const parseResult = parseUrlsToSlugs(input.urls);
  const successes: PublishItemSuccess[] = [];
  const failures: PublishItemFailure[] = [];
  const requestId = input.request_id;
  const runPipeline = options?.runPipeline ?? runPublishPipeline;
  const concurrency = resolveConcurrency(input.concurrency);

  await runWithConcurrency(parseResult.event_slugs, concurrency, async (eventSlug) => {
    const runId = buildRunId();
    logBatchItemStart({ request_id: requestId, run_id: runId, event_slug: eventSlug });

    try {
      const result = await runPipeline({
        request_id: requestId,
        run_id: runId,
        event_slug: eventSlug
      });

      if (result.status === "success") {
        successes.push(result);
        logBatchItemSuccess({ request_id: requestId, run_id: runId, event_slug: eventSlug });
        return;
      }

      failures.push(result);
      logBatchItemFailure({
        request_id: requestId,
        run_id: runId,
        event_slug: eventSlug,
        error: result.error
      });
    } catch (error) {
      const appError = toBatchError(error, eventSlug);
      failures.push({
        event_slug: eventSlug,
        run_id: runId,
        status: "failed",
        error: appError
      });
      logBatchItemFailure({
        request_id: requestId,
        run_id: runId,
        event_slug: eventSlug,
        error: appError
      });
    }
  });

  const summary = {
    total: parseResult.event_slugs.length + parseResult.invalid_urls.length,
    succeeded: successes.length,
    failed: failures.length,
    invalid: parseResult.invalid_urls.length
  };

  return {
    request_id: requestId,
    successes,
    failures,
    summary,
    ...parseResult
  };
}
