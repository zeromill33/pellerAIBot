import { describe, it, expect, beforeEach } from "vitest";
import type { MarketContext } from "../../src/orchestrator/types.js";
import { openSqliteDatabase } from "../../src/storage/sqlite/db.js";
import { createSqliteStorageAdapter } from "../../src/storage/sqlite/index.js";
import { persistEventEvidenceReport } from "../../src/orchestrator/steps/persist.step.js";

const FIXED_NOW = new Date("2026-01-29T12:00:00Z").getTime();

function buildMarketContext(): MarketContext {
  return {
    event_id: "evt_1",
    slug: "test-market",
    title: "Will the test pass?",
    description: "Test market description",
    resolution_rules_raw: "Resolution rules",
    end_time: "2026-02-01T00:00:00Z",
    category: "test",
    markets: [
      {
        market_id: "m1",
        question: "Will the test pass?",
        outcomes: ["Yes", "No"],
        outcomePrices: [55, 45],
        clobTokenIds: ["token_yes", "token_no"],
        volume: 100,
        liquidity: 500
      }
    ],
    primary_market_id: "m1",
    outcomePrices: [55, 45],
    clobTokenIds: ["token_yes", "token_no"],
    price_context: {
      token_id: "token_yes",
      latest_price: 0.52,
      midpoint_price: 0.5,
      history_24h: [{ ts: 1, price: 0.5 }],
      signals: {
        change_1h: 1,
        change_4h: 2,
        change_24h: 3,
        volatility_24h: 4,
        range_high_24h: 0.6,
        range_low_24h: 0.4,
        trend_slope_24h: 0.01,
        spike_flag: false
      }
    }
  };
}

describe("persistEventEvidenceReport", () => {
  let db: ReturnType<typeof openSqliteDatabase>;
  let storage: ReturnType<typeof createSqliteStorageAdapter>;

  beforeEach(() => {
    db = openSqliteDatabase({ filename: ":memory:" });
    storage = createSqliteStorageAdapter({ db });
  });

  it("writes event/evidence/report on success", async () => {
    const marketContext = buildMarketContext();

    await persistEventEvidenceReport(
      {
        request_id: "req_1",
        run_id: "run_1",
        event_slug: marketContext.slug,
        market_context: marketContext,
        evidence_candidates: [
          {
            source_type: "media",
            url: "https://example.com/news",
            domain: "example.com",
            published_at: "2026-01-28T00:00:00Z",
            claim: "Example claim",
            stance: "supports_yes",
            novelty: "new",
            repeated: false,
            strength: 4,
            lane: "A",
            query: "test query"
          }
        ],
        report_json: { report_version: "v1" },
        liquidity_proxy: {
          gamma_liquidity: 1200,
          book_depth_top10: 320,
          spread: 0.02,
          midpoint: 0.5,
          notable_walls: []
        }
      },
      { storage, status: "ready", now: () => FIXED_NOW }
    );

    const eventRow = db.prepare("SELECT * FROM event WHERE slug = ?").get(
      marketContext.slug
    ) as Record<string, unknown>;
    expect(eventRow.slug).toBe(marketContext.slug);
    expect(eventRow.title).toBe(marketContext.title);
    expect(eventRow.market_yes).toBe(55);
    expect(eventRow.market_no).toBe(45);
    expect(eventRow.price_latest).toBe(0.52);

    const evidenceRows = db.prepare("SELECT * FROM evidence").all() as Record<
      string,
      unknown
    >[];
    expect(evidenceRows.length).toBe(1);
    expect(evidenceRows[0]?.source_type).toBe("media");
    expect(evidenceRows[0]?.stance).toBe("supports_yes");

    const reportRow = db.prepare("SELECT * FROM report WHERE slug = ?").get(
      marketContext.slug
    ) as Record<string, unknown>;
    expect(reportRow.status).toBe("ready");
    expect(reportRow.validator_code).toBeNull();
    expect(reportRow.validator_message).toBeNull();
    expect(reportRow.generated_at).toBe(new Date(FIXED_NOW).toISOString());
  });

  it("writes blocked report with validator info", async () => {
    const marketContext = buildMarketContext();

    await persistEventEvidenceReport(
      {
        request_id: "req_2",
        run_id: "run_2",
        event_slug: marketContext.slug,
        market_context: marketContext,
        evidence_candidates: [],
        report_json: "{bad json}",
        liquidity_proxy: {
          gamma_liquidity: null,
          book_depth_top10: 0,
          spread: null,
          midpoint: null,
          notable_walls: []
        }
      },
      {
        storage,
        status: "blocked",
        validator_code: "VALIDATOR_SCHEMA_INVALID",
        validator_message: "Schema validation failed",
        now: () => FIXED_NOW
      }
    );

    const reportRow = db.prepare("SELECT * FROM report WHERE slug = ?").get(
      marketContext.slug
    ) as Record<string, unknown>;
    expect(reportRow.status).toBe("blocked");
    expect(reportRow.validator_code).toBe("VALIDATOR_SCHEMA_INVALID");
    expect(reportRow.validator_message).toBe("Schema validation failed");
    expect(reportRow.report_json).toBe("{bad json}");
  });
});
