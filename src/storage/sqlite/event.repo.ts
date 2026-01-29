import type { SqliteDatabase } from "./db.js";

export type EventRecord = {
  slug: string;
  url: string;
  title: string;
  description?: string | null;
  resolution_rules_raw?: string | null;
  end_time?: string | null;
  time_remaining?: string | null;
  market_yes?: number | null;
  market_no?: number | null;
  clob_token_ids_json?: string | null;
  gamma_liquidity?: number | null;
  book_depth_top10?: number | null;
  spread?: number | null;
  price_latest?: number | null;
  price_midpoint?: number | null;
  price_change_1h?: number | null;
  price_change_4h?: number | null;
  price_change_24h?: number | null;
  price_volatility_24h?: number | null;
  price_range_low_24h?: number | null;
  price_range_high_24h?: number | null;
  price_trend_slope_24h?: number | null;
  price_spike_flag?: boolean | null;
  price_history_24h_json?: string | null;
  created_at: string;
};

export function upsertEvent(db: SqliteDatabase, record: EventRecord): void {
  const stmt = db.prepare(
    `INSERT INTO event (
      slug,
      url,
      title,
      description,
      resolution_rules_raw,
      end_time,
      time_remaining,
      market_yes,
      market_no,
      clob_token_ids_json,
      gamma_liquidity,
      book_depth_top10,
      spread,
      price_latest,
      price_midpoint,
      price_change_1h,
      price_change_4h,
      price_change_24h,
      price_volatility_24h,
      price_range_low_24h,
      price_range_high_24h,
      price_trend_slope_24h,
      price_spike_flag,
      price_history_24h_json,
      created_at
    ) VALUES (
      @slug,
      @url,
      @title,
      @description,
      @resolution_rules_raw,
      @end_time,
      @time_remaining,
      @market_yes,
      @market_no,
      @clob_token_ids_json,
      @gamma_liquidity,
      @book_depth_top10,
      @spread,
      @price_latest,
      @price_midpoint,
      @price_change_1h,
      @price_change_4h,
      @price_change_24h,
      @price_volatility_24h,
      @price_range_low_24h,
      @price_range_high_24h,
      @price_trend_slope_24h,
      @price_spike_flag,
      @price_history_24h_json,
      @created_at
    )
    ON CONFLICT(slug) DO UPDATE SET
      url = excluded.url,
      title = excluded.title,
      description = excluded.description,
      resolution_rules_raw = excluded.resolution_rules_raw,
      end_time = excluded.end_time,
      time_remaining = excluded.time_remaining,
      market_yes = excluded.market_yes,
      market_no = excluded.market_no,
      clob_token_ids_json = excluded.clob_token_ids_json,
      gamma_liquidity = excluded.gamma_liquidity,
      book_depth_top10 = excluded.book_depth_top10,
      spread = excluded.spread,
      price_latest = excluded.price_latest,
      price_midpoint = excluded.price_midpoint,
      price_change_1h = excluded.price_change_1h,
      price_change_4h = excluded.price_change_4h,
      price_change_24h = excluded.price_change_24h,
      price_volatility_24h = excluded.price_volatility_24h,
      price_range_low_24h = excluded.price_range_low_24h,
      price_range_high_24h = excluded.price_range_high_24h,
      price_trend_slope_24h = excluded.price_trend_slope_24h,
      price_spike_flag = excluded.price_spike_flag,
      price_history_24h_json = excluded.price_history_24h_json,
      created_at = event.created_at
    `
  );

  stmt.run({
    ...record,
    price_spike_flag:
      typeof record.price_spike_flag === "boolean"
        ? record.price_spike_flag
          ? 1
          : 0
        : record.price_spike_flag ?? null
  });
}
