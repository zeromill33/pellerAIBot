import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPricingProvider } from "../../../src/providers/polymarket/pricing.js";
import { ERROR_CODES } from "../../../src/orchestrator/errors.js";

type MockResponseOptions = {
  status: number;
  payload: unknown;
  headers?: Record<string, string>;
};

function createMockResponse(options: MockResponseOptions) {
  const headers = new Map(
    Object.entries(options.headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value
    ])
  );
  return {
    ok: options.status >= 200 && options.status < 300,
    status: options.status,
    json: async () => options.payload,
    headers: {
      get(name: string) {
        return headers.get(name.toLowerCase()) ?? null;
      }
    }
  };
}

function loadFixture(name: string) {
  return JSON.parse(
    readFileSync(new URL(`../../fixtures/polymarket/${name}`, import.meta.url), "utf-8")
  ) as unknown;
}

describe("createPricingProvider", () => {
  it("maps market price response", async () => {
    const payload = loadFixture("pricing-market-price.json");
    const fetch = async () => createMockResponse({ status: 200, payload });
    const provider = createPricingProvider({ fetch, retries: 0, sleep: async () => {} });

    const price = await provider.getMarketPrice("token-yes");

    expect(price).toBeCloseTo(0.52, 6);
  });

  it("maps midpoint price response", async () => {
    const payload = loadFixture("pricing-midpoint.json");
    const fetch = async () => createMockResponse({ status: 200, payload });
    const provider = createPricingProvider({ fetch, retries: 0, sleep: async () => {} });

    const midpoint = await provider.getMidpointPrice("token-yes");

    expect(midpoint).toBeCloseTo(0.515, 6);
  });

  it("resamples history to hourly buckets", async () => {
    const payload = loadFixture("pricing-history-half-hour.json");
    const fetch = async () => createMockResponse({ status: 200, payload });
    const provider = createPricingProvider({ fetch, retries: 0, sleep: async () => {} });

    const history = await provider.getPriceHistory("token-yes", {
      windowHours: 24,
      intervalHours: 1
    });

    expect(history).toHaveLength(2);
    expect(history[0]?.price).toBeCloseTo(0.51, 6);
    expect(history[1]?.price).toBeCloseTo(0.53, 6);
  });

  it("retries on 429 responses using Retry-After", async () => {
    let calls = 0;
    const delays: number[] = [];
    const payload = loadFixture("pricing-market-price.json");
    const fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return createMockResponse({
          status: 429,
          payload: { message: "rate limited" },
          headers: { "retry-after": "1" }
        });
      }
      return createMockResponse({ status: 200, payload });
    };
    const provider = createPricingProvider({
      fetch,
      retryBaseDelayMs: 0,
      sleep: async (ms) => {
        delays.push(ms);
      },
      now: () => 0
    });

    await provider.getMarketPrice("token-yes");

    expect(calls).toBe(2);
    expect(delays).toEqual([1000]);
  });

  it("throws when price payload is missing fields", async () => {
    const fetch = async () =>
      createMockResponse({
        status: 200,
        payload: { value: null }
      });
    const provider = createPricingProvider({ fetch, retries: 0, sleep: async () => {} });

    await expect(provider.getMarketPrice("token-yes")).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_PM_PRICING_PRICE_INVALID
    });
  });

  it("throws when history payload is missing fields", async () => {
    const fetch = async () =>
      createMockResponse({
        status: 200,
        payload: { message: "missing history" }
      });
    const provider = createPricingProvider({ fetch, retries: 0, sleep: async () => {} });

    await expect(provider.getPriceHistory("token-yes")).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_PM_PRICING_HISTORY_INVALID
    });
  });
});
