import { describe, it, expect, vi, beforeEach } from "vitest";
import { runPublishPipelineSteps } from "../../src/orchestrator/pipeline.js";
import type { GammaProvider } from "../../src/providers/polymarket/gamma.js";
import type { ClobProvider } from "../../src/providers/polymarket/clob.js";
import type { PricingProvider } from "../../src/providers/polymarket/pricing.js";
import type { TavilyProvider } from "../../src/providers/tavily/index.js";
import type { LLMProvider, ReportV1Json } from "../../src/providers/llm/types.js";
import { openSqliteDatabase } from "../../src/storage/sqlite/db.js";
import { createSqliteStorageAdapter } from "../../src/storage/sqlite/index.js";
import type { TelegramPublisher } from "../../src/providers/telegram/index.js";
import { createAppError } from "../../src/orchestrator/errors.js";

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
          time: "2026-01-03T00:00:00Z"
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
      priced_in: [
        { item: "Already partially priced in.", source_type: "官方公告" }
      ],
      new_info: [
        { item: "New discussion thread surfaced.", source_type: "社交讨论" }
      ]
    },
    sentiment: {
      bias: "unknown",
      relation: "unknown",
      samples: []
    },
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

const gammaProvider: Pick<GammaProvider, "getEventBySlug"> = {
  async getEventBySlug() {
    return {
      event_id: "event-1",
      slug: "test-event",
      title: "Test",
      description: "Test description",
      resolution_rules_raw: "Resolves if condition met.",
      end_time: "2026-12-01T00:00:00Z",
      markets: [],
      clobTokenIds: ["token-yes"],
      outcomePrices: [55, 45]
    };
  }
};

const clobProvider: ClobProvider = {
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

const pricingProvider: PricingProvider = {
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

const tavilyProvider: TavilyProvider = {
  async searchLane(input) {
    return {
      lane: input.lane,
      query: input.query,
      results: [
        {
          title: "Test event update",
          url: `https://example.com/${input.lane}/1`,
          domain: "example.com",
          published_at: "2026-01-28T00:00:00Z",
          raw_content: "Test event update with relevant details."
        }
      ],
      cache_hit: false,
      rate_limited: false,
      latency_ms: 1
    };
  }
};

const llmProvider: LLMProvider = {
  async generateReportV1() {
    return buildValidReport();
  }
};

describe("publish strategy", () => {
  let storage: ReturnType<typeof createSqliteStorageAdapter>;
  let db: ReturnType<typeof openSqliteDatabase>;

  beforeEach(() => {
    db = openSqliteDatabase({ filename: ":memory:" });
    storage = createSqliteStorageAdapter({ db });
  });

  it("auto strategy publishes and updates status", async () => {
    const publishSpy = vi.fn().mockResolvedValue({ message_id: "123" });
    const telegramPublisher: TelegramPublisher = {
      publishToChannel: publishSpy
    };

    await runPublishPipelineSteps(
      { request_id: "req-1", run_id: "run-1", event_slug: "test-event" },
      {
        stepOptions: {
          gammaProvider,
          clobProvider,
          pricingProvider,
          tavilyProvider,
          llmProvider,
          marketSignalsTopMarkets: 0,
          storage,
          telegramPublisher,
          publishConfig: { strategy: "auto" }
        },
        stopStepId: "telegram.publish"
      }
    );

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const report = db
      .prepare("SELECT status, tg_message_id FROM report WHERE report_id = ?")
      .get("report_run-1") as { status: string; tg_message_id: string };
    expect(report.status).toBe("published");
    expect(report.tg_message_id).toBe("123");
  });

  it("approve strategy skips publish", async () => {
    const publishSpy = vi.fn().mockResolvedValue({ message_id: "999" });
    const telegramPublisher: TelegramPublisher = {
      publishToChannel: publishSpy
    };

    await runPublishPipelineSteps(
      { request_id: "req-2", run_id: "run-2", event_slug: "test-event" },
      {
        stepOptions: {
          gammaProvider,
          clobProvider,
          pricingProvider,
          tavilyProvider,
          llmProvider,
          marketSignalsTopMarkets: 0,
          storage,
          telegramPublisher,
          publishConfig: { strategy: "approve" }
        },
        stopStepId: "telegram.publish"
      }
    );

    expect(publishSpy).not.toHaveBeenCalled();
    const report = db
      .prepare("SELECT status, tg_message_id FROM report WHERE report_id = ?")
      .get("report_run-2") as { status: string; tg_message_id: string | null };
    expect(report.status).toBe("ready");
    expect(report.tg_message_id).toBeNull();
  });

  it("publish failure updates report status with error code", async () => {
    const telegramPublisher: TelegramPublisher = {
      async publishToChannel() {
        throw createAppError({
          code: "PROVIDER_TG_REQUEST_FAILED",
          message: "rate limited",
          category: "PUBLISH",
          retryable: true
        });
      }
    };

    await expect(
      runPublishPipelineSteps(
        { request_id: "req-3", run_id: "run-3", event_slug: "test-event" },
        {
          stepOptions: {
            gammaProvider,
            clobProvider,
            pricingProvider,
            tavilyProvider,
            llmProvider,
            marketSignalsTopMarkets: 0,
            storage,
            telegramPublisher,
            publishConfig: { strategy: "auto" }
          },
          stopStepId: "telegram.publish"
        }
      )
    ).rejects.toMatchObject({ code: "PROVIDER_TG_REQUEST_FAILED" });

    const report = db
      .prepare(
        "SELECT status, validator_code, validator_message FROM report WHERE report_id = ?"
      )
      .get("report_run-3") as {
      status: string;
      validator_code: string | null;
      validator_message: string | null;
    };
    expect(report.status).toBe("blocked");
    expect(report.validator_code).toBe("PROVIDER_TG_REQUEST_FAILED");
    expect(report.validator_message).toBe("rate limited");
  });
});
