import { createAppError, ERROR_CODES } from "../../orchestrator/errors.js";
import type {
  ClobSnapshot,
  NotableWall,
  OrderBookLevel
} from "../../orchestrator/types.js";

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  headers: {
    get(name: string): string | null;
  };
};

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponse>;

type ClobProviderOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  retryBaseDelayMs?: number;
  cacheTtlMs?: number;
  topLevels?: number;
  wallMultiple?: number;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type ClobProvider = {
  getOrderBookSummary(tokenId: string): Promise<ClobSnapshot>;
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
  baseUrl: "https://clob.polymarket.com",
  timeoutMs: 15000,
  retries: 3,
  retryBaseDelayMs: 300,
  cacheTtlMs: 30_000,
  topLevels: 10,
  wallMultiple: 5
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

function buildClobUrl(baseUrl: string, path: string, query: Record<string, string>) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function extractArray(payload: unknown, key: string): unknown[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : null;
}

function parseOrderLevel(
  raw: unknown,
  side: OrderBookLevel["side"]
): OrderBookLevel {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid order level");
  }
  const record = raw as Record<string, unknown>;
  const price = toFiniteNumber(record.price);
  const size = toFiniteNumber(record.size);
  if (price === null || price < 0 || size === null || size <= 0) {
    throw new Error("Invalid order level fields");
  }
  return { side, price, size };
}

function toSortedLevels(
  rawLevels: unknown[],
  side: OrderBookLevel["side"],
  limit: number
): OrderBookLevel[] {
  const levels = rawLevels.map((level) => parseOrderLevel(level, side));
  const sorted = levels.sort((a, b) =>
    side === "bid" ? b.price - a.price : a.price - b.price
  );
  return sorted.slice(0, limit);
}

function computeNotableWalls(
  levels: OrderBookLevel[],
  multiple: number
): NotableWall[] {
  if (levels.length === 0) {
    return [];
  }
  const totalSize = levels.reduce((sum, level) => sum + level.size, 0);
  const meanSize = totalSize / levels.length;
  if (meanSize <= 0) {
    return [];
  }
  return levels
    .filter((level) => level.size > meanSize * multiple)
    .map((level) => ({
      ...level,
      multiple: level.size / meanSize
    }));
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
        message: `CLOB API timed out after ${timeoutMs}ms`,
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

async function fetchJsonWithRetry(
  url: string,
  options: Required<
    Pick<
      ClobProviderOptions,
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
          message: `CLOB API responded with ${response.status}`,
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

async function safeFetchJson(
  url: string,
  config: Required<
    Pick<
      ClobProviderOptions,
      "timeoutMs" | "retries" | "retryBaseDelayMs" | "fetch" | "now" | "sleep"
    >
  >
): Promise<unknown> {
  try {
    return await fetchJsonWithRetry(url, config);
  } catch (error) {
    if (error instanceof RequestError) {
      throw createAppError({
        code: ERROR_CODES.PROVIDER_PM_CLOB_REQUEST_FAILED,
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
      code: ERROR_CODES.PROVIDER_PM_CLOB_REQUEST_FAILED,
      message: error instanceof Error ? error.message : "CLOB request failed",
      category: "PROVIDER",
      retryable: false,
      details: { url }
    });
  }
}

export function createClobProvider(
  options: ClobProviderOptions = {}
): ClobProvider {
  const config = {
    baseUrl: options.baseUrl ?? DEFAULT_OPTIONS.baseUrl,
    timeoutMs: options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs,
    retries: options.retries ?? DEFAULT_OPTIONS.retries,
    retryBaseDelayMs:
      options.retryBaseDelayMs ?? DEFAULT_OPTIONS.retryBaseDelayMs,
    cacheTtlMs: options.cacheTtlMs ?? DEFAULT_OPTIONS.cacheTtlMs,
    topLevels: options.topLevels ?? DEFAULT_OPTIONS.topLevels,
    wallMultiple: options.wallMultiple ?? DEFAULT_OPTIONS.wallMultiple,
    fetch: options.fetch ?? (globalThis.fetch as FetchLike),
    now: options.now ?? (() => Date.now()),
    sleep: options.sleep ?? defaultSleep
  };

  const cache = new InMemoryCache(config.now);

  async function getOrderBookSummary(tokenId: string): Promise<ClobSnapshot> {
    if (!tokenId || tokenId.trim().length === 0) {
      throw createProviderError(
        ERROR_CODES.PROVIDER_PM_CLOB_TOKEN_INVALID,
        "CLOB token_id is required",
        { tokenId }
      );
    }

    const cacheKey = `pm:book:${tokenId}`;
    return await cache.getOrSet(cacheKey, config.cacheTtlMs, async () => {
      const url = buildClobUrl(config.baseUrl, "/book", {
        token_id: tokenId
      });
      const payload = await safeFetchJson(url, config);
      const bidsRaw = extractArray(payload, "bids");
      const asksRaw = extractArray(payload, "asks");

      if (!bidsRaw || !asksRaw) {
        return {
          spread: null,
          midpoint: null,
          book_top_levels: [],
          notable_walls: []
        };
      }

      let bids: OrderBookLevel[] = [];
      let asks: OrderBookLevel[] = [];
      try {
        if (bidsRaw.length > 0) {
          bids = toSortedLevels(bidsRaw, "bid", config.topLevels);
        }
        if (asksRaw.length > 0) {
          asks = toSortedLevels(asksRaw, "ask", config.topLevels);
        }
      } catch (error) {
        throw createProviderError(
          ERROR_CODES.PROVIDER_PM_CLOB_BOOK_INVALID,
          "CLOB order book payload missing required fields",
          { tokenId, error: error instanceof Error ? error.message : String(error) }
        );
      }

      if (bids.length === 0 && asks.length === 0) {
        return {
          spread: null,
          midpoint: null,
          book_top_levels: [],
          notable_walls: []
        };
      }

      let spread: number | null = null;
      let midpoint: number | null = null;
      if (bids.length > 0 && asks.length > 0) {
        const [bestBidLevel] = bids;
        const [bestAskLevel] = asks;
        if (bestBidLevel && bestAskLevel) {
          const bestBid = bestBidLevel.price;
          const bestAsk = bestAskLevel.price;
          spread = bestAsk - bestBid;
          midpoint = (bestAsk + bestBid) / 2;
        }
      }

      const bookTopLevels = [...bids, ...asks];
      const notableWalls = computeNotableWalls(bookTopLevels, config.wallMultiple);

      return {
        spread,
        midpoint,
        book_top_levels: bookTopLevels,
        notable_walls: notableWalls
      };
    });
  }

  return {
    getOrderBookSummary
  };
}

export type { ClobProviderOptions, ClobProvider };
