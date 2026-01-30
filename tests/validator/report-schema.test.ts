import { describe, expect, it } from "vitest";
import { validateReport } from "../../src/validator/index.js";
import { ERROR_CODES } from "../../src/orchestrator/errors.js";

const validReport = {
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
      observable_signals: "Official update"
    }
  ],
  failure_modes: [
    { mode: "Delay in announcement", observable_signals: "Official update delayed" },
    { mode: "Policy reversal", observable_signals: "Sudden policy statement" }
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

describe("validator report schema", () => {
  it("accepts valid report JSON", () => {
    const result = validateReport(validReport);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report).toEqual(validReport);
    }
  });

  it("rejects non-JSON input", () => {
    const result = validateReport("not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.VALIDATOR_JSON_PARSE_FAILED);
    }
  });

  it("rejects missing required keys", () => {
    const { ai_vs_market, ...missing } = validReport;
    const result = validateReport(missing);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.VALIDATOR_SCHEMA_INVALID);
    }
  });

  it("rejects extra top-level keys", () => {
    const result = validateReport({ ...validReport, extra_field: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.VALIDATOR_SCHEMA_INVALID);
    }
  });

  it("rejects out-of-range probability", () => {
    const context = (validReport as { context: Record<string, unknown> }).context;
    const report = {
      ...validReport,
      context: {
        ...context,
        market_odds: { yes: 120, no: 45 }
      }
    };
    const result = validateReport(report);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.VALIDATOR_SCHEMA_INVALID);
    }
  });
});
