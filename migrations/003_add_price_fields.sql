-- Add price context fields to Event table (run after initial schema exists)

ALTER TABLE event ADD COLUMN price_latest REAL;
ALTER TABLE event ADD COLUMN price_midpoint REAL;
ALTER TABLE event ADD COLUMN price_change_1h REAL;
ALTER TABLE event ADD COLUMN price_change_4h REAL;
ALTER TABLE event ADD COLUMN price_change_24h REAL;
ALTER TABLE event ADD COLUMN price_volatility_24h REAL;
ALTER TABLE event ADD COLUMN price_range_low_24h REAL;
ALTER TABLE event ADD COLUMN price_range_high_24h REAL;
ALTER TABLE event ADD COLUMN price_trend_slope_24h REAL;
ALTER TABLE event ADD COLUMN price_spike_flag INTEGER;
ALTER TABLE event ADD COLUMN price_history_24h_json TEXT;
