import { describe, expect, it } from "vitest";
import { generateReport } from "../../src/orchestrator/steps/report.generate.step.js";
import { ERROR_CODES, AppError } from "../../src/orchestrator/errors.js";
import type {
  ClobSnapshot,
  LiquidityProxy,
  MarketContext,
  PriceContext,
  TavilyLaneResult
} from "../../src/orchestrator/types.js";
import type {
  LLMProvider,
  LlmReportInput,
  ReportV1Json
} from "../../src/providers/llm/types.js";

describe("report.generate step", () => {
  it("maps inputs into LLM prompt payload and sorts tavily results", async () => {
    const captured: LlmReportInput[] = [];
    const provider: LLMProvider = {
      async generateReportV1(input: LlmReportInput): Promise<ReportV1Json> {
        captured.push(input);
        return { ok: true };
      }
    };

    const priceContext: PriceContext = {
      token_id: "token_yes",
      latest_price: 0.61,
      midpoint_price: 0.6,
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
    };

    const marketContext: MarketContext = {
      event_id: "event_1",
      slug: "test-event",
      title: "Test Event",
      description: "Desc",
      resolution_rules_raw: "Resolves to Yes if true.",
      end_time: "2026-06-01T00:00:00Z",
      markets: [
        {
          market_id: "market_1",
          outcomes: ["Yes", "No"],
          outcomePrices: [0.61, 0.39],
          clobTokenIds: ["token_yes", "token_no"]
        }
      ],
      primary_market_id: "market_1",
      price_context: priceContext
    };

    const liquidityProxy: LiquidityProxy = {
      gamma_liquidity: 1200,
      book_depth_top10: 40,
      spread: 0.02,
      midpoint: 0.6,
      notable_walls: []
    };

    const clobSnapshot: ClobSnapshot = {
      spread: 0.02,
      midpoint: 0.6,
      book_top_levels: [
        { side: "ask", price: 0.61, size: 8 },
        { side: "bid", price: 0.59, size: 6 }
      ],
      notable_walls: [],
      price_change_24h: 0.05
    };

    const tavilyResults: TavilyLaneResult[] = [
      {
        lane: "B",
        query: "secondary",
        results: [
          {
            title: "B result",
            url: "https://b.com/2",
            domain: "b.com",
            published_at: "2026-01-05T00:00:00Z",
            raw_content: "content"
          }
        ]
      },
      {
        lane: "A",
        query: "primary",
        results: [
          {
            title: "A result later",
            url: "https://a.com/2",
            domain: "a.com",
            published_at: "2026-01-02T00:00:00Z",
            raw_content: "content"
          },
          {
            title: "A result early",
            url: "https://b.com/1",
            domain: "b.com",
            published_at: "2026-01-01T00:00:00Z",
            raw_content: "content"
          },
          {
            title: "A result tie",
            url: "https://a.com/1",
            domain: "a.com",
            published_at: "2026-01-01T00:00:00Z",
            raw_content: "content"
          }
        ]
      }
    ];

    await generateReport(
      {
        request_id: "req-1",
        run_id: "run-1",
        event_slug: marketContext.slug,
        market_context: marketContext,
        clob_snapshot: clobSnapshot,
        tavily_results: tavilyResults,
        liquidity_proxy: liquidityProxy
      },
      { provider }
    );

    expect(captured).toHaveLength(1);
    const [input] = captured;
    if (!input) {
      throw new Error("Missing captured input");
    }
    expect(input.context.title).toBe("Test Event");
    expect(input.context.url).toBe("https://polymarket.com/event/test-event");
    expect(input.context.resolution_rules_raw).toBe("Resolves to Yes if true.");
    expect(input.context.end_time).toBe("2026-06-01T00:00:00Z");
    expect(input.context.market_odds_yes).toBe(0.61);
    expect(input.context.market_odds_no).toBe(0.39);
    expect(input.context.liquidity_proxy).toEqual(liquidityProxy);
    expect(input.context.price_context).toEqual(priceContext);

    expect(input.clob).toEqual({
      spread: 0.02,
      midpoint: 0.6,
      book_top_levels: [
        { side: "ask", price: 0.61, size: 8 },
        { side: "bid", price: 0.59, size: 6 }
      ],
      notable_walls: [],
      price_change_24h: 0.05
    });
    expect(input.market_metrics_summary).toEqual({
      availability: "available",
      reason: undefined,
      price_signals: {
        latest_price: 0.61,
        midpoint_price: 0.6,
        change_1h: null,
        change_4h: null,
        change_24h: null,
        volatility_24h: null,
        range_high_24h: null,
        range_low_24h: null,
        trend_slope_24h: null,
        spike_flag: null
      },
      clob_metrics: {
        spread: 0.02,
        midpoint: 0.6,
        price_change_24h: 0.05,
        notable_walls_count: 0,
        top_wall: null
      }
    });

    const lanes = input.evidence.tavily_results.map((lane) => lane.lane);
    expect(lanes).toEqual(["A", "B"]);

    const aLaneResults = input.evidence.tavily_results[0]?.results ?? [];
    expect(aLaneResults.map((item) => item.url)).toEqual([
      "https://a.com/1",
      "https://b.com/1",
      "https://a.com/2"
    ]);
  });

  it("throws when tavily_results missing", async () => {
    const marketContext: MarketContext = {
      event_id: "event_2",
      slug: "test-event-2",
      title: "Test Event 2",
      resolution_rules_raw: "Rules",
      markets: []
    };

    await expect(
      generateReport(
        {
          request_id: "req-2",
          run_id: "run-2",
          event_slug: marketContext.slug,
          market_context: marketContext
        },
        { provider: { generateReportV1: async () => ({}) } }
      )
    ).rejects.toMatchObject({
      code: ERROR_CODES.STEP_REPORT_GENERATE_MISSING_INPUT
    });
  });

  it("throws when resolution_rules_raw missing", async () => {
    const marketContext: MarketContext = {
      event_id: "event_3",
      slug: "test-event-3",
      title: "Test Event 3",
      resolution_rules_raw: "",
      markets: []
    };

    try {
      await generateReport(
        {
          request_id: "req-3",
          run_id: "run-3",
          event_slug: marketContext.slug,
          market_context: marketContext,
          tavily_results: []
        },
        { provider: { generateReportV1: async () => ({}) } }
      );
      throw new Error("Expected error");
    } catch (error) {
      const appError = error as AppError;
      expect(appError.code).toBe(ERROR_CODES.STEP_REPORT_GENERATE_MISSING_INPUT);
    }
  });

  it("marks market metrics summary unavailable when inputs missing", async () => {
    const captured: LlmReportInput[] = [];
    const provider: LLMProvider = {
      async generateReportV1(input: LlmReportInput): Promise<ReportV1Json> {
        captured.push(input);
        return { ok: true };
      }
    };

    const marketContext: MarketContext = {
      event_id: "event_4",
      slug: "test-event-4",
      title: "Test Event 4",
      resolution_rules_raw: "Rules",
      markets: []
    };

    await generateReport(
      {
        request_id: "req-4",
        run_id: "run-4",
        event_slug: marketContext.slug,
        market_context: marketContext,
        tavily_results: []
      },
      { provider }
    );

    expect(captured).toHaveLength(1);
    const [input] = captured;
    if (!input) {
      throw new Error("Missing captured input");
    }
    expect(input.market_metrics_summary).toEqual({
      availability: "unavailable",
      reason: "price_context_missing; clob_snapshot_missing",
      price_signals: null,
      clob_metrics: null
    });
  });
});
