import { loadTavilyConfig } from "../../config/load.js";
import { createAppError, ERROR_CODES } from "../errors.js";
import type {
  MarketContext,
  TavilyLaneResult,
  TavilyQueryPlan
} from "../types.js";
import { createTavilyProvider } from "../../providers/tavily/index.js";
import type { TavilyProvider } from "../../providers/tavily/index.js";

type SearchTavilyInput = {
  request_id: string;
  run_id: string;
  event_slug: string;
  market_context: MarketContext;
  query_plan: TavilyQueryPlan;
};

type SearchTavilyOutput = {
  market_context: MarketContext;
  query_plan: TavilyQueryPlan;
  tavily_results: TavilyLaneResult[];
};

type SearchTavilyOptions = {
  provider?: TavilyProvider;
  now?: () => number;
};

let defaultProvider: TavilyProvider | null = null;

function getDefaultTavilyProvider(): TavilyProvider {
  if (!defaultProvider) {
    defaultProvider = createTavilyProvider({ config: loadTavilyConfig() });
  }
  return defaultProvider;
}

export async function searchTavily(
  input: SearchTavilyInput,
  options: SearchTavilyOptions = {}
): Promise<SearchTavilyOutput> {
  const lanes = input.query_plan?.lanes ?? [];
  const eligibleLanes = lanes.filter(
    (lane) => lane.lane === "A" || lane.lane === "B" || lane.lane === "C"
  );

  if (eligibleLanes.length === 0) {
    throw createAppError({
      code: ERROR_CODES.STEP_TAVILY_QUERY_PLAN_MISSING,
      message: "Missing A/B/C tavily lanes",
      category: "VALIDATION",
      retryable: false,
      details: { event_slug: input.event_slug }
    });
  }

  const now = options.now ?? (() => Date.now());
  const provider = options.provider ?? getDefaultTavilyProvider();
  const startMs = now();
  const tavily_results: TavilyLaneResult[] = [];
  const cacheHit: Record<string, boolean> = {};
  const rateLimited: Record<string, boolean> = {};
  const laneLatencyMs: Record<string, number> = {};

  for (const lane of eligibleLanes) {
    const result = await provider.searchLane({
      event_slug: input.event_slug,
      lane: lane.lane,
      query: lane.query
    });
    tavily_results.push({
      lane: result.lane,
      query: result.query,
      results: result.results
    });
    cacheHit[result.lane] = result.cache_hit;
    rateLimited[result.lane] = result.rate_limited;
    laneLatencyMs[result.lane] = result.latency_ms;
  }

  const endMs = now();
  console.info({
    message: "step.search.tavily",
    step_id: "search.tavily",
    request_id: input.request_id,
    run_id: input.run_id,
    event_slug: input.event_slug,
    provider: "tavily",
    latency_ms: Math.max(0, endMs - startMs),
    cache_hit: cacheHit,
    rate_limited: rateLimited,
    lane_latency_ms: laneLatencyMs
  });

  return {
    market_context: input.market_context,
    query_plan: input.query_plan,
    tavily_results
  };
}

export type { SearchTavilyInput, SearchTavilyOutput, SearchTavilyOptions };
