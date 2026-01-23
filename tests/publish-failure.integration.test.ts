import { describe, it, expect, vi } from "vitest";
import { createAppError } from "../src/orchestrator/errors.js";
import type { PublishBatchResult } from "../src/orchestrator/types.js";

vi.mock("../src/orchestrator/index.js", () => ({
  triggerPublishBatch: vi.fn()
}));

describe("/publish integration failure receipt", () => {
  it("returns consistent failure receipt fields", async () => {
    const { handlePublishCommand } = await import("../src/bot/commands/publish.js");
    const { triggerPublishBatch } = await import("../src/orchestrator/index.js");

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

    const batchResult: PublishBatchResult = {
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

    const mockTrigger = vi.mocked(triggerPublishBatch);
    mockTrigger.mockResolvedValueOnce(batchResult);

    const result = await handlePublishCommand(
      "/publish https://polymarket.com/event/alpha-market",
      { request_id: "req_test" }
    );

    expect(result.receipt.failures).toHaveLength(1);
    expect(result.receipt.failures[0]?.error).toMatchObject({
      code: "VALIDATOR_REPORT_INVALID",
      category: "VALIDATION",
      retryable: false
    });
    expect(result.receipt.failures[0]?.error.suggestion).toEqual({
      action: "supplement_search",
      preferred_lane: "C"
    });
  });
});
