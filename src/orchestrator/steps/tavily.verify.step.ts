import { createAppError, ERROR_CODES } from "../errors.js";
import type {
  DroppedEvidence,
  MarketContext,
  TavilyLaneResult,
  TavilySearchResult
} from "../types.js";
import { normalizeText } from "../../utils/text.js";

type TavilyVerifyInput = {
  request_id: string;
  run_id: string;
  event_slug: string;
  market_context: MarketContext;
  tavily_results: TavilyLaneResult[];
};

type TavilyVerifyOutput = {
  market_context: MarketContext;
  tavily_results_filtered: TavilyLaneResult[];
  dropped_evidence: DroppedEvidence[];
};

type TavilyVerifyOptions = {
  now?: () => number;
};

const MAX_AGE_DAYS = 14;
const MIN_FILTERED_URLS = 3;
const MIN_KEYWORD_LENGTH = 3;
const MAX_KEYWORDS = 20;

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "will",
  "would",
  "could",
  "should",
  "about",
  "over",
  "after",
  "before",
  "under",
  "between",
  "against",
  "when",
  "where",
  "what",
  "which",
  "while",
  "https",
  "http"
]);

function extractKeywords(input: string | undefined, limit: number): string[] {
  if (!input) {
    return [];
  }
  const tokens = normalizeText(input)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_KEYWORD_LENGTH && !STOPWORDS.has(token));
  const unique = Array.from(new Set(tokens));
  return unique.slice(0, limit);
}

function buildKeywordSet(context: MarketContext): string[] {
  const keywords: string[] = [];
  keywords.push(...extractKeywords(context.title, 8));
  keywords.push(...extractKeywords(context.slug, 6));
  keywords.push(...extractKeywords(context.description, 6));
  keywords.push(...extractKeywords(context.resolution_rules_raw, 6));
  keywords.push(...extractKeywords(context.resolution_source_raw, 4));
  const unique = Array.from(new Set(keywords));
  return unique.slice(0, MAX_KEYWORDS);
}

function hasKeywordMatch(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) {
    return true;
  }
  const tokenSet = new Set(normalizeText(text).split(" ").filter(Boolean));
  return keywords.some((keyword) => tokenSet.has(keyword));
}

function isStale(
  publishedAt: string | undefined,
  nowMs: number
): { stale: boolean; invalid: boolean } {
  if (!publishedAt) {
    return { stale: false, invalid: false };
  }
  const parsed = Date.parse(publishedAt);
  if (Number.isNaN(parsed)) {
    return { stale: true, invalid: true };
  }
  const maxAgeMs = MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return { stale: nowMs - parsed > maxAgeMs, invalid: false };
}

function filterLaneResults(
  lane: TavilyLaneResult,
  keywords: string[],
  nowMs: number
): { kept: TavilySearchResult[]; dropped: DroppedEvidence[] } {
  const kept: TavilySearchResult[] = [];
  const dropped: DroppedEvidence[] = [];

  for (const result of lane.results) {
    if (!result.raw_content || result.raw_content.trim().length === 0) {
      dropped.push({
        url: result.url,
        reason: "missing_raw_content",
        lane: lane.lane,
        query: lane.query,
        title: result.title
      });
      continue;
    }

    const freshness = isStale(result.published_at, nowMs);
    if (freshness.stale) {
      dropped.push({
        url: result.url,
        reason: freshness.invalid ? "invalid_published_at" : "stale_published_at",
        lane: lane.lane,
        query: lane.query,
        title: result.title,
        published_at: result.published_at
      });
      continue;
    }

    const matchText = `${result.title} ${result.raw_content}`;
    if (!hasKeywordMatch(matchText, keywords)) {
      dropped.push({
        url: result.url,
        reason: "no_keyword_match",
        lane: lane.lane,
        query: lane.query,
        title: result.title
      });
      continue;
    }

    kept.push(result);
  }

  return { kept, dropped };
}

export async function verifyTavilyResults(
  input: TavilyVerifyInput,
  options: TavilyVerifyOptions = {}
): Promise<TavilyVerifyOutput> {
  if (!input.market_context || !input.tavily_results) {
    throw createAppError({
      code: ERROR_CODES.ORCH_PIPELINE_FAILED,
      message: "Missing market_context/tavily_results for tavily.verify",
      category: "INTERNAL",
      retryable: false,
      details: { event_slug: input.event_slug }
    });
  }

  const now = options.now ?? (() => Date.now());
  const nowMs = now();
  const keywords = buildKeywordSet(input.market_context);

  const droppedEvidence: DroppedEvidence[] = [];
  const filteredResults: TavilyLaneResult[] = input.tavily_results.map((lane) => {
    const { kept, dropped } = filterLaneResults(lane, keywords, nowMs);
    droppedEvidence.push(...dropped);
    return { ...lane, results: kept };
  });

  const uniqueUrls = new Set(
    filteredResults.flatMap((lane) => lane.results.map((result) => result.url))
  );

  console.info({
    message: "step.tavily.verify",
    step_id: "tavily.verify",
    request_id: input.request_id,
    run_id: input.run_id,
    event_slug: input.event_slug,
    keyword_count: keywords.length,
    total_results: input.tavily_results.reduce(
      (sum, lane) => sum + lane.results.length,
      0
    ),
    filtered_results: uniqueUrls.size,
    dropped_count: droppedEvidence.length
  });

  if (uniqueUrls.size < MIN_FILTERED_URLS) {
    throw createAppError({
      code: ERROR_CODES.STEP_TAVILY_RELEVANCE_INSUFFICIENT,
      message: "Filtered tavily results below minimum threshold",
      category: "VALIDATION",
      retryable: false,
      details: {
        event_slug: input.event_slug,
        min_required: MIN_FILTERED_URLS,
        remaining: uniqueUrls.size
      },
      suggestion: {
        action: "ADD_SEARCH",
        preferred_lane: "C",
        message: "过滤后证据不足，建议补搜 C lane advanced"
      }
    });
  }

  return {
    market_context: input.market_context,
    tavily_results_filtered: filteredResults,
    dropped_evidence: droppedEvidence
  };
}

export type { TavilyVerifyInput, TavilyVerifyOutput, TavilyVerifyOptions };
