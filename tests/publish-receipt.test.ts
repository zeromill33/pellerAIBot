import { describe, it, expect } from "vitest";
import { buildPublishReceipt } from "../src/bot/commands/publish.js";
import { createAppError } from "../src/orchestrator/errors.js";
import type { PublishBatchResult } from "../src/orchestrator/types.js";

function buildResultWithFailure(error: ReturnType<typeof createAppError>): PublishBatchResult {
  return {
    request_id: "req_test",
    event_slugs: ["alpha-market"],
    invalid_urls: [],
    successes: [],
    failures: [
      {
        event_slug: "alpha-market",
        run_id: "run_test",
        status: "failed",
        error
      }
    ],
    summary: {
      total: 1,
      succeeded: 0,
      failed: 1,
      invalid: 0
    }
  };
}

describe("buildPublishReceipt", () => {
  it("includes validator suggestion in failure receipt", () => {
    const error = createAppError({
      code: "VALIDATOR_REPORT_INVALID",
      message: "Validator rejected report",
      category: "VALIDATION",
      retryable: false,
      suggestion: {
        action: "supplement_search",
        preferred_lane: "C"
      }
    });
    const receipt = buildPublishReceipt(buildResultWithFailure(error));

    expect(receipt.failures).toHaveLength(1);
    expect(receipt.failures[0]?.error.category).toBe("VALIDATION");
    expect(receipt.failures[0]?.error.suggestion).toEqual({
      action: "supplement_search",
      preferred_lane: "C"
    });
  });

  it("keeps non-validator error details without suggestion", () => {
    const error = createAppError({
      code: "ORCH_BATCH_PIPELINE_FAILED",
      message: "Publish pipeline failed",
      category: "INTERNAL",
      retryable: true,
      details: { event_slug: "alpha-market" }
    });
    const receipt = buildPublishReceipt(buildResultWithFailure(error));

    expect(receipt.failures).toHaveLength(1);
    expect(receipt.failures[0]?.error.category).toBe("INTERNAL");
    expect(receipt.failures[0]?.error.details).toEqual({
      event_slug: "alpha-market"
    });
    expect(receipt.failures[0]?.error.suggestion).toBeUndefined();
  });
});
