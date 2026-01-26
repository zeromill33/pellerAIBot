import { createAppError, ERROR_CODES } from "../../orchestrator/errors.js";
import type { TavilyLaneResult, TavilySearchResult } from "../../orchestrator/types.js";
import { validateTavilyConfig } from "../../config/config.schema.js";
import type { TavilyConfig } from "../../config/config.schema.js";
import { buildTavilyLaneParams } from "./lanes.js";
import { buildTavilyCacheKey, TavilyCache } from "./cache.js";
import { createTavilyClient, TavilyRequestError } from "./client.js";
import type { TavilySearchRequest } from "./client.js";

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  headers: {
    get(name: string): string | null;
  };
};

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponse>;

export type TavilySearchLaneInput = {
  event_slug: string;
  lane: "A" | "B" | "C" | "D";
  query: string;
};

export type TavilyLaneSearchResult = TavilyLaneResult & {
  cache_hit: boolean;
  rate_limited: boolean;
  latency_ms: number;
};

export type TavilyProvider = {
  searchLane(input: TavilySearchLaneInput): Promise<TavilyLaneSearchResult>;
};

export type TavilyProviderOptions = {
  config?: Partial<TavilyConfig>;
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  retryBaseDelayMs?: number;
  cacheTtlMs?: number;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const DEFAULT_OPTIONS = {
  cacheTtlMs: 24 * 60 * 60 * 1000
};

type TokenBucketResult = {
  rateLimited: boolean;
  waitMs: number;
};

class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly qps: number;
  private readonly burst: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(params: {
    qps: number;
    burst: number;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
  }) {
    this.qps = params.qps;
    this.burst = params.burst;
    this.now = params.now;
    this.sleep = params.sleep;
    this.tokens = params.burst;
    this.lastRefill = this.now();
  }

  private refill(now: number) {
    if (this.qps <= 0) {
      this.tokens = this.burst;
      this.lastRefill = now;
      return;
    }
    const elapsedSeconds = Math.max(0, now - this.lastRefill) / 1000;
    const refill = elapsedSeconds * this.qps;
    this.tokens = Math.min(this.burst, this.tokens + refill);
    this.lastRefill = now;
  }

  async acquire(): Promise<TokenBucketResult> {
    const now = this.now();
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { rateLimited: false, waitMs: 0 };
    }
    const needed = 1 - this.tokens;
    const waitMs = Math.ceil((needed / this.qps) * 1000);
    if (waitMs > 0) {
      await this.sleep(waitMs);
    }
    const afterWait = this.now();
    this.refill(afterWait);
    if (this.tokens >= 1) {
      this.tokens -= 1;
    } else {
      this.tokens = 0;
    }
    return { rateLimited: waitMs > 0, waitMs };
  }
}

function normalizeTavilyTimeRange(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const accepted = new Set(["day", "week", "month", "year", "d", "w", "m", "y"]);
  if (accepted.has(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/^(\d+)\s*d$/);
  if (match) {
    const days = Number(match[1]);
    if (Number.isFinite(days)) {
      if (days <= 1) {
        return "day";
      }
      if (days <= 7) {
        return "week";
      }
      if (days <= 31) {
        return "month";
      }
      return "year";
    }
  }
  return trimmed;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function parseDomain(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.trim();
    return host ? host.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function extractResults(payload: unknown): unknown[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const results = record.results;
  if (Array.isArray(results)) {
    return results;
  }
  const data = record.data;
  if (Array.isArray(data)) {
    return data;
  }
  return null;
}

function mapTavilyResults(payload: unknown): TavilySearchResult[] {
  const results = extractResults(payload);
  if (!results) {
    throw new Error("Missing results array");
  }
  const mapped: TavilySearchResult[] = [];
  for (const result of results) {
    if (!result || typeof result !== "object") {
      continue;
    }
    const record = result as Record<string, unknown>;
    const title = toOptionalString(record.title);
    const url = toOptionalString(record.url);
    if (!title || !url) {
      continue;
    }
    const domain =
      toOptionalString(record.domain) ??
      toOptionalString(record.source) ??
      parseDomain(url);
    if (!domain) {
      continue;
    }
    const publishedAt =
      toOptionalString(record.published_at) ??
      toOptionalString(record.published_date) ??
      toOptionalString(record.publishedAt);
    const rawContent =
      toOptionalString(record.raw_content) ??
      toOptionalString(record.content) ??
      null;

    mapped.push({
      title,
      url,
      domain,
      published_at: publishedAt,
      raw_content: rawContent
    });
  }

  return mapped;
}

function createProviderError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  retryable = false,
  category: "PROVIDER" | "RATE_LIMIT" | "VALIDATION" = "PROVIDER"
) {
  return createAppError({
    code,
    message,
    category,
    retryable,
    details
  });
}

export function createTavilyProvider(
  options: TavilyProviderOptions = {}
): TavilyProvider {
  const config = validateTavilyConfig(options.config ?? {});
  if (!config.api_key) {
    throw createProviderError(
      ERROR_CODES.PROVIDER_TAVILY_CONFIG_INVALID,
      "Tavily api_key is required",
      undefined,
      false,
      "VALIDATION"
    );
  }

  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? (async (ms: number) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

  const client = createTavilyClient({
    baseUrl: options.baseUrl,
    apiKey: config.api_key,
    timeoutMs: options.timeoutMs,
    retries: options.retries,
    retryBaseDelayMs: options.retryBaseDelayMs,
    fetch: options.fetch,
    now,
    sleep
  });

  const cache = new TavilyCache(now);
  const rateLimiter = new TokenBucketRateLimiter({
    qps: config.rate_limit.qps,
    burst: config.rate_limit.burst,
    now,
    sleep
  });
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_OPTIONS.cacheTtlMs;

  async function searchLane(
    input: TavilySearchLaneInput
  ): Promise<TavilyLaneSearchResult> {
    const query = input.query.trim();
    if (!input.event_slug || !query) {
      throw createProviderError(
        ERROR_CODES.PROVIDER_TAVILY_REQUEST_FAILED,
        "Tavily search requires event_slug and query",
        { event_slug: input.event_slug, lane: input.lane }
      );
    }

    const cacheKey = buildTavilyCacheKey({
      event_slug: input.event_slug,
      lane: input.lane,
      query,
      now: now()
    });

    let rateLimited = false;
    const startMs = now();
    const { value, cacheHit } = await cache.getOrSet(
      cacheKey,
      cacheTtlMs,
      async () => {
        const laneParams = buildTavilyLaneParams(input.lane, config);
        const limiterResult = await rateLimiter.acquire();
        rateLimited = limiterResult.rateLimited;

        const request: TavilySearchRequest = {
          query,
          search_depth: laneParams.search_depth,
          max_results: laneParams.max_results,
          include_raw_content: laneParams.include_raw_content,
          include_answer: laneParams.include_answer,
          auto_parameters: laneParams.auto_parameters,
          time_range: normalizeTavilyTimeRange(laneParams.time_range)
        };
        if (laneParams.include_domains && laneParams.include_domains.length > 0) {
          request.include_domains = laneParams.include_domains;
        }
        if (laneParams.exclude_domains && laneParams.exclude_domains.length > 0) {
          request.exclude_domains = laneParams.exclude_domains;
        }

        const payload = await client.search(request);
        try {
          return mapTavilyResults(payload);
        } catch (error) {
          throw createProviderError(
            ERROR_CODES.PROVIDER_TAVILY_RESPONSE_INVALID,
            "Tavily response missing required fields",
            {
              event_slug: input.event_slug,
              lane: input.lane,
              error: error instanceof Error ? error.message : String(error)
            }
          );
        }
      }
    );

    const latencyMs = Math.max(0, now() - startMs);
    return {
      lane: input.lane,
      query,
      results: value,
      cache_hit: cacheHit,
      rate_limited: cacheHit ? false : rateLimited,
      latency_ms: latencyMs
    };
  }

  return {
    searchLane: async (input) => {
      try {
        return await searchLane(input);
      } catch (error) {
        if (error instanceof TavilyRequestError) {
          const category = error.status === 429 ? "RATE_LIMIT" : "PROVIDER";
          throw createProviderError(
            ERROR_CODES.PROVIDER_TAVILY_REQUEST_FAILED,
            error.message,
            {
              status: error.status,
              event_slug: input.event_slug,
              lane: input.lane
            },
            error.retryable,
            category
          );
        }
        throw error;
      }
    }
  };
}
