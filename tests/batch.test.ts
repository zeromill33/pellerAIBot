import { describe, it, expect } from "vitest";
import { runPublishBatch } from "../src/orchestrator/batch.js";
import { createAppError, ERROR_CODES } from "../src/orchestrator/errors.js";

const urls = [
  "https://polymarket.com/event/alpha-market",
  "https://polymarket.com/event/beta-market",
  "https://polymarket.com/event/gamma-market"
];

describe("runPublishBatch", () => {
  it("respects configured concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const result = await runPublishBatch(
      { request_id: "req_test", urls, concurrency: 2 },
      {
        runPipeline: async (input) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 20));
          inFlight -= 1;
          return {
            event_slug: input.event_slug,
            run_id: input.run_id,
            status: "success"
          };
        }
      }
    );

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(result.successes).toHaveLength(3);
    expect(result.failures).toHaveLength(0);
    expect(result.summary.succeeded).toBe(3);
  });

  it("continues when a single item fails", async () => {
    const result = await runPublishBatch(
      { request_id: "req_test", urls, concurrency: 2 },
      {
        runPipeline: async (input) => {
          if (input.event_slug === "beta-market") {
            throw createAppError({
              code: ERROR_CODES.ORCH_BATCH_PIPELINE_FAILED,
              message: "Pipeline failed",
              category: "INTERNAL",
              retryable: true
            });
          }
          return {
            event_slug: input.event_slug,
            run_id: input.run_id,
            status: "success"
          };
        }
      }
    );

    expect(result.successes).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.event_slug).toBe("beta-market");
    expect(result.failures[0]?.error.code).toBe(
      ERROR_CODES.ORCH_BATCH_PIPELINE_FAILED
    );
    expect(result.summary.failed).toBe(1);
  });
});
