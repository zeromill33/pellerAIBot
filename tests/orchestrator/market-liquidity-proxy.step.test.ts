import { describe, expect, it } from "vitest";
import { mergeLiquidityProxy } from "../../src/orchestrator/steps/market.liquidity.proxy.step.js";
import type { ClobSnapshot, MarketContext, OrderBookLevel } from "../../src/orchestrator/types.js";

function buildLevels(
  side: OrderBookLevel["side"],
  startPrice: number,
  count: number,
  size: number,
  sizeOverride?: { index: number; size: number }
): OrderBookLevel[] {
  return Array.from({ length: count }, (_, index) => {
    const price =
      side === "bid"
        ? startPrice - index * 0.001
        : startPrice + index * 0.001;
    const levelSize =
      sizeOverride && sizeOverride.index === index ? sizeOverride.size : size;
    return { side, price, size: levelSize };
  });
}

describe("mergeLiquidityProxy", () => {
  it("computes book_depth_top10 and merges liquidity proxy", async () => {
    const bids = buildLevels("bid", 0.6, 11, 1, { index: 10, size: 50 });
    const asks = buildLevels("ask", 0.61, 11, 2, { index: 10, size: 100 });
    const levels = [...bids, ...asks];

    const clobSnapshot: ClobSnapshot = {
      spread: 0.02,
      midpoint: 0.55,
      book_top_levels: levels,
      notable_walls: []
    };

    const marketContext: MarketContext = {
      event_id: "event_1",
      slug: "test-event",
      title: "Test Event",
      markets: [
        {
          market_id: "market_1",
          outcomes: ["Yes", "No"],
          outcomePrices: [0.55, 0.45],
          clobTokenIds: ["token_yes", "token_no"],
          liquidity: 1234
        }
      ],
      primary_market_id: "market_1"
    };

    const result = await mergeLiquidityProxy({
      market_context: marketContext,
      clob_snapshot: clobSnapshot
    });

    expect(result.liquidity_proxy.gamma_liquidity).toBe(1234);
    expect(result.liquidity_proxy.book_depth_top10).toBe(30);
    expect(result.liquidity_proxy.spread).toBe(0.02);
    expect(result.market_context.liquidity_proxy).toEqual(result.liquidity_proxy);
  });
});
