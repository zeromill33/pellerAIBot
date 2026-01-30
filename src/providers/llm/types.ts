import type {
  ClobSnapshot,
  LiquidityProxy,
  MarketContext,
  PriceContext,
  TavilyLaneResult
} from "../../orchestrator/types.js";

export type LlmMarketContext = {
  title: string;
  url: string;
  resolution_rules_raw: string;
  resolution_source_raw?: string;
  time_remaining?: string;
  end_time?: string;
  market_odds_yes: number | null;
  market_odds_no: number | null;
  liquidity_proxy: LiquidityProxy | null;
  price_context: PriceContext | null;
};

export type EvidenceDigest = {
  tavily_results: TavilyLaneResult[];
};

export type MarketMetricsPriceSignals = {
  latest_price: number | null;
  midpoint_price: number | null;
  change_1h: number | null;
  change_4h: number | null;
  change_24h: number | null;
  volatility_24h: number | null;
  range_high_24h: number | null;
  range_low_24h: number | null;
  trend_slope_24h: number | null;
  spike_flag: boolean | null;
};

export type MarketMetricsClobSummary = {
  spread: number | null;
  midpoint: number | null;
  price_change_24h: number | null;
  notable_walls_count: number;
  top_wall: {
    side: "bid" | "ask";
    price: number;
    size: number;
    multiple: number;
  } | null;
};

export type MarketMetricsSummary = {
  availability: "available" | "unavailable";
  reason?: string;
  price_signals: MarketMetricsPriceSignals | null;
  clob_metrics: MarketMetricsClobSummary | null;
};

export type LlmReportInput = {
  context: LlmMarketContext;
  evidence: EvidenceDigest;
  clob?: ClobSnapshot | null;
  market_metrics_summary: MarketMetricsSummary;
  config: { aiProbabilityScale: "0-100" };
};

export type ReportV1Json = Record<string, unknown>;

export type LlmPromptInput = {
  market_context: LlmMarketContext;
  clob_snapshot: ClobSnapshot | null;
  tavily_results: TavilyLaneResult[];
  market_metrics_summary: MarketMetricsSummary;
};

export type LLMProvider = {
  generateReportV1(input: LlmReportInput): Promise<ReportV1Json>;
};

export type LLMAdapter = {
  generateJson(
    prompt: { system: string; user: string },
    opts: { model: string; temperature?: number }
  ): Promise<{ text: string; raw?: unknown }>;
};

export type LlmAuditEntry = {
  prompt_name: string;
  prompt_sha256: string;
  model: string;
  temperature: number;
};

export type LLMProviderOptions = {
  adapter?: LLMAdapter;
  model?: string;
  temperature?: number;
  onAudit?: (entry: LlmAuditEntry) => void;
};

export type { MarketContext };
