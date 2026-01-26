import type { TavilySearchDepth } from "../../config/config.schema.js";

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  headers: {
    get(name: string): string | null;
  };
};

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponse>;

export type TavilySearchRequest = {
  query: string;
  search_depth: TavilySearchDepth;
  max_results: number;
  include_raw_content: boolean;
  include_answer: boolean;
  auto_parameters: boolean;
  time_range: string;
  include_domains?: string[];
  exclude_domains?: string[];
};

export type TavilySearchResponse = {
  results?: unknown[];
  answer?: string;
};

export type TavilyClientOptions = {
  baseUrl?: string;
  apiKey: string;
  timeoutMs?: number;
  retries?: number;
  retryBaseDelayMs?: number;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type RequestErrorOptions = {
  message: string;
  retryable: boolean;
  status?: number;
  response?: FetchResponse;
};

export class TavilyRequestError extends Error {
  readonly retryable: boolean;
  readonly status?: number;
  readonly response?: FetchResponse;

  constructor(options: RequestErrorOptions) {
    super(options.message);
    this.name = "TavilyRequestError";
    this.retryable = options.retryable;
    this.status = options.status;
    this.response = options.response;
  }
}

const DEFAULT_OPTIONS = {
  baseUrl: "https://api.tavily.com",
  timeoutMs: 15000,
  retries: 2,
  retryBaseDelayMs: 400
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function computeRetryDelayMs(
  attempt: number,
  baseDelayMs: number,
  error: unknown,
  now: () => number
): number {
  if (error instanceof TavilyRequestError) {
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
  timeoutMs: number,
  body: TavilySearchRequest,
  apiKey: string
): Promise<FetchResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new TavilyRequestError({
        message: `Tavily API timed out after ${timeoutMs}ms`,
        retryable: true
      });
    }
    if (error instanceof Error) {
      throw new TavilyRequestError({
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
  body: TavilySearchRequest,
  options: Required<
    Pick<
      TavilyClientOptions,
      "timeoutMs" | "retries" | "retryBaseDelayMs" | "fetch" | "now" | "sleep" | "apiKey"
    >
  >
): Promise<unknown> {
  const { timeoutMs, retries, retryBaseDelayMs, fetch, now, sleep, apiKey } = options;
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= retries) {
    try {
      const response = await fetchWithTimeout(url, fetch, timeoutMs, body, apiKey);
      if (!response.ok) {
        const retryable = isRetryableStatus(response.status);
        throw new TavilyRequestError({
          message: `Tavily API responded with ${response.status}`,
          retryable,
          status: response.status,
          response
        });
      }
      try {
        return await response.json();
      } catch (error) {
        throw new TavilyRequestError({
          message: "Tavily API returned invalid JSON",
          retryable: false,
          status: response.status,
          response
        });
      }
    } catch (error) {
      lastError = error;
      const retryable = error instanceof TavilyRequestError ? error.retryable : false;
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

export function createTavilyClient(
  options: TavilyClientOptions
): { search: (request: TavilySearchRequest) => Promise<TavilySearchResponse> } {
  const config = {
    baseUrl: options.baseUrl ?? DEFAULT_OPTIONS.baseUrl,
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs,
    retries: options.retries ?? DEFAULT_OPTIONS.retries,
    retryBaseDelayMs:
      options.retryBaseDelayMs ?? DEFAULT_OPTIONS.retryBaseDelayMs,
    fetch: options.fetch ?? (globalThis.fetch as FetchLike),
    now: options.now ?? (() => Date.now()),
    sleep: options.sleep ?? defaultSleep
  };

  async function search(request: TavilySearchRequest): Promise<TavilySearchResponse> {
    const trimmedQuery = request.query.trim();
    if (!trimmedQuery) {
      throw new TavilyRequestError({
        message: "Tavily query is required",
        retryable: false
      });
    }
    const url = new URL("/search", config.baseUrl).toString();
    const payload = await fetchJsonWithRetry(url, request, config);
    return payload as TavilySearchResponse;
  }

  return { search };
}
