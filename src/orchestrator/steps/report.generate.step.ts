import { createAppError, ERROR_CODES } from "../errors.js";
import type {
  ClobSnapshot,
  GammaMarket,
  LiquidityProxy,
  MarketContext,
  MarketSignal,
  PriceContext,
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
  const resolutionRules = input.market_context.resolution_rules_raw;
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
  return {
    title: input.market_context.title,
    url: buildMarketUrl(input.market_context.slug),
    resolution_rules_raw: resolutionRules,
    end_time: input.market_context.end_time,
    market_odds_yes: odds.yes,
    market_odds_no: odds.no,
    liquidity_proxy:
      input.market_context.liquidity_proxy ?? input.liquidity_proxy ?? null,
    price_context: priceContext
  };
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
  const llmInput: LlmReportInput = {
    context,
    evidence,
    clob: normalizeClobSnapshot(input.clob_snapshot),
    config: { aiProbabilityScale: "0-100" }
  };

  const report_json = await provider.generateReportV1(llmInput);

  return {
    market_context: input.market_context,
    clob_snapshot: input.clob_snapshot,
    tavily_results: input.tavily_results,
    report_json
  };
}

export type { ReportGenerateInput, ReportGenerateOutput, ReportGenerateOptions };
