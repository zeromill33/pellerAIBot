import { describe, expect, it } from "vitest";
import { runPublishPipelineSteps } from "../../src/orchestrator/pipeline.js";
import { createAppError, ERROR_CODES } from "../../src/orchestrator/errors.js";
import type { ReportV1Json } from "../../src/providers/llm/types.js";
import type { TavilyProvider } from "../../src/providers/tavily/index.js";
import type { LLMProvider } from "../../src/providers/llm/types.js";

function buildValidReport(): ReportV1Json {
  return {
    context: {
      title: "Test",
      url: "https://polymarket.com/event/test",
      resolution_rules_raw: "Resolves if condition met.",
      time_remaining: "10d",
      market_odds: { yes: 55, no: 45 },
      liquidity_proxy: {
        gamma_liquidity: 1200,
        book_depth_top10: 40,
        spread: 0.02
      },
      resolution_structured: {
        deadline_ts: 1767225540000,
        resolver_url: "https://official.example.com/resolution",
        partial_shutdown_counts: false,
        exclusions: ["Acting appointments will not count."]
      }
    },
    official_sources: [],
    market_framing: {
      core_bet: "Core framing statement.",
      key_assumption: "Key assumption text."
    },
    disagreement_map: {
      pro: [
        {
          claim: "Evidence is limited; awaiting official update.",
          claim_summary: "Evidence is limited; awaiting official update.",
          source_type: "市场行为",
          url: "https://polymarket.com/event/test",
          domain: "polymarket.com",
          title: "Test market",
          published_at: "2026-01-28T00:00:00Z",
          snippet: "Evidence is limited; awaiting official update.",
          time: "N/A"
        },
        {
          claim: "Market pricing partially reflects expectations.",
          claim_summary: "Market pricing partially reflects expectations.",
          source_type: "市场行为",
          url: "https://official.example.com/statement",
          domain: "official.example.com",
          title: "Official statement",
          published_at: "2026-01-03T00:00:00Z",
          snippet: "Market pricing partially reflects expectations.",
          time: "2026-01-03T00:00:00Z"
        }
      ],
      con: [
        {
          claim: "Counterpoint based on media interpretation.",
          claim_summary: "Counterpoint based on media interpretation.",
          source_type: "主流媒体",
          url: "https://news.example.com/1",
          domain: "news.example.com",
          title: "Media interpretation",
          published_at: "2026-01-01T00:00:00Z",
          snippet: "Counterpoint based on media interpretation.",
          time: "2026-01-01T00:00:00Z"
        },
        {
          claim: "Social chatter highlights uncertainty.",
          claim_summary: "Social chatter highlights uncertainty.",
          source_type: "社交讨论",
          url: "https://social.example.com/1",
          domain: "social.example.com",
          title: "Social chatter",
          published_at: "2026-01-02T00:00:00Z",
          snippet: "Social chatter highlights uncertainty.",
          time: "2026-01-02T00:00:00Z"
        }
      ]
    },
    priced_vs_new: {
      priced_in: [{ item: "Already partially priced in.", source_type: "官方公告" }],
      new_info: [{ item: "New discussion thread surfaced.", source_type: "社交讨论" }]
    },
    sentiment: { samples: [], bias: "unknown", relation: "unknown" },
    key_variables: [
      {
        name: "variable_one",
        impact: "High impact",
        observable_signals: "Official update expected in coming weeks"
      }
    ],
    failure_modes: [
      {
        mode: "Delay in announcement",
        observable_signals: "Official update delayed beyond expected window"
      },
      {
        mode: "Policy reversal",
        observable_signals: "Sudden policy statement reversing prior guidance"
      }
    ],
    risk_attribution: ["info"],
    limitations: {
      cannot_detect: ["private negotiations", "off-record deals"],
      not_included: ["no_bet_advice", "no_position_sizing"]
    },
    ai_vs_market: {
      market_yes: 55,
      ai_yes_beta: 60,
      delta: 5,
      drivers: ["Key evidence has not surfaced"]
    }
  };
}

function buildInsufficientUrlReport(): ReportV1Json {
  const report = buildValidReport() as Record<string, unknown>;
  const disagreement = report.disagreement_map as { pro: Array<Record<string, unknown>>; con: Array<Record<string, unknown>> };
  const url = "https://polymarket.com/event/test";
  disagreement.pro = disagreement.pro.map((item) => ({ ...item, url }));
  disagreement.con = disagreement.con.map((item) => ({ ...item, url }));
  report.disagreement_map = disagreement;
  return report as ReportV1Json;
}

const gammaProvider = {
  async getEventBySlug(slug: string) {
    return {
      event_id: "event-test",
      slug,
      title: "Test Event",
      description: "Test description",
      resolution_rules_raw: "Resolves if condition met.",
      end_time: "2026-12-01T00:00:00Z",
      markets: [],
      clobTokenIds: ["token-yes"],
      outcomePrices: [55, 45]
    };
  }
};

const clobProvider = {
  async getOrderBookSummary() {
    return {
      spread: 0.01,
      midpoint: 0.5,
      book_top_levels: [
        { side: "bid" as const, price: 0.5, size: 10 },
        { side: "ask" as const, price: 0.6, size: 12 }
      ],
      notable_walls: []
    };
  }
};

const pricingProvider = {
  async getMarketPrice() {
    return 0.5;
  },
  async getMidpointPrice() {
    return 0.5;
  },
  async getPriceHistory() {
    return [];
  }
};

describe("pipeline supplement search", () => {
  it("retries search and validation when evidence is insufficient", async () => {
    let llmCalls = 0;
    const llmProvider: LLMProvider = {
      async generateReportV1() {
        llmCalls += 1;
        return llmCalls === 1 ? buildInsufficientUrlReport() : buildValidReport();
      }
    };

    const tavilyInvocations: Array<{ lane: string; query: string }> = [];
    const tavilyProvider: TavilyProvider = {
      async searchLane(input) {
        tavilyInvocations.push({ lane: input.lane, query: input.query });
        return {
          lane: input.lane,
          query: input.query,
          results: [
            {
              title: "Test Event update",
              url: `https://example.com/${input.lane}/1`,
              domain: "example.com",
              published_at: "2026-01-28T00:00:00Z",
              raw_content: "Test Event update with relevant details."
            }
          ],
          cache_hit: false,
          rate_limited: false,
          latency_ms: 1
        };
      }
    };

    const context = await runPublishPipelineSteps(
      { request_id: "req-1", run_id: "run-1", event_slug: "test-event" },
      {
        stopStepId: "report.validate",
        stepOptions: {
          gammaProvider,
          clobProvider,
          pricingProvider,
          tavilyProvider,
          llmProvider,
          marketSignalsTopMarkets: 0,
          officialFetch: {
            fetch: async () => ({
              ok: false,
              status: 404,
              text: async () => ""
            })
          }
        }
      }
    );

    expect(llmCalls).toBe(2);
    expect(tavilyInvocations.length).toBeGreaterThan(0);
    expect(context.report_json).toEqual(buildValidReport());
  });

  it("returns rate limit error when supplement search is throttled", async () => {
    let llmCalls = 0;
    let rateLimitNextSearch = false;
    const llmProvider: LLMProvider = {
      async generateReportV1() {
        llmCalls += 1;
        if (llmCalls === 1) {
          rateLimitNextSearch = true;
          return buildInsufficientUrlReport();
        }
        return buildValidReport();
      }
    };

    const tavilyProvider: TavilyProvider = {
      async searchLane(input) {
        if (rateLimitNextSearch) {
          rateLimitNextSearch = false;
          throw createAppError({
            code: ERROR_CODES.PROVIDER_TAVILY_REQUEST_FAILED,
            message: "rate limit",
            category: "RATE_LIMIT",
            retryable: true,
            details: { lane: input.lane }
          });
        }
        return {
          lane: input.lane,
          query: input.query,
          results: [
            {
              title: "Test Event update",
              url: `https://example.com/${input.lane}/1`,
              domain: "example.com",
              published_at: "2026-01-28T00:00:00Z",
              raw_content: "Test Event update with relevant details."
            }
          ],
          cache_hit: false,
          rate_limited: false,
          latency_ms: 1
        };
      }
    };

    await expect(
      runPublishPipelineSteps(
        { request_id: "req-2", run_id: "run-2", event_slug: "test-event" },
        {
          stopStepId: "report.validate",
          stepOptions: {
            gammaProvider,
            clobProvider,
            pricingProvider,
            tavilyProvider,
            llmProvider,
            marketSignalsTopMarkets: 0,
            officialFetch: {
              fetch: async () => ({
                ok: false,
                status: 404,
                text: async () => ""
              })
            }
          }
        }
      )
    ).rejects.toMatchObject({
      code: ERROR_CODES.ORCH_SUPPLEMENT_RATE_LIMIT
    });
  });
});
