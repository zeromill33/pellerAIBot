import { describe, it, expect } from "vitest";
import { handlePublishCommand } from "../src/bot/commands/publish.js";
import { ERROR_CODES } from "../src/orchestrator/errors.js";

describe("/publish integration", () => {
  it("flows from command parsing to url.parse step", async () => {
    const result = await handlePublishCommand(
      "/publish https://polymarket.com/event/alpha-market https://bad.com/x",
      { request_id: "req_test" }
    );

    expect(result.request_id).toBe("req_test");
    expect(result.event_slugs).toEqual(["alpha-market"]);
    expect(result.invalid_urls).toHaveLength(1);
    expect(result.successes).toHaveLength(1);
    expect(result.failures).toHaveLength(0);
    expect(result.summary).toEqual({
      total: 2,
      succeeded: 1,
      failed: 0,
      invalid: 1
    });
    expect(result.receipt.successes).toHaveLength(1);
    expect(result.receipt.failures).toHaveLength(0);
    expect(result.receipt.invalid_urls).toHaveLength(1);
    const [firstInvalid] = result.invalid_urls;
    if (!firstInvalid) {
      throw new Error("Expected invalid URL entry");
    }
    expect(firstInvalid.error.code).toBe(ERROR_CODES.STEP_URL_PARSE_INVALID_URL);
    expect(result.receipt.invalid_urls[0]?.error.code).toBe(
      ERROR_CODES.STEP_URL_PARSE_INVALID_URL
    );
  });
});
