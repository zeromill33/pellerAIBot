import { describe, expect, it } from "vitest";
import { buildEvidenceCandidates, MAX_CLAIM_CHARS } from "../../src/orchestrator/steps/evidence.build.step.js";
import type {
  ClobSnapshot,
  MarketSignal,
  PriceContext,
  TavilyLaneResult
} from "../../src/orchestrator/types.js";

describe("buildEvidenceCandidates", () => {
  it("dedupes by URL and normalizes domain", () => {
    const tavilyResults: TavilyLaneResult[] = [
      {
        lane: "A",
        query: "query A",
        results: [
          {
            title: "Title One",
            url: "https://Example.com/news/1",
            domain: "www.Example.com",
            published_at: "2025-01-01T00:00:00Z",
            raw_content: "Claim A"
          }
        ]
      },
      {
        lane: "B",
        query: "query B",
        results: [
          {
            title: "Title One duplicate",
            url: "https://example.com/news/1",
            domain: "example.com",
            published_at: "2025-01-02T00:00:00Z",
            raw_content: "Claim B"
          }
        ]
      }
    ];

    const { evidence_candidates } = buildEvidenceCandidates({
      event_slug: "event-1",
      tavily_results: tavilyResults
    });

    expect(evidence_candidates).toHaveLength(1);
    expect(evidence_candidates[0]?.domain).toBe("example.com");
  });

  it("marks repeated items and selects primary by source priority", () => {
    const tavilyResults: TavilyLaneResult[] = [
      {
        lane: "A",
        query: "query A",
        results: [
          {
            title: "Fed Chair announcement",
            url: "https://example.com/press/fed-chair",
            domain: "example.com",
            published_at: "2025-01-02T00:00:00Z",
            raw_content: "Official press release"
          }
        ]
      },
      {
        lane: "B",
        query: "query B",
        results: [
          {
            title: "Fed Chair announcement!",
            url: "https://example.com/news/fed-chair",
            domain: "example.com",
            published_at: "2025-01-01T00:00:00Z",
            raw_content: "News coverage"
          }
        ]
      }
    ];

    const { evidence_candidates } = buildEvidenceCandidates({
      event_slug: "event-2",
      tavily_results: tavilyResults
    });

    expect(evidence_candidates).toHaveLength(2);
    expect(evidence_candidates[0]?.source_type).toBe("official");
    expect(evidence_candidates[0]?.repeated).toBe(false);
    expect(evidence_candidates[1]?.repeated).toBe(true);
  });

  it("falls back to title for claim and truncates long claims", () => {
    const longTitle = "A".repeat(MAX_CLAIM_CHARS + 50);
    const tavilyResults: TavilyLaneResult[] = [
      {
        lane: "C",
        query: "query C",
        results: [
          {
            title: longTitle,
            url: "https://example.com/long",
            domain: "example.com",
            published_at: "2025-01-03T00:00:00Z",
            raw_content: null
          }
        ]
      }
    ];

    const { evidence_candidates } = buildEvidenceCandidates({
      event_slug: "event-3",
      tavily_results: tavilyResults
    });

    const candidate = evidence_candidates[0];
    expect(candidate?.claim.length).toBe(MAX_CLAIM_CHARS);
    expect(candidate?.claim).toBe(longTitle.slice(0, MAX_CLAIM_CHARS));
    expect(candidate?.stance).toBe("neutral");
    expect(candidate?.novelty).toBe("unknown");
    expect(candidate?.strength).toBe(1);
  });

  it("labels stance when claims contain decisive cues", () => {
    const tavilyResults: TavilyLaneResult[] = [
      {
        lane: "A",
        query: "query A",
        results: [
          {
            title: "Approval confirmed",
            url: "https://example.com/approval",
            domain: "example.com",
            published_at: "2025-01-07T00:00:00Z",
            raw_content: "Regulator approved the merger."
          }
        ]
      },
      {
        lane: "C",
        query: "query C",
        results: [
          {
            title: "Denial issued",
            url: "https://example.com/denial",
            domain: "example.com",
            published_at: "2025-01-08T00:00:00Z",
            raw_content: "Agency denied the proposal after review."
          }
        ]
      }
    ];

    const { evidence_candidates } = buildEvidenceCandidates({
      event_slug: "event-3b",
      tavily_results: tavilyResults
    });

    const byUrl = Object.fromEntries(
      evidence_candidates.map((item) => [item.url, item])
    );
    expect(byUrl["https://example.com/approval"]?.stance).toBe("supports_yes");
    expect(byUrl["https://example.com/denial"]?.stance).toBe("supports_no");
  });

  it("prioritizes explicit negation over positive keywords", () => {
    const tavilyResults: TavilyLaneResult[] = [
      {
        lane: "A",
        query: "query A",
        results: [
          {
            title: "Won't close",
            url: "https://example.com/wont-close",
            domain: "example.com",
            published_at: "2025-01-09T00:00:00Z",
            raw_content: "Company said it won't close the exchange."
          }
        ]
      },
      {
        lane: "B",
        query: "query B",
        results: [
          {
            title: "Not expected to",
            url: "https://example.com/not-expected",
            domain: "example.com",
            published_at: "2025-01-10T00:00:00Z",
            raw_content: "Regulator is not expected to approve the deal."
          }
        ]
      }
    ];

    const { evidence_candidates } = buildEvidenceCandidates({
      event_slug: "event-3c",
      tavily_results: tavilyResults
    });

    const byUrl = Object.fromEntries(
      evidence_candidates.map((item) => [item.url, item])
    );
    expect(byUrl["https://example.com/wont-close"]?.stance).toBe("supports_no");
    expect(byUrl["https://example.com/not-expected"]?.stance).toBe(
      "supports_no"
    );
  });

  it("assigns source_type by lane and domain rules", () => {
    const tavilyResults: TavilyLaneResult[] = [
      {
        lane: "A",
        query: "query A",
        results: [
          {
            title: "Reuters coverage",
            url: "https://www.reuters.com/world/example",
            domain: "reuters.com",
            published_at: "2025-01-05T00:00:00Z",
            raw_content: "Media coverage"
          }
        ]
      },
      {
        lane: "B",
        query: "query B",
        results: [
          {
            title: "Official statement",
            url: "https://www.whitehouse.gov/briefing-room",
            domain: "whitehouse.gov",
            published_at: "2025-01-04T00:00:00Z",
            raw_content: "Official announcement"
          }
        ]
      },
      {
        lane: "D",
        query: "query D",
        results: [
          {
            title: "Social chatter",
            url: "https://twitter.com/example/status/123",
            domain: "twitter.com",
            published_at: "2025-01-03T00:00:00Z",
            raw_content: "Social discussion"
          }
        ]
      },
      {
        lane: "C",
        query: "query C",
        results: [
          {
            title: "Market odds snapshot",
            url: "https://polymarket.com/market/example",
            domain: "polymarket.com",
            published_at: "2025-01-03T00:00:00Z",
            raw_content: "Market movement"
          }
        ]
      }
    ];

    const { evidence_candidates } = buildEvidenceCandidates({
      event_slug: "event-4",
      tavily_results: tavilyResults
    });

    expect(evidence_candidates).toHaveLength(4);
    const byLane = Object.fromEntries(
      evidence_candidates.map((item) => [item.lane, item])
    );
    expect(byLane.A?.source_type).toBe("media");
    expect(byLane.B?.source_type).toBe("official");
    expect(byLane.D?.source_type).toBe("social");
    expect(byLane.C?.source_type).toBe("market");
  });

  it("uses default source_type when domains do not match lists", () => {
    const tavilyResults: TavilyLaneResult[] = [
      {
        lane: "C",
        query: "query C",
        results: [
          {
            title: "Unknown site",
            url: "https://unknown.example/blog",
            domain: "unknown.example",
            published_at: "2025-01-06T00:00:00Z",
            raw_content: "Unlisted domain"
          }
        ]
      },
      {
        lane: "A",
        query: "query A",
        results: [
          {
            title: "Onchain explorer",
            url: "https://etherscan.io/tx/0x123",
            domain: "etherscan.io",
            published_at: "2025-01-06T00:00:00Z",
            raw_content: "Chain data"
          }
        ]
      }
    ];

    const { evidence_candidates } = buildEvidenceCandidates({
      event_slug: "event-5",
      tavily_results: tavilyResults
    });

    const byLane = Object.fromEntries(
      evidence_candidates.map((item) => [item.lane, item])
    );
    expect(byLane.C?.source_type).toBe("media");
    expect(byLane.A?.source_type).toBe("media");
  });

  it("adds market behavior evidence when market signals are available", () => {
    const tavilyResults: TavilyLaneResult[] = [
      {
        lane: "A",
        query: "query A",
        results: [
          {
            title: "Regular news",
            url: "https://example.com/news/market",
            domain: "example.com",
            published_at: "2025-01-06T00:00:00Z",
            raw_content: "News content"
          }
        ]
      }
    ];

    const clobSnapshot: ClobSnapshot = {
      spread: 0.02,
      midpoint: 0.5,
      book_top_levels: [],
      notable_walls: [{ side: "bid", price: 0.5, size: 1000, multiple: 3 }]
    };

    const priceContext: PriceContext = {
      token_id: "token-1",
      latest_price: 0.52,
      midpoint_price: 0.51,
      history_24h: [],
      signals: {
        change_1h: null,
        change_4h: null,
        change_24h: 0.12,
        volatility_24h: null,
        range_high_24h: null,
        range_low_24h: null,
        trend_slope_24h: null,
        spike_flag: false
      }
    };

    const marketSignals: MarketSignal[] = [
      {
        market_id: "market-1",
        token_id: "token-1",
        clob_snapshot: clobSnapshot,
        price_context: priceContext
      }
    ];

    const { evidence_candidates } = buildEvidenceCandidates({
      event_slug: "event-6",
      tavily_results: tavilyResults,
      market_signals: marketSignals
    });

    const marketEvidence = evidence_candidates.find(
      (candidate) => candidate.source_type === "market"
    );

    expect(marketEvidence).toBeTruthy();
    expect(marketEvidence?.url).toBe("https://polymarket.com/event/event-6");
    expect(marketEvidence?.domain).toBe("polymarket.com");
    expect(marketEvidence?.query).toBe("market_behavior");
  });
});
