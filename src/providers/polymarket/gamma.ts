import { createAppError, ERROR_CODES } from "../../orchestrator/errors.js";
import type { GammaMarket, MarketContext } from "../../orchestrator/types.js";

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  headers: {
    get(name: string): string | null;
  };
};

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponse>;

type GammaProviderOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  retryBaseDelayMs?: number;
  cacheTtlEventMs?: number;
  cacheTtlMarketsMs?: number;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type ListMarketsResult = {
  markets: GammaMarket[];
  primaryMarket: GammaMarket;
};

type MarketSelectionOptions = {
  preferredMarketId?: string;
};

type GammaProvider = {
  getEventBySlug(
    slug: string,
    options?: MarketSelectionOptions
  ): Promise<MarketContext>;
  listMarketsByEvent(
    eventId: string,
    options?: MarketSelectionOptions
  ): Promise<ListMarketsResult>;
};

type RequestErrorOptions = {
  message: string;
  retryable: boolean;
  status?: number;
  response?: FetchResponse;
};

class RequestError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly response?: FetchResponse;

  constructor(options: RequestErrorOptions) {
    super(options.message);
    this.name = "RequestError";
    this.retryable = options.retryable;
    this.status = options.status;
    this.response = options.response;
  }
}

const DEFAULT_OPTIONS = {
  baseUrl: "https://gamma-api.polymarket.com",
  timeoutMs: 15000,
  retries: 3,
  retryBaseDelayMs: 300,
  cacheTtlEventMs: 6 * 60 * 60 * 1000,
  cacheTtlMarketsMs: 10 * 60 * 1000
};

class InMemoryCache {
  private readonly entries = new Map<string, { expiresAt: number; value: unknown }>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  async getOrSet<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>
  ): Promise<T> {
    const cached = this.entries.get(key);
    const now = this.now();
    if (cached && cached.expiresAt > now) {
      return cached.value as T;
    }

    const inflight = this.inflight.get(key);
    if (inflight) {
      return (await inflight) as T;
    }

    const promise = (async () => {
      const value = await loader();
      this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
      return value;
    })();

    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }
}

function coerceArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function toStringArray(value: unknown): string[] | null {
  const array = coerceArray(value);
  if (!array) {
    return null;
  }
  const items = array
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : null;
}

function toNumberArray(value: unknown): number[] | null {
  const array = coerceArray(value);
  if (!array) {
    return null;
  }
  const items = array
    .map((item) => {
      if (typeof item === "number" && Number.isFinite(item)) {
        return item;
      }
      if (typeof item === "string" && item.trim() !== "") {
        const parsed = Number(item);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    })
    .filter((item): item is number => item !== null);
  return items.length > 0 ? items : null;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function extractArray(payload: unknown, keys: string[]): unknown[] | null {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }
  for (const key of keys) {
    const value = (payload as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function parseRetryAfterMs(
  value: string | null,
  now: () => number
): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - now());
  }
  return null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGammaUrl(baseUrl: string, path: string, query: Record<string, string>) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function fetchJsonWithRetry(
  url: string,
  options: Required<
    Pick<
      GammaProviderOptions,
      "timeoutMs" | "retries" | "retryBaseDelayMs" | "fetch" | "now" | "sleep"
    >
  >
): Promise<unknown> {
  const { timeoutMs, retries, retryBaseDelayMs, fetch, now, sleep } = options;
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      const response = await fetchWithTimeout(url, fetch, timeoutMs);
      if (!response.ok) {
        const retryable = isRetryableStatus(response.status);
        throw new RequestError({
          message: `Gamma API responded with ${response.status}`,
          retryable,
          status: response.status,
          response
        });
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      if (!retryable || attempt >= retries) {
        break;
      }
      const delayMs = computeRetryDelayMs(
        attempt,
        retryBaseDelayMs,
        error,
        now
      );
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      attempt += 1;
    }
  }

  throw lastError;
}

async function fetchWithTimeout(
  url: string,
  fetch: FetchLike,
  timeoutMs: number
): Promise<FetchResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json"
      }
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new RequestError({
        message: `Gamma API timed out after ${timeoutMs}ms`,
        retryable: true
      });
    }
    if (error instanceof Error) {
      throw new RequestError({
        message: error.message,
        retryable: true
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof RequestError) {
    return error.retryable;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  return false;
}

function computeRetryDelayMs(
  attempt: number,
  baseDelayMs: number,
  error: unknown,
  now: () => number
): number {
  if (error instanceof RequestError) {
    const retryAfter = parseRetryAfterMs(
      error.response?.headers.get("retry-after") ?? null,
      now
    );
    if (retryAfter !== null) {
      return retryAfter;
    }
  }
  const jitter = Math.floor(Math.random() * baseDelayMs);
  return baseDelayMs * 2 ** attempt + jitter;
}

function mapGammaEvent(raw: unknown): {
  eventId: string;
  slug: string;
  title: string;
  description?: string;
  resolutionRules?: string;
  endTime?: string;
} {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid event payload");
  }
  const record = raw as Record<string, unknown>;
  const eventId =
    toOptionalString(record.id) || toOptionalString(record.event_id);
  const slug = toOptionalString(record.slug);
  const title = toOptionalString(record.title);
  if (!eventId || !slug || !title) {
    throw new Error("Missing required event fields");
  }
  const description =
    toOptionalString(record.description) ||
    toOptionalString(record.summary) ||
    toOptionalString(record.market_description);
  const resolutionRules =
    toOptionalString(record.resolution_rules) ||
    toOptionalString(record.resolutionRules) ||
    toOptionalString(record.resolution_rules_raw);
  const endTime =
    toOptionalString(record.end_time) ||
    toOptionalString(record.endDate) ||
    toOptionalString(record.end_date);

  return {
    eventId,
    slug,
    title,
    description,
    resolutionRules,
    endTime
  };
}

function mapGammaMarket(raw: unknown): GammaMarket {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid market payload");
  }
  const record = raw as Record<string, unknown>;
  const marketId =
    toOptionalString(record.id) || toOptionalString(record.market_id);
  const outcomes = toStringArray(record.outcomes);
  const outcomePrices =
    toNumberArray(record.outcomePrices) ||
    toNumberArray(record.outcome_prices);
  const clobTokenIds =
    toStringArray(record.clobTokenIds) ||
    toStringArray(record.clob_token_ids);
  if (!marketId || !outcomes || !outcomePrices || !clobTokenIds) {
    throw new Error("Missing required market fields");
  }
  if (outcomes.length !== outcomePrices.length) {
    throw new Error("Mismatched outcomes and outcomePrices");
  }
  if (clobTokenIds.length !== outcomes.length) {
    throw new Error("Mismatched outcomes and clobTokenIds");
  }

  return {
    market_id: marketId,
    question: toOptionalString(record.question),
    outcomes,
    outcomePrices,
    clobTokenIds,
    volume: toOptionalNumber(record.volume) ?? toOptionalNumber(record.volumeNum),
    liquidity: toOptionalNumber(record.liquidity)
  };
}

function selectPrimaryMarket(
  markets: GammaMarket[],
  options?: MarketSelectionOptions
): GammaMarket {
  if (markets.length === 0) {
    throw new Error("No markets available");
  }
  if (options?.preferredMarketId) {
    const match = markets.find(
      (market) => market.market_id === options.preferredMarketId
    );
    if (!match) {
      throw new Error("Preferred market not found");
    }
    return match;
  }
  return markets
    .slice()
    .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0]!;
}

function createProviderError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  retryable = false
) {
  return createAppError({
    code,
    message,
    category: "PROVIDER",
    retryable,
    details
  });
}

export function createGammaProvider(
  options: GammaProviderOptions = {}
): GammaProvider {
  const config = {
    baseUrl: options.baseUrl ?? DEFAULT_OPTIONS.baseUrl,
    timeoutMs: options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs,
    retries: options.retries ?? DEFAULT_OPTIONS.retries,
    retryBaseDelayMs:
      options.retryBaseDelayMs ?? DEFAULT_OPTIONS.retryBaseDelayMs,
    cacheTtlEventMs: options.cacheTtlEventMs ?? DEFAULT_OPTIONS.cacheTtlEventMs,
    cacheTtlMarketsMs:
      options.cacheTtlMarketsMs ?? DEFAULT_OPTIONS.cacheTtlMarketsMs,
    fetch: options.fetch ?? (globalThis.fetch as FetchLike),
    now: options.now ?? (() => Date.now()),
    sleep: options.sleep ?? defaultSleep
  };

  const cache = new InMemoryCache(config.now);

  async function getEventBySlug(
    slug: string,
    selection?: MarketSelectionOptions
  ): Promise<MarketContext> {
    if (!slug || slug.trim().length === 0) {
      throw createProviderError(
        ERROR_CODES.PROVIDER_PM_GAMMA_EVENT_INVALID,
        "Gamma event slug is required",
        { slug }
      );
    }

    const eventKey = `pm:event:${slug}`;
    const event = await cache.getOrSet(eventKey, config.cacheTtlEventMs, async () => {
      const url = buildGammaUrl(config.baseUrl, "/events", {
        slug,
        limit: "1"
      });
      const payload = await safeFetchJson(url, config);
      const events = extractArray(payload, ["data", "events"]);
      if (!events) {
        throw createProviderError(
          ERROR_CODES.PROVIDER_PM_GAMMA_EVENT_INVALID,
          "Gamma events payload invalid",
          { slug }
        );
      }
      if (events.length === 0) {
        throw createProviderError(
          ERROR_CODES.PROVIDER_PM_GAMMA_EVENT_NOT_FOUND,
          "Gamma event not found",
          { slug }
        );
      }
      if (events.length > 1) {
        throw createProviderError(
          ERROR_CODES.PROVIDER_PM_GAMMA_EVENT_NOT_UNIQUE,
          "Gamma event slug returned multiple events",
          { slug, count: events.length }
        );
      }
      try {
        return mapGammaEvent(events[0]);
      } catch (error) {
        throw createProviderError(
          ERROR_CODES.PROVIDER_PM_GAMMA_EVENT_INVALID,
          "Gamma event payload missing required fields",
          { slug, error: error instanceof Error ? error.message : String(error) }
        );
      }
    });

    const { markets, primaryMarket } = await listMarketsByEvent(
      event.eventId,
      selection
    );

    return {
      event_id: event.eventId,
      slug: event.slug,
      title: event.title,
      description: event.description,
      resolution_rules_raw: event.resolutionRules,
      end_time: event.endTime,
      markets,
      primary_market_id: primaryMarket.market_id,
      outcomePrices: primaryMarket.outcomePrices,
      clobTokenIds: primaryMarket.clobTokenIds
    };
  }

  async function listMarketsByEvent(
    eventId: string,
    selection?: MarketSelectionOptions
  ): Promise<ListMarketsResult> {
    if (!eventId || eventId.trim().length === 0) {
      throw createProviderError(
        ERROR_CODES.PROVIDER_PM_GAMMA_MARKETS_INVALID,
        "Gamma event_id is required",
        { eventId }
      );
    }

    const marketsKey = `pm:markets:${eventId}`;
    const markets = await cache.getOrSet(
      marketsKey,
      config.cacheTtlMarketsMs,
      async () => {
        const url = buildGammaUrl(config.baseUrl, "/markets", {
          event_id: eventId
        });
        const payload = await safeFetchJson(url, config);
        const rawMarkets = extractArray(payload, ["data", "markets"]);
        if (!rawMarkets) {
          throw createProviderError(
            ERROR_CODES.PROVIDER_PM_GAMMA_MARKETS_INVALID,
            "Gamma markets payload invalid",
            { eventId }
          );
        }
        if (rawMarkets.length === 0) {
          throw createProviderError(
            ERROR_CODES.PROVIDER_PM_GAMMA_MARKETS_EMPTY,
            "Gamma markets response empty",
            { eventId }
          );
        }
        try {
          return rawMarkets.map((market) => mapGammaMarket(market));
        } catch (error) {
          throw createProviderError(
            ERROR_CODES.PROVIDER_PM_GAMMA_MARKET_INVALID,
            "Gamma market payload missing required fields",
            {
              eventId,
              error: error instanceof Error ? error.message : String(error)
            }
          );
        }
      }
    );

    let primaryMarket: GammaMarket;
    try {
      primaryMarket = selectPrimaryMarket(markets, selection);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to select primary market";
      throw createProviderError(
        ERROR_CODES.PROVIDER_PM_GAMMA_MARKET_INVALID,
        message,
        {
          eventId,
          preferredMarketId: selection?.preferredMarketId
        }
      );
    }

    if (!primaryMarket.outcomePrices.length || !primaryMarket.clobTokenIds.length) {
      throw createProviderError(
        ERROR_CODES.PROVIDER_PM_GAMMA_MARKET_INVALID,
        "Gamma primary market missing required fields",
        { eventId, marketId: primaryMarket.market_id }
      );
    }

    return { markets, primaryMarket };
  }

  return {
    getEventBySlug,
    listMarketsByEvent
  };
}

async function safeFetchJson(
  url: string,
  config: Required<
    Pick<
      GammaProviderOptions,
      "timeoutMs" | "retries" | "retryBaseDelayMs" | "fetch" | "now" | "sleep"
    >
  >
): Promise<unknown> {
  try {
    return await fetchJsonWithRetry(url, config);
  } catch (error) {
    if (error instanceof RequestError) {
      throw createAppError({
        code: ERROR_CODES.PROVIDER_PM_GAMMA_REQUEST_FAILED,
        message: error.message,
        category: "PROVIDER",
        retryable: error.retryable,
        details: {
          status: error.status,
          url
        }
      });
    }
    throw createAppError({
      code: ERROR_CODES.PROVIDER_PM_GAMMA_REQUEST_FAILED,
      message: error instanceof Error ? error.message : "Gamma request failed",
      category: "PROVIDER",
      retryable: false,
      details: { url }
    });
  }
}

export type { GammaProviderOptions, GammaProvider, ListMarketsResult };
