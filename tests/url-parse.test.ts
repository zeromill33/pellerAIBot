import { describe, it, expect } from "vitest";
import { parseUrlsToSlugs } from "../src/orchestrator/steps/url.parse.step.js";
import { ERROR_CODES } from "../src/orchestrator/errors.js";

describe("parseUrlsToSlugs", () => {
  it("extracts slugs from valid Polymarket URLs", () => {
    const result = parseUrlsToSlugs([
      "https://polymarket.com/event/alpha-market",
      "https://www.polymarket.com/event/beta-market?foo=bar"
    ]);

    expect(result.event_slugs).toEqual(["alpha-market", "beta-market"]);
    expect(result.invalid_urls).toEqual([]);
  });

  it("dedupes URLs and slugs while preserving first occurrence", () => {
    const result = parseUrlsToSlugs([
      "https://polymarket.com/event/alpha-market",
      "https://polymarket.com/event/alpha-market",
      "https://www.polymarket.com/event/alpha-market?x=1",
      "https://polymarket.com/event/beta-market"
    ]);

    expect(result.event_slugs).toEqual(["alpha-market", "beta-market"]);
    expect(result.invalid_urls).toEqual([]);
  });

  it("returns structured errors for invalid URLs", () => {
    const result = parseUrlsToSlugs([
      "https://example.com/event/alpha-market",
      "not-a-url"
    ]);

    expect(result.event_slugs).toEqual([]);
    expect(result.invalid_urls).toHaveLength(2);
    const [firstInvalid] = result.invalid_urls;
    if (!firstInvalid) {
      throw new Error("Expected invalid URL entry");
    }
    expect(firstInvalid.error.code).toBe(ERROR_CODES.STEP_URL_PARSE_INVALID_URL);
  });

  it("handles invalid percent-encoded slugs", () => {
    const result = parseUrlsToSlugs([
      "https://polymarket.com/event/%E0%A4"
    ]);

    expect(result.event_slugs).toEqual([]);
    expect(result.invalid_urls).toHaveLength(1);
    const [firstInvalid] = result.invalid_urls;
    if (!firstInvalid) {
      throw new Error("Expected invalid URL entry");
    }
    expect(firstInvalid.error.code).toBe(ERROR_CODES.STEP_URL_PARSE_INVALID_URL);
  });
});
