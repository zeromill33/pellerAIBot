import { createAppError, ERROR_CODES } from "../../orchestrator/errors.js";
import type { PricePoint } from "../../orchestrator/types.js";

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  headers: {
    get(name: string): string | null;
  };
};

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponse>;

type PricingProviderOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  retries?: number;
  retryBaseDelayMs?: number;
  cacheTtlPriceMs?: number;
  cacheTtlMidpointMs?: number;
  cacheTtlHistoryMs?: number;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type PriceHistoryOptions = {
  windowHours?: number;
  intervalHours?: number;
};

type PricingProvider = {
  getMarketPrice(tokenId: string): Promise<number | null>;
  getMidpointPrice(tokenId: string): Promise<number | null>;
  getPriceHistory(tokenId: string, options?: PriceHistoryOptions): Promise<PricePoint[]>;
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
  cacheTtlPriceMs: 30_000,
  cacheTtlMidpointMs: 30_000,
  cacheTtlHistoryMs: 10 * 60 * 1000
};

const DEFAULT_HISTORY_WINDOW_HOURS = 24;
const DEFAULT_HISTORY_INTERVAL_HOURS = 1;

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

function buildPricingUrl(baseUrl: string, path: string, query: Record<string, string>) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function toNumber(value: unknown): number | null {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractNumericField(payload: unknown, keys: string[]): number | null {
  const direct = toNumber(payload);
  if (direct !== null) {
    return direct;
  }
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const parsed = toNumber(record[key]);
    if (parsed !== null) {
      return parsed;
    }
  }
  const nested = asRecord(record.data) ?? asRecord(record.result);
  if (nested) {
    for (const key of keys) {
      const parsed = toNumber(nested[key]);
      if (parsed !== null) {
        return parsed;
      }
    }
  }
  return null;
}

function extractArray(payload: unknown, keys: string[]): unknown[] | null {
  if (Array.isArray(payload)) {
    return payload;
  }
  const record = asRecord(payload);
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  const nested = asRecord(record.data) ?? asRecord(record.result);
  if (nested) {
    for (const key of keys) {
      const value = nested[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
  }
  return null;
}

function parseHistoryEntry(entry: unknown): PricePoint | null {
  if (Array.isArray(entry) && entry.length >= 2) {
    const ts = toNumber(entry[0]);
    const price = toNumber(entry[1]);
    if (ts !== null && price !== null) {
      return { ts, price };
    }
    return null;
  }
  const record = asRecord(entry);
  if (!record) {
    return null;
  }
  const ts =
    toNumber(record.ts) ??
    toNumber(record.timestamp) ??
    toNumber(record.time) ??
    toNumber(record.t) ??
    toNumber(record.created_at) ??
    toNumber(record.createdAt);
  const price =
    toNumber(record.price) ??
    toNumber(record.value) ??
    toNumber(record.close) ??
    toNumber(record.p) ??
    toNumber(record.market_price);
  if (ts === null || price === null) {
    return null;
  }
  return { ts, price };
}

function normalizeHistory(points: PricePoint[]): PricePoint[] {
  if (points.length === 0) {
    return [];
  }
  const sorted = points
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .filter((point, index, arr) => index === 0 || point.ts !== arr[index - 1]!.ts);
  return sorted;
}

function resampleHistory(
  points: PricePoint[],
  intervalHours: number
): { points: PricePoint[]; resampled: boolean } {
  if (points.length === 0 || intervalHours <= 0) {
    return { points, resampled: false };
  }
  const maxTs = points.reduce((max, point) => Math.max(max, point.ts), points[0]!.ts);
  const scale = maxTs > 1_000_000_000_000 ? 1 : 1000;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const buckets = new Map<number, { tsMs: number; price: number }>();

  for (const point of points) {
    const tsMs = point.ts * scale;
    const bucket = Math.floor(tsMs / intervalMs);
    const existing = buckets.get(bucket);
    if (!existing || tsMs >= existing.tsMs) {
      buckets.set(bucket, { tsMs, price: point.price });
    }
  }

  const resampledPoints = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([, value]) => ({
      ts: Math.round(value.tsMs / scale),
      price: value.price
    }));

  const resampled = resampledPoints.length !== points.length;
  return { points: resampledPoints, resampled };
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
        message: `Pricing API timed out after ${timeoutMs}ms`,
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
      PricingProviderOptions,
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
          message: `Pricing API responded with ${response.status}`,
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
      PricingProviderOptions,
      "timeoutMs" | "retries" | "retryBaseDelayMs" | "fetch" | "now" | "sleep"
    >
  >
): Promise<unknown> {
  try {
    return await fetchJsonWithRetry(url, config);
  } catch (error) {
    if (error instanceof RequestError) {
      throw createAppError({
        code: ERROR_CODES.PROVIDER_PM_PRICING_REQUEST_FAILED,
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
      code: ERROR_CODES.PROVIDER_PM_PRICING_REQUEST_FAILED,
      message: error instanceof Error ? error.message : "Pricing request failed",
      category: "PROVIDER",
      retryable: false,
      details: { url }
    });
  }
}

export function createPricingProvider(
  options: PricingProviderOptions = {}
): PricingProvider {
  const config = {
    baseUrl: options.baseUrl ?? DEFAULT_OPTIONS.baseUrl,
    timeoutMs: options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs,
    retries: options.retries ?? DEFAULT_OPTIONS.retries,
    retryBaseDelayMs:
      options.retryBaseDelayMs ?? DEFAULT_OPTIONS.retryBaseDelayMs,
    cacheTtlPriceMs: options.cacheTtlPriceMs ?? DEFAULT_OPTIONS.cacheTtlPriceMs,
    cacheTtlMidpointMs:
      options.cacheTtlMidpointMs ?? DEFAULT_OPTIONS.cacheTtlMidpointMs,
    cacheTtlHistoryMs:
      options.cacheTtlHistoryMs ?? DEFAULT_OPTIONS.cacheTtlHistoryMs,
    fetch: options.fetch ?? (globalThis.fetch as FetchLike),
    now: options.now ?? (() => Date.now()),
    sleep: options.sleep ?? defaultSleep
  };

  const cache = new InMemoryCache(config.now);

  async function getMarketPrice(tokenId: string): Promise<number | null> {
    if (!tokenId || tokenId.trim().length === 0) {
      throw createProviderError(
        ERROR_CODES.PROVIDER_PM_PRICING_TOKEN_INVALID,
        "Pricing token_id is required",
        { tokenId }
      );
    }

    const cacheKey = `pm:price:${tokenId}`;
    return await cache.getOrSet(cacheKey, config.cacheTtlPriceMs, async () => {
      const url = buildPricingUrl(config.baseUrl, "/prices", {
        token_id: tokenId
      });
      const payload = await safeFetchJson(url, config);
      const price = extractNumericField(payload, [
        "price",
        "marketPrice",
        "market_price",
        "lastTradePrice",
        "last_trade_price"
      ]);
      if (price === null) {
        throw createProviderError(
          ERROR_CODES.PROVIDER_PM_PRICING_PRICE_INVALID,
          "Pricing market price payload missing required fields",
          { tokenId }
        );
      }
      return price;
    });
  }

  async function getMidpointPrice(tokenId: string): Promise<number | null> {
    if (!tokenId || tokenId.trim().length === 0) {
      throw createProviderError(
        ERROR_CODES.PROVIDER_PM_PRICING_TOKEN_INVALID,
        "Pricing token_id is required",
        { tokenId }
      );
    }

    const cacheKey = `pm:midpoint:${tokenId}`;
    return await cache.getOrSet(cacheKey, config.cacheTtlMidpointMs, async () => {
      const url = buildPricingUrl(config.baseUrl, "/midpoint", {
        token_id: tokenId
      });
      const payload = await safeFetchJson(url, config);
      const midpoint = extractNumericField(payload, [
        "midpoint",
        "midpointPrice",
        "midpoint_price",
        "mid"
      ]);
      if (midpoint === null) {
        throw createProviderError(
          ERROR_CODES.PROVIDER_PM_PRICING_MIDPOINT_INVALID,
          "Pricing midpoint payload missing required fields",
          { tokenId }
        );
      }
      return midpoint;
    });
  }

  async function getPriceHistory(
    tokenId: string,
    options?: PriceHistoryOptions
  ): Promise<PricePoint[]> {
    if (!tokenId || tokenId.trim().length === 0) {
      throw createProviderError(
        ERROR_CODES.PROVIDER_PM_PRICING_TOKEN_INVALID,
        "Pricing token_id is required",
        { tokenId }
      );
    }

    const windowHours = options?.windowHours ?? DEFAULT_HISTORY_WINDOW_HOURS;
    const intervalHours =
      options?.intervalHours ?? DEFAULT_HISTORY_INTERVAL_HOURS;
    const cacheKey = `pm:price_history:${tokenId}:${windowHours}:${intervalHours}`;

    return await cache.getOrSet(cacheKey, config.cacheTtlHistoryMs, async () => {
      const url = buildPricingUrl(config.baseUrl, "/prices-history", {
        token_id: tokenId,
        window: `${windowHours}h`,
        interval: `${intervalHours}h`
      });
      const payload = await safeFetchJson(url, config);
      const rawHistory = extractArray(payload, [
        "history",
        "prices",
        "data",
        "points",
        "price_history"
      ]);
      if (!rawHistory) {
        throw createProviderError(
          ERROR_CODES.PROVIDER_PM_PRICING_HISTORY_INVALID,
          "Pricing history payload missing required fields",
          { tokenId }
        );
      }
      const parsed = rawHistory
        .map((entry) => parseHistoryEntry(entry))
        .filter((entry): entry is PricePoint => entry !== null);
      const normalized = normalizeHistory(parsed);
      const { points } = resampleHistory(normalized, intervalHours);
      return points;
    });
  }

  return {
    getMarketPrice,
    getMidpointPrice,
    getPriceHistory
  };
}

export type { PricingProviderOptions, PricingProvider, PriceHistoryOptions };
