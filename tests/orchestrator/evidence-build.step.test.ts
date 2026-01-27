import { describe, expect, it } from "vitest";
import { buildEvidenceCandidates, MAX_CLAIM_CHARS } from "../../src/orchestrator/steps/evidence.build.step.js";
import type { TavilyLaneResult } from "../../src/orchestrator/types.js";

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
});
