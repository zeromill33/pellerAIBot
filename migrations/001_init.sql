-- Initial schema for event/evidence/report tables

CREATE TABLE IF NOT EXISTS event (
  slug TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  resolution_rules_raw TEXT,
  end_time TEXT,
  time_remaining TEXT,
  market_yes REAL,
  market_no REAL,
  clob_token_ids_json TEXT,
  gamma_liquidity REAL,
  book_depth_top10 REAL,
  spread REAL,
  price_latest REAL,
  price_midpoint REAL,
  price_change_1h REAL,
  price_change_4h REAL,
  price_change_24h REAL,
  price_volatility_24h REAL,
  price_range_low_24h REAL,
  price_range_high_24h REAL,
  price_trend_slope_24h REAL,
  price_spike_flag INTEGER,
  price_history_24h_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  evidence_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  lane TEXT,
  source_type TEXT,
  url TEXT,
  domain TEXT,
  published_at TEXT,
  claim TEXT,
  stance TEXT,
  novelty TEXT,
  strength INTEGER,
  repeated INTEGER,
  FOREIGN KEY (slug) REFERENCES event(slug)
);

CREATE TABLE IF NOT EXISTS report (
  report_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  report_json TEXT,
  tg_post_text TEXT,
  status TEXT NOT NULL,
  validator_code TEXT,
  validator_message TEXT,
  regenerate_count_1h INTEGER,
  tg_message_id TEXT,
  reviewer TEXT,
  FOREIGN KEY (slug) REFERENCES event(slug)
);
