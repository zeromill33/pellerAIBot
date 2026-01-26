import { describe, expect, it, vi } from "vitest";
import { buildTavilyQueryPlan } from "../../src/orchestrator/steps/query.plan.build.step.js";
import { AppError, ERROR_CODES } from "../../src/orchestrator/errors.js";
import type { MarketContext, MarketSignal } from "../../src/orchestrator/types.js";

describe("buildTavilyQueryPlan", () => {
  it("builds A/B/C query plan with time anchor", () => {
    const marketContext: MarketContext = {
      event_id: "event_1",
      slug: "test-event",
      title: "Will the SEC approve a Bitcoin ETF",
      description: "Regulatory approval of spot Bitcoin ETFs",
      resolution_rules_raw: "Resolves to Yes if the SEC approves any spot ETF.",
      end_time: "2026-01-01T00:00:00Z",
      markets: []
    };

    const result = buildTavilyQueryPlan({ market_context: marketContext });
    expect(result.query_plan.lanes).toHaveLength(3);
    expect(result.query_plan.lanes.map((lane) => lane.lane)).toEqual([
      "A",
      "B",
      "C"
    ]);
    for (const lane of result.query_plan.lanes) {
      expect(lane.query.length).toBeGreaterThan(0);
      expect(lane.query.length).toBeLessThanOrEqual(400);
      expect(lane.query).toContain("before 2026-01-01");
    }
  });

  it("adds D lane queries when odds change trigger fires", () => {
    const marketContext: MarketContext = {
      event_id: "event-odds",
      slug: "event-odds",
      title: "Will Tesla announce a new factory",
      description: "Reports about a potential new Tesla factory",
      resolution_rules_raw: "Resolves to Yes if Tesla announces a factory.",
      end_time: "2026-01-01T00:00:00Z",
      category: "business",
      markets: [],
      price_context: {
        token_id: "token-1",
        latest_price: 0.6,
        midpoint_price: 0.6,
        history_24h: [],
        signals: {
          change_1h: null,
          change_4h: null,
          change_24h: 0.2,
          volatility_24h: null,
          range_high_24h: null,
          range_low_24h: null,
          trend_slope_24h: null,
          spike_flag: null
        }
      }
    };

    const result = buildTavilyQueryPlan({ market_context: marketContext });
    const dLanes = result.query_plan.lanes.filter((lane) => lane.lane === "D");
    expect(dLanes.length).toBeGreaterThanOrEqual(2);
    expect(dLanes.length).toBeLessThanOrEqual(3);
    expect(dLanes.some((lane) => lane.query.includes("site:reddit.com"))).toBe(
      true
    );
    expect(dLanes.some((lane) => lane.query.includes("site:x.com"))).toBe(true);
  });

  it("uses market_signals when price_context is missing", () => {
    const marketContext: MarketContext = {
      event_id: "event-signal",
      slug: "event-signal",
      title: "Will the Fed change rates",
      description: "Fed decision event",
      resolution_rules_raw: "Resolves to Yes if rates change.",
      end_time: "2026-05-01T00:00:00Z",
      markets: [],
      primary_market_id: "market-1"
    };
    const marketSignals: MarketSignal[] = [
      {
        market_id: "market-1",
        token_id: "token-1",
        clob_snapshot: {
          spread: null,
          midpoint: null,
          book_top_levels: [],
          notable_walls: []
        },
        price_context: {
          token_id: "token-1",
          latest_price: 0.6,
          midpoint_price: 0.6,
          history_24h: [],
          signals: {
            change_1h: null,
            change_4h: null,
            change_24h: 0.2,
            volatility_24h: null,
            range_high_24h: null,
            range_low_24h: null,
            trend_slope_24h: null,
            spike_flag: null
          }
        }
      }
    ];

    const result = buildTavilyQueryPlan({
      market_context: marketContext,
      market_signals: marketSignals
    });
    const dLanes = result.query_plan.lanes.filter((lane) => lane.lane === "D");
    expect(dLanes.length).toBeGreaterThanOrEqual(2);
  });

  it("adds D lane queries when social category matches", () => {
    const marketContext: MarketContext = {
      event_id: "event-social",
      slug: "event-social",
      title: "Will a major crypto exchange halt withdrawals",
      description: "Market speculation about exchange liquidity",
      resolution_rules_raw: "Resolves to Yes if withdrawals are halted.",
      end_time: "2026-02-01T00:00:00Z",
      category: "crypto",
      markets: []
    };

    const result = buildTavilyQueryPlan({ market_context: marketContext });
    const dLanes = result.query_plan.lanes.filter((lane) => lane.lane === "D");
    expect(dLanes.length).toBeGreaterThanOrEqual(2);
  });

  it("does not trigger D lane when disagreement evidence meets threshold", () => {
    const marketContext: MarketContext = {
      event_id: "event-disagree",
      slug: "event-disagree",
      title: "Will Team B win the finals",
      description: "Finals matchup evidence",
      resolution_rules_raw: "Resolves to Yes if Team B wins.",
      end_time: "2026-04-01T00:00:00Z",
      category: "sports",
      markets: []
    };

    const result = buildTavilyQueryPlan({
      market_context: marketContext,
      evidence_candidates: [
        { stance: "supports_no" },
        { stance: "supports_no" },
        { stance: "supports_yes" },
        { stance: "supports_yes" }
      ]
    });
    const dLanes = result.query_plan.lanes.filter((lane) => lane.lane === "D");
    expect(dLanes).toHaveLength(0);
  });

  it("logs missing evidence count and skips disagreement trigger", () => {
    const marketContext: MarketContext = {
      event_id: "event-evidence",
      slug: "event-evidence",
      title: "Will Team A win the championship",
      description: "Upcoming finals matchup",
      resolution_rules_raw: "Resolves to Yes if Team A wins.",
      end_time: "2026-03-01T00:00:00Z",
      category: "sports",
      markets: []
    };

    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const result = buildTavilyQueryPlan({
        request_id: "req-1",
        run_id: "run-1",
        market_context: marketContext
      });
      const dLanes = result.query_plan.lanes.filter(
        (lane) => lane.lane === "D"
      );
      expect(dLanes).toHaveLength(0);
      const logEntry = logSpy.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(logEntry.step_id).toBe("query.plan.build");
      const laneD = logEntry.lane_d as {
        triggers: {
          disagreement_insufficient: { evidence_available: boolean };
        };
      };
      expect(laneD.triggers.disagreement_insufficient.evidence_available).toBe(
        false
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  it("builds queries when title/description are missing", () => {
    const marketContext: MarketContext = {
      event_id: "event_2",
      slug: "test-event-2",
      title: "",
      description: "",
      resolution_rules_raw: "Resolves if the match ends with a winner.",
      end_time: "2025-10-01T00:00:00Z",
      markets: []
    };

    const result = buildTavilyQueryPlan({ market_context: marketContext });
    for (const lane of result.query_plan.lanes) {
      expect(lane.query.length).toBeGreaterThan(0);
      expect(lane.query).toContain("before 2025-10-01");
      expect(lane.query).toContain("match ends with a winner");
    }
  });

  it("throws AppError when all inputs are empty", () => {
    const marketContext: MarketContext = {
      event_id: "event_3",
      slug: "test-event-3",
      title: "",
      description: "",
      resolution_rules_raw: "",
      markets: []
    };

    try {
      buildTavilyQueryPlan({ market_context: marketContext });
      throw new Error("Expected query plan error");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe(ERROR_CODES.STEP_QUERY_PLAN_EMPTY_INPUT);
    }
  });
});
