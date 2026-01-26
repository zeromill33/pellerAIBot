import { describe, expect, it, vi } from "vitest";
import { searchTavily } from "../../src/orchestrator/steps/search.tavily.step.js";
import type {
  MarketContext,
  TavilyLaneResult,
  TavilyQueryPlan
} from "../../src/orchestrator/types.js";

describe("searchTavily", () => {
  it("executes A/B/C lanes and logs structured metadata", async () => {
    const provider = {
      searchLane: vi.fn(async (input) => {
        return {
          lane: input.lane,
          query: input.query,
          results: [
            {
              title: `Title ${input.lane}`,
              url: `https://example.com/${input.lane}`,
              domain: "example.com",
              published_at: "2025-01-01T00:00:00Z",
              raw_content: `Raw ${input.lane}`
            }
          ],
          cache_hit: input.lane === "A",
          rate_limited: input.lane === "C",
          latency_ms: 5
        };
      })
    };

    const marketContext: MarketContext = {
      event_id: "event-1",
      slug: "event-1",
      title: "Test Event",
      markets: []
    };
    const queryPlan: TavilyQueryPlan = {
      lanes: [
        { lane: "A", query: "query A" },
        { lane: "B", query: "query B" },
        { lane: "C", query: "query C" },
        { lane: "D", query: "query D" }
      ]
    };

    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const result = await searchTavily(
        {
          request_id: "req-1",
          run_id: "run-1",
          event_slug: "event-1",
          market_context: marketContext,
          query_plan: queryPlan
        },
        {
          provider,
          now: (() => {
            let current = 0;
            return () => {
              current += 10;
              return current;
            };
          })()
        }
      );

      const lanes = (result.tavily_results as TavilyLaneResult[]).map(
        (lane) => lane.lane
      );
      expect(lanes).toEqual(["A", "B", "C"]);
      expect(provider.searchLane).toHaveBeenCalledTimes(3);
      expect(provider.searchLane).not.toHaveBeenCalledWith(
        expect.objectContaining({ lane: "D" })
      );

      expect(logSpy).toHaveBeenCalled();
      const logEntry = logSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(logEntry.step_id).toBe("search.tavily");
      expect(logEntry.request_id).toBe("req-1");
      expect(logEntry.run_id).toBe("run-1");
      expect(logEntry.event_slug).toBe("event-1");
      expect(logEntry.provider).toBe("tavily");
      expect(logEntry.latency_ms).toBeGreaterThanOrEqual(0);
      expect(logEntry.cache_hit).toMatchObject({ A: true, B: false, C: false });
      expect(logEntry.rate_limited).toMatchObject({ A: false, B: false, C: true });
    } finally {
      logSpy.mockRestore();
    }
  });
});
