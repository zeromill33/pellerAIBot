import { describe, expect, it } from "vitest";
import { fetchMarketPricing } from "../../src/orchestrator/steps/market.pricing.fetch.step.js";
import type { MarketContext } from "../../src/orchestrator/types.js";

describe("fetchMarketPricing", () => {
  it("selects Yes token and computes signals", async () => {
    const marketContext: MarketContext = {
      event_id: "event_1",
      slug: "test-event",
      title: "Test Event",
      markets: [
        {
          market_id: "market_1",
          outcomes: ["Yes", "No"],
          outcomePrices: [0.5, 0.5],
          clobTokenIds: ["token_yes", "token_no"]
        }
      ],
      primary_market_id: "market_1",
      clobTokenIds: ["token_yes", "token_no"]
    };

    const provider = {
      getMarketPrice: async () => 0.55,
      getMidpointPrice: async () => 0.545,
      getPriceHistory: async () => [
        { ts: 1_700_000_000, price: 0.4 },
        { ts: 1_700_003_600, price: 0.5 },
        { ts: 1_700_007_200, price: 0.55 }
      ]
    };

    const result = await fetchMarketPricing(
      { market_context: marketContext },
      { provider }
    );

    expect(result.price_context.token_id).toBe("token_yes");
    expect(result.price_context.latest_price).toBeCloseTo(0.55, 6);
    expect(result.price_context.midpoint_price).toBeCloseTo(0.545, 6);
    expect(result.price_context.signals.change_1h).toBeCloseTo(0.05, 6);
    expect(result.price_context.signals.change_4h).toBeNull();
    expect(result.price_context.signals.range_high_24h).toBeCloseTo(0.55, 6);
    expect(result.price_context.signals.range_low_24h).toBeCloseTo(0.4, 6);
    expect(result.price_context.signals.trend_slope_24h).toBeCloseTo(0.075, 6);
    expect(result.price_context.signals.spike_flag).toBe(false);
  });

  it("returns warning when history is insufficient", async () => {
    const marketContext: MarketContext = {
      event_id: "event_2",
      slug: "test-event-2",
      title: "Test Event 2",
      markets: [
        {
          market_id: "market_2",
          outcomes: ["Yes", "No"],
          outcomePrices: [0.5, 0.5],
          clobTokenIds: ["token_yes", "token_no"]
        }
      ],
      primary_market_id: "market_2",
      clobTokenIds: ["token_yes", "token_no"]
    };

    const provider = {
      getMarketPrice: async () => 0.55,
      getMidpointPrice: async () => 0.545,
      getPriceHistory: async () => [{ ts: 1_700_000_000, price: 0.5 }]
    };

    const result = await fetchMarketPricing(
      { market_context: marketContext },
      { provider }
    );

    expect(result.price_context.signals.change_1h).toBeNull();
    expect(result.price_context.history_warning?.code).toBe(
      "PRICE_HISTORY_INSUFFICIENT"
    );
  });
});
