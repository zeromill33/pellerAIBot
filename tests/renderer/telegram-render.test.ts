import { describe, it, expect } from "vitest";
import { renderTelegramReport } from "../../src/renderer/index.js";
import type { ReportV1Json } from "../../src/providers/llm/types.js";

function buildReport(overrides?: Partial<ReportV1Json>): ReportV1Json {
  return {
    context: {
      title: "测试事件标题",
      url: "https://polymarket.com/event/test-market",
      resolution_rules_raw: "结算规则原文",
      time_remaining: "2d 3h",
      market_odds: { yes: 55, no: 45 },
      liquidity_proxy: {
        gamma_liquidity: 1200,
        book_depth_top10: 320,
        spread: 0.02
      }
    },
    market_framing: {
      core_bet: "市场是否认可测试事件成立",
      key_assumption: "核心数据将公开"
    },
    disagreement_map: {
      pro: [
        {
          claim: "支持观点 1",
          source_type: "主流媒体",
          url: "https://news.example.com/1",
          time: "2026-01-28"
        },
        {
          claim: "支持观点 2",
          source_type: "官方公告",
          url: "https://news.example.com/2",
          time: "2026-01-27"
        }
      ],
      con: [
        {
          claim: "反对观点 1",
          source_type: "社交讨论",
          url: "https://social.example.com/1",
          time: "2026-01-26"
        },
        {
          claim: "反对观点 2",
          source_type: "主流媒体",
          url: "https://news.example.com/3",
          time: "2026-01-25"
        }
      ]
    },
    priced_vs_new: {
      priced_in: [
        { item: "已定价事项 1", source_type: "市场行为" },
        { item: "已定价事项 2", source_type: "主流媒体" }
      ],
      new_info: [
        { item: "新增事项 1", source_type: "官方公告" },
        { item: "新增事项 2", source_type: "社交讨论" }
      ]
    },
    sentiment: {
      bias: "neutral",
      relation: "none",
      samples: [
        { summary: "示例讨论", url: "https://social.example.com/2" }
      ]
    },
    key_variables: [
      {
        name: "变量 A",
        impact: "影响方向 A",
        observable_signals: "观察信号 A"
      }
    ],
    failure_modes: [
      { mode: "失败路径 1", observable_signals: "信号 1" },
      { mode: "失败路径 2", observable_signals: "信号 2" }
    ],
    risk_attribution: ["info", "time"],
    limitations: {
      cannot_detect: ["限制 1", "限制 2"],
      not_included: ["no_bet_advice", "no_position_sizing"]
    },
    ai_vs_market: {
      market_yes: 55,
      ai_yes_beta: 58,
      delta: 3,
      drivers: ["驱动因素 1", "驱动因素 2"]
    },
    ...(overrides ?? {})
  };
}

describe("renderTelegramReport", () => {
  it("renders markdown template with stable structure", () => {
    const report = buildReport();
    const text = renderTelegramReport(report);
    expect(text).toMatchSnapshot();
  });

  it("truncates long resolution_rules_raw with notice", () => {
    const longRules = "规则".repeat(600);
    const report = buildReport({
      context: {
        ...(buildReport().context as Record<string, unknown>),
        resolution_rules_raw: longRules
      }
    });
    const text = renderTelegramReport(report);
    expect(text).toContain("以市场页原文为准");
    const rulesSection = text.split("【1 市场在赌什么】")[0] ?? "";
    expect(rulesSection.length).toBeLessThan(longRules.length + 200);
  });
});
