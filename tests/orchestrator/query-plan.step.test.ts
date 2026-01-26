import { describe, expect, it } from "vitest";
import { buildTavilyQueryPlan } from "../../src/orchestrator/steps/query.plan.build.step.js";
import { AppError, ERROR_CODES } from "../../src/orchestrator/errors.js";
import type { MarketContext } from "../../src/orchestrator/types.js";

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
