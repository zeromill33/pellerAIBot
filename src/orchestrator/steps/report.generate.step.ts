import { createAppError, ERROR_CODES } from "../errors.js";
import type {
  ClobSnapshot,
  GammaMarket,
  LiquidityProxy,
  MarketContext,
  MarketSignal,
  OfficialSource,
  PriceContext,
  ResolutionStructured,
  TavilyLane,
  TavilyLaneResult,
  TavilySearchResult
} from "../types.js";
import { createLLMProvider } from "../../providers/llm/index.js";
import type {
  EvidenceDigest,
  LLMProvider,
  LlmMarketContext,
  LlmReportInput,
  MarketMetricsSummary,
  ReportV1Json
} from "../../providers/llm/types.js";

type ReportGenerateInput = {
  request_id: string;
  run_id: string;
  event_slug: string;
  market_context: MarketContext;
  clob_snapshot?: ClobSnapshot;
  tavily_results?: TavilyLaneResult[];
  market_signals?: MarketSignal[];
  liquidity_proxy?: LiquidityProxy;
  resolution_structured?: ResolutionStructured | null;
  official_sources?: OfficialSource[];
  official_sources_error?: string;
};

type ReportGenerateOutput = {
  market_context: MarketContext;
  clob_snapshot?: ClobSnapshot;
  tavily_results?: TavilyLaneResult[];
  report_json: ReportV1Json;
};

type ReportGenerateOptions = {
  provider?: LLMProvider;
};

const MARKET_BASE_URL = "https://polymarket.com/event";

const LANE_PRIORITY: Record<TavilyLane, number> = {
  A: 0,
  B: 1,
  C: 2,
  D: 3
};

function buildMarketUrl(slug: string): string {
  return `${MARKET_BASE_URL}/${slug}`;
}

function resolvePrimaryMarket(context: MarketContext): GammaMarket | null {
  if (!context.markets || context.markets.length === 0) {
    return null;
  }
  if (context.primary_market_id) {
    const match = context.markets.find(
      (market) => market.market_id === context.primary_market_id
    );
    if (match) {
      return match;
    }
  }
  if (context.markets.length === 1) {
    return context.markets[0] ?? null;
  }
  return null;
}

function resolveMarketOdds(context: MarketContext): {
  yes: number | null;
  no: number | null;
} {
  const market = resolvePrimaryMarket(context);
  const outcomes = market?.outcomes ?? [];
  const prices = market?.outcomePrices ?? context.outcomePrices ?? [];
  if (prices.length === 0) {
    return { yes: null, no: null };
  }

  const normalizedOutcomes = outcomes.map((outcome) => outcome.trim().toLowerCase());
  const yesIndex = normalizedOutcomes.findIndex((outcome) => outcome === "yes");
  const noIndex = normalizedOutcomes.findIndex((outcome) => outcome === "no");

  const yes = yesIndex >= 0 ? prices[yesIndex] ?? null : prices[0] ?? null;
  const no =
    noIndex >= 0
      ? prices[noIndex] ?? null
      : prices.length > 1
        ? prices[1] ?? null
        : null;

  return {
    yes: typeof yes === "number" ? yes : null,
    no: typeof no === "number" ? no : null
  };
}

function formatTimeRemaining(endTime?: string): string {
  if (!endTime) {
    return "N/A";
  }
  const endMs = Date.parse(endTime);
  if (Number.isNaN(endMs)) {
    return "N/A";
  }
  const diffMs = Math.max(0, endMs - Date.now());
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function resolvePriceContext(
  context: MarketContext,
  marketSignals?: MarketSignal[]
): PriceContext | null {
  if (context.price_context) {
    return context.price_context;
  }
  const signals = marketSignals ?? context.market_signals ?? [];
  if (signals.length === 0) {
    return null;
  }
  if (context.primary_market_id) {
    const match = signals.find(
      (signal) => signal.market_id === context.primary_market_id
    );
    if (match) {
      return match.price_context;
    }
  }
  return signals[0]?.price_context ?? null;
}

function hasSignalValues(signals: PriceContext["signals"]): boolean {
  return Object.values(signals).some(
    (value) => value !== null && value !== undefined
  );
}

function buildPriceSignalsSummary(priceContext: PriceContext | null): {
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
} | null {
  if (!priceContext) {
    return null;
  }
  const hasSignals = hasSignalValues(priceContext.signals);
  const hasPrices =
    priceContext.latest_price !== null || priceContext.midpoint_price !== null;
  if (!hasSignals && !hasPrices) {
    return null;
  }
  return {
    latest_price: priceContext.latest_price,
    midpoint_price: priceContext.midpoint_price,
    change_1h: priceContext.signals.change_1h,
    change_4h: priceContext.signals.change_4h,
    change_24h: priceContext.signals.change_24h,
    volatility_24h: priceContext.signals.volatility_24h,
    range_high_24h: priceContext.signals.range_high_24h,
    range_low_24h: priceContext.signals.range_low_24h,
    trend_slope_24h: priceContext.signals.trend_slope_24h,
    spike_flag: priceContext.signals.spike_flag
  };
}

function buildClobMetricsSummary(snapshot?: ClobSnapshot): {
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
} | null {
  if (!snapshot) {
    return null;
  }
  const notableWalls = snapshot.notable_walls ?? [];
  const notableCount = notableWalls.length;
  const topWall =
    notableCount > 0
      ? notableWalls.reduce((current, candidate) =>
          candidate.multiple > current.multiple ? candidate : current
        )
      : null;
  const hasMetrics =
    snapshot.spread !== null ||
    snapshot.midpoint !== null ||
    snapshot.price_change_24h !== null ||
    notableCount > 0;
  if (!hasMetrics) {
    return null;
  }
  return {
    spread: snapshot.spread ?? null,
    midpoint: snapshot.midpoint ?? null,
    price_change_24h: snapshot.price_change_24h ?? null,
    notable_walls_count: notableCount,
    top_wall: topWall
      ? {
          side: topWall.side,
          price: topWall.price,
          size: topWall.size,
          multiple: topWall.multiple
        }
      : null
  };
}

function buildMarketMetricsSummary(
  input: ReportGenerateInput
): MarketMetricsSummary {
  const priceContext = resolvePriceContext(input.market_context, input.market_signals);
  const priceSignals = buildPriceSignalsSummary(priceContext);
  const clobMetrics = buildClobMetricsSummary(input.clob_snapshot);
  const reasons: string[] = [];

  if (!priceSignals) {
    if (!priceContext) {
      reasons.push("price_context_missing");
    } else if (!hasSignalValues(priceContext.signals)) {
      reasons.push("price_signals_unavailable");
    } else {
      reasons.push("price_signals_empty");
    }
  }
  if (priceContext?.history_warning) {
    reasons.push(
      `${priceContext.history_warning.code}: ${priceContext.history_warning.message}`
    );
  }
  if (!clobMetrics) {
    reasons.push("clob_snapshot_missing");
  }

  const availability =
    priceSignals || clobMetrics ? "available" : "unavailable";

  return {
    availability,
    reason: reasons.length > 0 ? reasons.join("; ") : undefined,
    price_signals: priceSignals,
    clob_metrics: clobMetrics
  };
}

function normalizeClobSnapshot(snapshot?: ClobSnapshot): ClobSnapshot {
  return {
    spread: snapshot?.spread ?? null,
    midpoint: snapshot?.midpoint ?? null,
    book_top_levels: snapshot?.book_top_levels ?? [],
    notable_walls: snapshot?.notable_walls ?? [],
    price_change_24h: snapshot?.price_change_24h
  };
}

function toPublishedAtMs(value?: string): number {
  if (!value) {
    return Number.MAX_SAFE_INTEGER;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function sortTavilyResults(tavily_results: TavilyLaneResult[]): TavilyLaneResult[] {
  return tavily_results
    .slice()
    .sort((a, b) => {
      const laneOrder = (LANE_PRIORITY[a.lane] ?? 99) - (LANE_PRIORITY[b.lane] ?? 99);
      if (laneOrder !== 0) {
        return laneOrder;
      }
      const queryCompare = a.query.localeCompare(b.query);
      if (queryCompare !== 0) {
        return queryCompare;
      }
      return 0;
    })
    .map((lane) => ({
      lane: lane.lane,
      query: lane.query,
      results: lane.results
        .slice()
        .sort((left, right) => {
          const timeDiff = toPublishedAtMs(left.published_at) -
            toPublishedAtMs(right.published_at);
          if (timeDiff !== 0) {
            return timeDiff;
          }
          const domainCompare = left.domain.localeCompare(right.domain);
          if (domainCompare !== 0) {
            return domainCompare;
          }
          return left.url.localeCompare(right.url);
        })
    }));
}

function normalizeTavilyResults(
  tavily_results: TavilyLaneResult[]
): TavilyLaneResult[] {
  const sorted = sortTavilyResults(tavily_results);
  return sorted.map((lane) => ({
    lane: lane.lane,
    query: lane.query,
    results: lane.results.map((result: TavilySearchResult) => ({
      title: result.title,
      url: result.url,
      domain: result.domain,
      published_at: result.published_at,
      raw_content: result.raw_content
    }))
  }));
}

function buildMarketContextInput(
  input: ReportGenerateInput
): LlmMarketContext {
  const resolutionRules =
    input.market_context.resolution_rules_raw ??
    input.market_context.description;
  if (!resolutionRules || resolutionRules.trim().length === 0) {
    throw createAppError({
      code: ERROR_CODES.STEP_REPORT_GENERATE_MISSING_INPUT,
      message: "Missing resolution_rules_raw for report.generate",
      category: "VALIDATION",
      retryable: false,
      details: { event_slug: input.event_slug }
    });
  }
  const odds = resolveMarketOdds(input.market_context);
  const priceContext = resolvePriceContext(input.market_context, input.market_signals);
  const timeRemaining = formatTimeRemaining(input.market_context.end_time);
  return {
    title: input.market_context.title,
    url: buildMarketUrl(input.market_context.slug),
    resolution_rules_raw: resolutionRules,
    resolution_source_raw: input.market_context.resolution_source_raw,
    time_remaining: timeRemaining,
    end_time: input.market_context.end_time,
    market_odds_yes: odds.yes,
    market_odds_no: odds.no,
    liquidity_proxy:
      input.market_context.liquidity_proxy ?? input.liquidity_proxy ?? null,
    price_context: priceContext
  };
}

function mergeOfficialAndResolution(
  report_json: ReportV1Json,
  resolution_structured: ResolutionStructured | null,
  official_sources: OfficialSource[],
  official_sources_error?: string
): ReportV1Json {
  if (!report_json || typeof report_json !== "object" || Array.isArray(report_json)) {
    return report_json;
  }
  const report = { ...(report_json as Record<string, unknown>) };
  const context =
    report.context && typeof report.context === "object" && !Array.isArray(report.context)
      ? { ...(report.context as Record<string, unknown>) }
      : {};
  if (resolution_structured) {
    context.resolution_structured = resolution_structured;
  }
  report.context = context;
  report.official_sources = official_sources;
  if (official_sources_error) {
    report.official_sources_error = official_sources_error;
  }
  return report as ReportV1Json;
}

function buildEvidenceDigest(tavily_results: TavilyLaneResult[]): EvidenceDigest {
  return {
    tavily_results: normalizeTavilyResults(tavily_results)
  };
}

export async function generateReport(
  input: ReportGenerateInput,
  options: ReportGenerateOptions = {}
): Promise<ReportGenerateOutput> {
  if (!input.market_context) {
    throw createAppError({
      code: ERROR_CODES.STEP_REPORT_GENERATE_MISSING_INPUT,
      message: "Missing market_context for report.generate",
      category: "VALIDATION",
      retryable: false,
      details: { event_slug: input.event_slug }
    });
  }

  if (!input.tavily_results) {
    throw createAppError({
      code: ERROR_CODES.STEP_REPORT_GENERATE_MISSING_INPUT,
      message: "Missing tavily_results for report.generate",
      category: "VALIDATION",
      retryable: false,
      details: { event_slug: input.event_slug }
    });
  }

  const provider = options.provider ?? createLLMProvider();
  const context = buildMarketContextInput(input);
  const evidence = buildEvidenceDigest(input.tavily_results);
  const resolution_structured = input.resolution_structured ?? null;
  const official_sources = input.official_sources ?? [];
  const marketMetricsSummary = buildMarketMetricsSummary(input);
  const llmInput: LlmReportInput = {
    context,
    evidence,
    clob: normalizeClobSnapshot(input.clob_snapshot),
    market_metrics_summary: marketMetricsSummary,
    resolution_structured,
    official_sources,
    official_sources_error: input.official_sources_error,
    config: { aiProbabilityScale: "0-100" }
  };

  const report_json = mergeOfficialAndResolution(
    await provider.generateReportV1(llmInput),
    resolution_structured,
    official_sources,
    input.official_sources_error
  );

  return {
    market_context: input.market_context,
    clob_snapshot: input.clob_snapshot,
    tavily_results: input.tavily_results,
    report_json
  };
}

export type { ReportGenerateInput, ReportGenerateOutput, ReportGenerateOptions };
