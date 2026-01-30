import { describe, expect, it } from "vitest";
import { createLLMProvider } from "../../../src/providers/llm/index.js";
import { ERROR_CODES } from "../../../src/orchestrator/errors.js";
import type {
  LLMAdapter,
  LlmReportInput,
  ReportV1Json
} from "../../../src/providers/llm/types.js";

const baseInput: LlmReportInput = {
  context: {
    title: "Test",
    url: "https://polymarket.com/event/test",
    resolution_rules_raw: "Resolves if condition met.",
    end_time: "2026-12-01T00:00:00Z",
    market_odds_yes: 55,
    market_odds_no: 45,
    liquidity_proxy: null,
    price_context: null
  },
  evidence: { tavily_results: [] },
  clob: null,
  config: { aiProbabilityScale: "0-100" }
};

const validReport: ReportV1Json = {
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
        url: "https://polymarket.com/event/test",
        domain: "polymarket.com",
        title: "Test market",
        published_at: "2026-01-27T00:00:00Z",
        snippet: "Market pricing partially reflects expectations.",
        time: "N/A"
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
    priced_in: [
      { item: "Already partially priced in.", source_type: "官方公告" }
    ],
    new_info: [
      { item: "New discussion thread surfaced.", source_type: "社交讨论" }
    ]
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

function createAdapter(text: string): LLMAdapter {
  return {
    async generateJson() {
      return { text };
    }
  };
}

describe("LLM provider report postprocess", () => {
  it("parses report JSON and records audit metadata", async () => {
    const audits: Array<Record<string, unknown>> = [];
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(validReport)),
      model: "test-model",
      temperature: 0.2,
      onAudit: (entry) => audits.push(entry)
    });

    const result = await provider.generateReportV1(baseInput);

    expect(result).toEqual(validReport);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      prompt_name: "report_v1_generate",
      model: "test-model",
      temperature: 0.2
    });
    expect(typeof audits[0]?.prompt_sha256).toBe("string");
  });

  it("rejects non-JSON responses", async () => {
    const provider = createLLMProvider({
      adapter: createAdapter("not json"),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects missing required keys", async () => {
    const { ai_vs_market, ...missing } = validReport;
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(missing)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects extra top-level keys", async () => {
    const provider = createLLMProvider({
      adapter: createAdapter(
        JSON.stringify({ ...validReport, extra_field: "nope" })
      ),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects probability out of range", async () => {
    const context = (validReport as { context: Record<string, unknown> }).context;
    const report = {
      ...validReport,
      context: {
        ...context,
        market_odds: { yes: 120, no: -20 }
      }
    };
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(report)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects ai_vs_market probability out of range", async () => {
    const aiVsMarket = (validReport as { ai_vs_market: Record<string, unknown> })
      .ai_vs_market;
    const report = {
      ...validReport,
      ai_vs_market: {
        ...aiVsMarket,
        ai_yes_beta: 120
      }
    };
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(report)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects invalid priced_vs_new source_type", async () => {
    const pricedVsNew = (validReport as { priced_vs_new: Record<string, unknown> })
      .priced_vs_new;
    const report = {
      ...validReport,
      priced_vs_new: {
        ...pricedVsNew,
        priced_in: [{ item: "Invalid type", source_type: "unknown" }]
      }
    };
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(report)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects ai_vs_market drivers length out of range", async () => {
    const aiVsMarket = (validReport as { ai_vs_market: Record<string, unknown> })
      .ai_vs_market;
    const report = {
      ...validReport,
      ai_vs_market: {
        ...aiVsMarket,
        drivers: []
      }
    };
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(report)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects ai_vs_market drivers over limit", async () => {
    const aiVsMarket = (validReport as { ai_vs_market: Record<string, unknown> })
      .ai_vs_market;
    const report = {
      ...validReport,
      ai_vs_market: {
        ...aiVsMarket,
        drivers: ["a", "b", "c", "d"]
      }
    };
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(report)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects ai_vs_market drivers with call-to-action language", async () => {
    const aiVsMarket = (validReport as { ai_vs_market: Record<string, unknown> })
      .ai_vs_market;
    const report = {
      ...validReport,
      ai_vs_market: {
        ...aiVsMarket,
        drivers: ["建议买入该合约"]
      }
    };
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(report)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects ai_vs_market drivers with direct long/short keywords", async () => {
    const aiVsMarket = (validReport as { ai_vs_market: Record<string, unknown> })
      .ai_vs_market;
    const report = {
      ...validReport,
      ai_vs_market: {
        ...aiVsMarket,
        drivers: ["long BTC is favored"]
      }
    };
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(report)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects empty resolution_rules_raw", async () => {
    const context = (validReport as { context: Record<string, unknown> }).context;
    const report = {
      ...validReport,
      context: {
        ...context,
        resolution_rules_raw: ""
      }
    };
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(report)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects disagreement_map with insufficient items", async () => {
    const disagreement = (validReport as { disagreement_map: Record<string, unknown> })
      .disagreement_map;
    const report = {
      ...validReport,
      disagreement_map: {
        ...disagreement,
        pro: [(disagreement as { pro: unknown[] }).pro[0]]
      }
    };
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(report)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects invalid sentiment when samples empty", async () => {
    const report = {
      ...validReport,
      sentiment: { samples: [], bias: "neutral", relation: "reinforces" }
    };
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(report)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects invalid key_variables structure", async () => {
    const report = {
      ...validReport,
      key_variables: [
        {
          name: "variable_one",
          impact: "High impact",
          observable_signals: ""
        }
      ]
    };
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(report)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects invalid risk_attribution value", async () => {
    const report = {
      ...validReport,
      risk_attribution: ["unknown_reason"]
    };
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(report)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects missing time_remaining", async () => {
    const context = (validReport as { context: Record<string, unknown> }).context;
    const report = {
      ...validReport,
      context: {
        ...context,
        time_remaining: ""
      }
    };
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(report)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });

  it("rejects limitations missing required disclaimers", async () => {
    const limitations = (validReport as { limitations: Record<string, unknown> }).limitations;
    const report = {
      ...validReport,
      limitations: {
        ...limitations,
        not_included: ["no_bet_advice"]
      }
    };
    const provider = createLLMProvider({
      adapter: createAdapter(JSON.stringify(report)),
      onAudit: () => {}
    });

    await expect(provider.generateReportV1(baseInput)).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID
    });
  });
});
