import { describe, expect, it, vi } from "vitest";
import { fetchMarketContext } from "../../src/orchestrator/steps/market.fetch.step.js";
import type { MarketContext } from "../../src/orchestrator/types.js";

describe("fetchMarketContext", () => {
  it("fetches market context with preferred market id", async () => {
    const marketContext: MarketContext = {
      event_id: "event_1",
      slug: "test-event",
      title: "Test Event",
      markets: [],
      primary_market_id: "market_1"
    };

    const provider = {
      getEventBySlug: vi.fn(async () => marketContext)
    };

    const result = await fetchMarketContext(
      { event_slug: "test-event", preferred_market_id: "market_1" },
      { provider }
    );

    expect(provider.getEventBySlug).toHaveBeenCalledWith("test-event", {
      preferredMarketId: "market_1"
    });
    expect(result.market_context).toBe(marketContext);
  });
});
