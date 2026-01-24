import { describe, expect, it, vi } from "vitest";
import { fetchMarketSignals } from "../../src/orchestrator/steps/market.signals.fetch.step.js";
import type { ClobSnapshot, MarketContext } from "../../src/orchestrator/types.js";

describe("fetchMarketSignals", () => {
  it("fetches signals for top N markets including primary", async () => {
    const marketContext: MarketContext = {
      event_id: "event_1",
      slug: "test-event",
      title: "Test Event",
      markets: [
        {
          market_id: "market_primary",
          outcomes: ["Yes", "No"],
          outcomePrices: [0.5, 0.5],
          clobTokenIds: ["token_yes_primary", "token_no_primary"],
          volume: 10
        },
        {
          market_id: "market_top",
          outcomes: ["Yes", "No"],
          outcomePrices: [0.5, 0.5],
          clobTokenIds: ["token_yes_top", "token_no_top"],
          volume: 100
        },
        {
          market_id: "market_low",
          outcomes: ["Yes", "No"],
          outcomePrices: [0.5, 0.5],
          clobTokenIds: ["token_yes_low", "token_no_low"],
          volume: 1
        }
      ],
      primary_market_id: "market_primary",
      clobTokenIds: ["token_yes_primary", "token_no_primary"]
    };

    const clobProvider = {
      getOrderBookSummary: vi.fn(
        async (): Promise<ClobSnapshot> => ({
          spread: 0.01,
          midpoint: 0.5,
          book_top_levels: [{ side: "bid", price: 0.49, size: 10 }],
          notable_walls: []
        })
      )
    };

    const pricingProvider = {
      getMarketPrice: vi.fn(async () => 0.55),
      getMidpointPrice: vi.fn(async () => 0.545),
      getPriceHistory: vi.fn(async () => [
        { ts: 1_700_000_000, price: 0.4 },
        { ts: 1_700_003_600, price: 0.5 }
      ])
    };

    const result = await fetchMarketSignals(
      { market_context: marketContext, top_markets: 2 },
      { clobProvider, pricingProvider }
    );

    expect(clobProvider.getOrderBookSummary).toHaveBeenNthCalledWith(
      1,
      "token_yes_primary"
    );
    expect(clobProvider.getOrderBookSummary).toHaveBeenNthCalledWith(
      2,
      "token_no_primary"
    );
    expect(clobProvider.getOrderBookSummary).toHaveBeenNthCalledWith(
      3,
      "token_yes_top"
    );
    expect(clobProvider.getOrderBookSummary).toHaveBeenNthCalledWith(
      4,
      "token_no_top"
    );
    expect(result.market_signals).toHaveLength(4);
    expect(result.market_context.market_signals).toHaveLength(4);
    expect(
      result.market_signals.some((signal) => signal.market_id === "market_low")
    ).toBe(false);

    const sample = result.market_signals[0];
    if (!sample) {
      throw new Error("Expected at least one market signal");
    }
    expect(sample.price_context).toMatchObject({
      latest_price: 0.55,
      midpoint_price: 0.545
    });
  });

  it("falls back to clob midpoint when pricing fails", async () => {
    const marketContext: MarketContext = {
      event_id: "event_2",
      slug: "test-event-2",
      title: "Test Event 2",
      markets: [
        {
          market_id: "market_primary",
          outcomes: ["Yes", "No"],
          outcomePrices: [0.5, 0.5],
          clobTokenIds: ["token_yes_primary", "token_no_primary"],
          volume: 10
        }
      ],
      primary_market_id: "market_primary",
      clobTokenIds: ["token_yes_primary", "token_no_primary"]
    };

    const clobProvider = {
      getOrderBookSummary: vi.fn(
        async (): Promise<ClobSnapshot> => ({
          spread: 0.02,
          midpoint: 0.51,
          book_top_levels: [{ side: "bid", price: 0.5, size: 10 }],
          notable_walls: []
        })
      )
    };

    const pricingProvider = {
      getMarketPrice: vi.fn(async () => {
        throw new Error("Pricing down");
      }),
      getMidpointPrice: vi.fn(async () => 0.51),
      getPriceHistory: vi.fn(async () => [])
    };

    const result = await fetchMarketSignals(
      { market_context: marketContext, top_markets: 1 },
      { clobProvider, pricingProvider }
    );

    const signal = result.market_signals[0];
    if (!signal) {
      throw new Error("Expected market signal");
    }
    expect(signal.price_context.latest_price).toBe(0.51);
    expect(signal.price_context.midpoint_price).toBe(0.51);
    expect(signal.price_context.history_warning?.code).toBe("PRICE_API_FAILED");
  });
});
