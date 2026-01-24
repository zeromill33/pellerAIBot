import { describe, expect, it, vi } from "vitest";
import { fetchMarketOrderbook } from "../../src/orchestrator/steps/market.orderbook.fetch.step.js";
import type { ClobSnapshot, MarketContext } from "../../src/orchestrator/types.js";

describe("fetchMarketOrderbook", () => {
  it("selects Yes token id when available", async () => {
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

    const snapshot: ClobSnapshot = {
      spread: 0.01,
      midpoint: 0.5,
      book_top_levels: [
        { side: "bid", price: 0.49, size: 10 },
        { side: "ask", price: 0.51, size: 12 }
      ],
      notable_walls: []
    };

    const provider = {
      getOrderBookSummary: vi.fn(async () => snapshot)
    };

    const result = await fetchMarketOrderbook(
      { market_context: marketContext },
      { provider }
    );

    expect(provider.getOrderBookSummary).toHaveBeenCalledTimes(1);
    expect(provider.getOrderBookSummary).toHaveBeenCalledWith("token_yes");
    expect(result.market_context.clob_token_id_used).toBe("token_yes");
    expect(result.market_context.clob_market_id_used).toBe("market_1");
    expect(result.clob_snapshot).toBe(snapshot);
  });

  it("falls back to another market when primary is one-sided", async () => {
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
          volume: 100
        },
        {
          market_id: "market_alt",
          outcomes: ["Yes", "No"],
          outcomePrices: [0.5, 0.5],
          clobTokenIds: ["token_yes_alt", "token_no_alt"],
          volume: 90
        }
      ],
      primary_market_id: "market_primary",
      clobTokenIds: ["token_yes_primary", "token_no_primary"]
    };

    const oneSided: ClobSnapshot = {
      spread: null,
      midpoint: null,
      book_top_levels: [{ side: "ask", price: 0.6, size: 10 }],
      notable_walls: []
    };
    const twoSided: ClobSnapshot = {
      spread: 0.02,
      midpoint: 0.51,
      book_top_levels: [
        { side: "bid", price: 0.5, size: 10 },
        { side: "ask", price: 0.52, size: 12 }
      ],
      notable_walls: []
    };

    const provider = {
      getOrderBookSummary: vi.fn(async (tokenId: string) => {
        if (tokenId === "token_yes_alt") {
          return twoSided;
        }
        return oneSided;
      })
    };

    const result = await fetchMarketOrderbook(
      { market_context: marketContext },
      { provider }
    );

    expect(provider.getOrderBookSummary).toHaveBeenNthCalledWith(
      1,
      "token_yes_primary"
    );
    expect(provider.getOrderBookSummary).toHaveBeenNthCalledWith(
      2,
      "token_no_primary"
    );
    expect(provider.getOrderBookSummary).toHaveBeenNthCalledWith(
      3,
      "token_yes_alt"
    );
    expect(provider.getOrderBookSummary).toHaveBeenCalledTimes(3);
    expect(result.market_context.clob_token_id_used).toBe("token_yes_alt");
    expect(result.market_context.clob_market_id_used).toBe("market_alt");
    expect(result.clob_snapshot).toBe(twoSided);
  });

  it("uses precomputed market_signals when available", async () => {
    const marketContext: MarketContext = {
      event_id: "event_3",
      slug: "test-event-3",
      title: "Test Event 3",
      markets: [],
      market_signals: [
        {
          market_id: "market_1",
          token_id: "token_1",
          clob_snapshot: {
            spread: null,
            midpoint: null,
            book_top_levels: [{ side: "ask", price: 0.7, size: 4 }],
            notable_walls: []
          },
          price_context: {
            token_id: "token_1",
            latest_price: 0.7,
            midpoint_price: 0.7,
            history_24h: [],
            signals: {
              change_1h: null,
              change_4h: null,
              change_24h: null,
              volatility_24h: null,
              range_high_24h: null,
              range_low_24h: null,
              trend_slope_24h: null,
              spike_flag: null
            }
          }
        },
        {
          market_id: "market_2",
          token_id: "token_2",
          clob_snapshot: {
            spread: 0.02,
            midpoint: 0.51,
            book_top_levels: [
              { side: "bid", price: 0.5, size: 10 },
              { side: "ask", price: 0.52, size: 12 }
            ],
            notable_walls: []
          },
          price_context: {
            token_id: "token_2",
            latest_price: 0.51,
            midpoint_price: 0.51,
            history_24h: [],
            signals: {
              change_1h: null,
              change_4h: null,
              change_24h: null,
              volatility_24h: null,
              range_high_24h: null,
              range_low_24h: null,
              trend_slope_24h: null,
              spike_flag: null
            }
          }
        }
      ]
    };

    const provider = {
      getOrderBookSummary: vi.fn()
    };

    const result = await fetchMarketOrderbook(
      { market_context: marketContext },
      { provider }
    );

    expect(provider.getOrderBookSummary).not.toHaveBeenCalled();
    expect(result.market_context.clob_market_id_used).toBe("market_2");
    expect(result.market_context.clob_token_id_used).toBe("token_2");
    expect(result.clob_snapshot.spread).toBe(0.02);
  });
});
