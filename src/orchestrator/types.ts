import type { AppError, ErrorCategory, ErrorSuggestion } from "./errors.js";

export type ErrorReceipt = {
  code: string;
  message: string;
  category: ErrorCategory;
  retryable: boolean;
  details?: Record<string, unknown>;
  suggestion?: ErrorSuggestion;
};

export type InvalidUrlResult = {
  url: string;
  error: AppError;
};

export type UrlParseResult = {
  event_slugs: string[];
  invalid_urls: InvalidUrlResult[];
};

export type PublishItemSuccess = {
  event_slug: string;
  run_id: string;
  status: "success";
};

export type PublishItemFailure = {
  event_slug: string;
  run_id: string;
  status: "failed";
  error: AppError;
};

export type PublishBatchSummary = {
  total: number;
  succeeded: number;
  failed: number;
  invalid: number;
};

export type PublishBatchInput = {
  request_id: string;
  urls: string[];
  concurrency?: number;
};

export type PublishPipelineInput = {
  request_id: string;
  run_id: string;
  event_slug: string;
  evidence_candidates?: EvidenceCandidate[];
};

export type PublishPipelineResult = PublishItemSuccess | PublishItemFailure;

export type PublishBatchResult = UrlParseResult & {
  request_id: string;
  successes: PublishItemSuccess[];
  failures: PublishItemFailure[];
  summary: PublishBatchSummary;
};

export type GammaMarket = {
  market_id: string;
  question?: string;
  outcomes: string[];
  outcomePrices: number[];
  clobTokenIds: string[];
  volume?: number;
  liquidity?: number;
};

export type MarketContext = {
  event_id: string;
  slug: string;
  title: string;
  description?: string;
  resolution_rules_raw?: string;
  end_time?: string;
  category?: string;
  markets: GammaMarket[];
  primary_market_id?: string;
  outcomePrices?: number[];
  clobTokenIds?: string[];
  clob_market_id_used?: string;
  clob_token_id_used?: string;
  market_signals?: MarketSignal[];
  price_context?: PriceContext;
  liquidity_proxy?: LiquidityProxy;
};

export type OrderBookLevel = {
  side: "bid" | "ask";
  price: number;
  size: number;
};

export type NotableWall = OrderBookLevel & {
  multiple: number;
};

export type ClobSnapshot = {
  spread: number | null;
  midpoint: number | null;
  book_top_levels: OrderBookLevel[];
  notable_walls: NotableWall[];
  price_change_24h?: number;
};

export type OrderBookSummary = ClobSnapshot;

export type PricePoint = {
  ts: number;
  price: number;
};

export type PriceSignals = {
  change_1h: number | null;
  change_4h: number | null;
  change_24h: number | null;
  volatility_24h: number | null;
  range_high_24h: number | null;
  range_low_24h: number | null;
  trend_slope_24h: number | null;
  spike_flag: boolean | null;
};

export type PriceHistoryWarning = {
  code: "PRICE_HISTORY_INSUFFICIENT" | "PRICE_API_FAILED";
  message: string;
};

export type PriceContext = {
  token_id: string;
  latest_price: number | null;
  midpoint_price: number | null;
  history_24h: PricePoint[];
  signals: PriceSignals;
  history_warning?: PriceHistoryWarning;
};

export type LiquidityProxy = {
  gamma_liquidity: number | null;
  book_depth_top10: number;
  spread: number | null;
  midpoint: number | null;
  notable_walls: NotableWall[];
};

export type MarketSignal = {
  market_id: string;
  token_id: string;
  clob_snapshot: ClobSnapshot;
  price_context: PriceContext;
};

export type TavilyLane = "A" | "B" | "C" | "D";

export type TavilyQueryLane = {
  lane: TavilyLane;
  query: string;
};

export type TavilyQueryPlan = {
  lanes: TavilyQueryLane[];
};

export type TavilySearchResult = {
  title: string;
  url: string;
  domain: string;
  published_at?: string;
  raw_content: string | null;
};

export type TavilyLaneResult = {
  lane: TavilyLane;
  query: string;
  results: TavilySearchResult[];
};

export type EvidenceCandidate = {
  stance?: string;
};
