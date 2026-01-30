import { describe, expect, it } from "vitest";
import { verifyTavilyResults } from "../../src/orchestrator/steps/tavily.verify.step.js";
import { ERROR_CODES } from "../../src/orchestrator/errors.js";
import type { MarketContext, TavilyLaneResult } from "../../src/orchestrator/types.js";

const baseContext: MarketContext = {
  event_id: "evt-1",
  slug: "test-event-shutdown",
  title: "Test Event Shutdown",
  description: "Shutdown resolution criteria",
  resolution_rules_raw: "Resolves to Yes if shutdown occurs.",
  end_time: "2026-02-01T00:00:00Z",
  markets: []
};

const NOW_MS = Date.parse("2026-01-30T00:00:00Z");

function buildLane(results: TavilyLaneResult["results"]): TavilyLaneResult {
  return {
    lane: "A",
    query: "test query",
    results
  };
}

describe("tavily.verify step", () => {
  it("keeps results that match keywords and have raw_content", async () => {
    const inputResults: TavilyLaneResult[] = [
      buildLane([
        {
          title: "Test Event Shutdown update",
          url: "https://example.com/1",
          domain: "example.com",
          published_at: "2026-01-28T00:00:00Z",
          raw_content: "Test Event Shutdown details with official guidance."
        },
        {
          title: "Shutdown latest",
          url: "https://example.com/2",
          domain: "example.com",
          published_at: "2026-01-27T00:00:00Z",
          raw_content: "Test Event Shutdown coverage update."
        },
        {
          title: "Operating Status note",
          url: "https://example.com/3",
          domain: "example.com",
          published_at: "2026-01-26T00:00:00Z",
          raw_content: "Operating Status for Test Event Shutdown."
        }
      ])
    ];

    const result = await verifyTavilyResults(
      {
        request_id: "req-1",
        run_id: "run-1",
        event_slug: baseContext.slug,
        market_context: baseContext,
        tavily_results: inputResults
      },
      { now: () => NOW_MS }
    );

    expect(result.tavily_results_filtered[0]?.results.length).toBe(3);
    expect(result.dropped_evidence.length).toBe(0);
  });

  it("drops items without raw_content but keeps sufficient results", async () => {
    const inputResults: TavilyLaneResult[] = [
      buildLane([
        {
          title: "Test Event Shutdown update",
          url: "https://example.com/1",
          domain: "example.com",
          published_at: "2026-01-28T00:00:00Z",
          raw_content: "Test Event Shutdown details."
        },
        {
          title: "Missing content",
          url: "https://example.com/2",
          domain: "example.com",
          published_at: "2026-01-28T00:00:00Z",
          raw_content: null
        },
        {
          title: "Operating Status note",
          url: "https://example.com/3",
          domain: "example.com",
          published_at: "2026-01-27T00:00:00Z",
          raw_content: "Operating Status for Test Event Shutdown."
        },
        {
          title: "Shutdown latest",
          url: "https://example.com/4",
          domain: "example.com",
          published_at: "2026-01-27T00:00:00Z",
          raw_content: "Test Event Shutdown coverage update."
        }
      ])
    ];

    const result = await verifyTavilyResults(
      {
        request_id: "req-2",
        run_id: "run-2",
        event_slug: baseContext.slug,
        market_context: baseContext,
        tavily_results: inputResults
      },
      { now: () => NOW_MS }
    );

    expect(result.tavily_results_filtered[0]?.results.length).toBe(3);
    expect(result.dropped_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "missing_raw_content" })
      ])
    );
  });

  it("drops items without keyword match", async () => {
    const inputResults: TavilyLaneResult[] = [
      buildLane([
        {
          title: "Test Event Shutdown update",
          url: "https://example.com/1",
          domain: "example.com",
          published_at: "2026-01-28T00:00:00Z",
          raw_content: "Test Event Shutdown details."
        },
        {
          title: "Unrelated headline",
          url: "https://example.com/2",
          domain: "example.com",
          published_at: "2026-01-28T00:00:00Z",
          raw_content: "Sports news unrelated."
        },
        {
          title: "Operating Status note",
          url: "https://example.com/3",
          domain: "example.com",
          published_at: "2026-01-27T00:00:00Z",
          raw_content: "Operating Status for Test Event Shutdown."
        },
        {
          title: "Shutdown latest",
          url: "https://example.com/4",
          domain: "example.com",
          published_at: "2026-01-27T00:00:00Z",
          raw_content: "Test Event Shutdown coverage update."
        }
      ])
    ];

    const result = await verifyTavilyResults(
      {
        request_id: "req-3",
        run_id: "run-3",
        event_slug: baseContext.slug,
        market_context: baseContext,
        tavily_results: inputResults
      },
      { now: () => NOW_MS }
    );

    expect(result.tavily_results_filtered[0]?.results.length).toBe(3);
    expect(result.dropped_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "no_keyword_match" })
      ])
    );
  });

  it("drops stale items and throws when below threshold", async () => {
    const inputResults: TavilyLaneResult[] = [
      buildLane([
        {
          title: "Test Event Shutdown update",
          url: "https://example.com/1",
          domain: "example.com",
          published_at: "2025-12-01T00:00:00Z",
          raw_content: "Test Event Shutdown details."
        },
        {
          title: "Shutdown latest",
          url: "https://example.com/2",
          domain: "example.com",
          published_at: "2025-12-02T00:00:00Z",
          raw_content: "Test Event Shutdown coverage update."
        }
      ])
    ];

    await expect(
      verifyTavilyResults(
        {
          request_id: "req-4",
          run_id: "run-4",
          event_slug: baseContext.slug,
          market_context: baseContext,
          tavily_results: inputResults
        },
        { now: () => NOW_MS }
      )
    ).rejects.toMatchObject({
      code: ERROR_CODES.STEP_TAVILY_RELEVANCE_INSUFFICIENT
    });
  });
});
