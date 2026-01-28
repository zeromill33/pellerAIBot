import { describe, expect, it } from "vitest";
import { validateReport } from "../../src/validator/index.js";
import { validateContentGates } from "../../src/validator/gates.js";
import { ERROR_CODES } from "../../src/orchestrator/errors.js";

function buildValidReport() {
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
      }
    },
    market_framing: {
      core_bet: "Core framing statement.",
      key_assumption: "Key assumption text."
    },
    disagreement_map: {
      pro: [
        {
          claim: "Evidence is limited; awaiting official update.",
          source_type: "市场行为",
          url: "https://polymarket.com/event/test",
          time: "N/A"
        },
        {
          claim: "Market pricing partially reflects expectations.",
          source_type: "市场行为",
          url: "https://official.example.com/statement",
          time: "N/A"
        }
      ],
      con: [
        {
          claim: "Counterpoint based on media interpretation.",
          source_type: "主流媒体",
          url: "https://news.example.com/1",
          time: "2026-01-01T00:00:00Z"
        },
        {
          claim: "Social chatter highlights uncertainty.",
          source_type: "社交讨论",
          url: "https://social.example.com/1",
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

describe("validator content gates", () => {
  it("passes valid report", () => {
    const result = validateReport(buildValidReport());
    expect(result.ok).toBe(true);
  });

  it("blocks missing resolution rules", () => {
    const report = buildValidReport();
    report.context.resolution_rules_raw = "";
    const result = validateContentGates(report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.VALIDATOR_RESOLUTION_RULES_MISSING);
    }
  });

  it("blocks insufficient disagreement items", () => {
    const report = buildValidReport();
    report.disagreement_map.pro = report.disagreement_map.pro.slice(0, 1);
    const result = validateContentGates(report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.VALIDATOR_DISAGREEMENT_INSUFFICIENT);
    }
  });

  it("blocks invalid priced_vs_new source_type", () => {
    const report = buildValidReport();
    report.priced_vs_new.priced_in = [
      { item: "Already priced", source_type: "unknown" }
    ];
    const result = validateContentGates(report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.VALIDATOR_PRICED_SOURCE_INVALID);
    }
  });

  it("blocks failure_modes with short observable_signals", () => {
    const report = buildValidReport();
    report.failure_modes[0].observable_signals = "too short";
    const result = validateContentGates(report, { minFailureSignalLength: 20 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.VALIDATOR_FAILURE_MODES_GENERIC);
    }
  });

  it("blocks insufficient distinct urls", () => {
    const report = buildValidReport();
    report.disagreement_map.con[0].url = report.disagreement_map.pro[0].url;
    report.disagreement_map.con[1].url = report.disagreement_map.pro[0].url;
    report.disagreement_map.pro[1].url = report.disagreement_map.pro[0].url;
    const result = validateReport(report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.VALIDATOR_INSUFFICIENT_URLS);
    }
  });

  it("blocks call-to-action language", () => {
    const report = buildValidReport();
    report.market_framing.core_bet = "建议下注该合约";
    const result = validateReport(report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.VALIDATOR_CALL_TO_ACTION_DETECTED);
    }
  });

  it("blocks invalid sentiment when samples empty", () => {
    const report = buildValidReport();
    report.sentiment.bias = "neutral";
    report.sentiment.relation = "reinforces";
    const result = validateReport(report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.VALIDATOR_SENTIMENT_INVALID);
    }
  });

  it("blocks ai_vs_market drivers with call-to-action", () => {
    const report = buildValidReport();
    report.ai_vs_market.drivers = ["建议买入该合约"];
    const result = validateReport(report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.VALIDATOR_AI_DRIVERS_INVALID);
    }
  });

  it("blocks ai_vs_market drivers length out of range", () => {
    const report = buildValidReport();
    report.ai_vs_market.drivers = [];
    const result = validateContentGates(report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.VALIDATOR_AI_DRIVERS_INVALID);
    }
  });
});
