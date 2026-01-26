import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTavilyProvider } from "../../../src/providers/tavily/index.js";
import { ERROR_CODES } from "../../../src/orchestrator/errors.js";

type MockResponseOptions = {
  status: number;
  payload: unknown;
  headers?: Record<string, string>;
};

function createMockResponse(options: MockResponseOptions) {
  const headers = new Map(
    Object.entries(options.headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value
    ])
  );
  return {
    ok: options.status >= 200 && options.status < 300,
    status: options.status,
    json: async () => options.payload,
    headers: {
      get(name: string) {
        return headers.get(name.toLowerCase()) ?? null;
      }
    }
  };
}

const fixture = JSON.parse(
  readFileSync(new URL("../../fixtures/tavily/lane-a.json", import.meta.url), "utf-8")
) as unknown;

describe("createTavilyProvider", () => {
  it("maps tavily results and preserves raw_content", async () => {
    const fetch = async () => createMockResponse({ status: 200, payload: fixture });
    const provider = createTavilyProvider({
      config: { api_key: "test_key", rate_limit: { qps: 10, burst: 10 } },
      fetch,
      now: () => 0,
      sleep: async () => {}
    });

    const result = await provider.searchLane({
      event_slug: "event-1",
      lane: "A",
      query: "test query"
    });

    expect(result.cache_hit).toBe(false);
    expect(result.rate_limited).toBe(false);
    expect(result.results).toHaveLength(2);
    expect(result.results[0]?.domain).toBe("example.com");
    expect(result.results[0]?.raw_content).toBe("Raw content A");
    expect(result.results[1]?.raw_content).toBe("Fallback content");
  });

  it("returns cache hit for repeated queries", async () => {
    let calls = 0;
    const fetch = async () => {
      calls += 1;
      return createMockResponse({ status: 200, payload: fixture });
    };
    const provider = createTavilyProvider({
      config: { api_key: "test_key", rate_limit: { qps: 10, burst: 10 } },
      fetch,
      now: () => 0,
      sleep: async () => {}
    });

    const first = await provider.searchLane({
      event_slug: "event-2",
      lane: "A",
      query: "cached query"
    });
    const second = await provider.searchLane({
      event_slug: "event-2",
      lane: "A",
      query: "cached query"
    });

    expect(calls).toBe(1);
    expect(first.cache_hit).toBe(false);
    expect(second.cache_hit).toBe(true);
  });

  it("waits when rate limit is exceeded", async () => {
    let current = 0;
    const waits: number[] = [];
    const fetch = async () => createMockResponse({ status: 200, payload: fixture });
    const provider = createTavilyProvider({
      config: { api_key: "test_key", rate_limit: { qps: 1, burst: 1 } },
      fetch,
      now: () => current,
      sleep: async (ms) => {
        waits.push(ms);
        current += ms;
      }
    });

    const first = await provider.searchLane({
      event_slug: "event-3",
      lane: "A",
      query: "first"
    });
    const second = await provider.searchLane({
      event_slug: "event-3",
      lane: "A",
      query: "second"
    });

    expect(first.rate_limited).toBe(false);
    expect(second.rate_limited).toBe(true);
    expect(waits[0]).toBe(1000);
  });

  it("marks 429 responses as retryable rate-limit errors", async () => {
    const fetch = async () =>
      createMockResponse({
        status: 429,
        payload: { message: "rate limited" },
        headers: { "retry-after": "1" }
      });
    const provider = createTavilyProvider({
      config: { api_key: "test_key", rate_limit: { qps: 10, burst: 10 } },
      fetch,
      retries: 0,
      now: () => 0,
      sleep: async () => {}
    });

    await expect(
      provider.searchLane({
        event_slug: "event-4",
        lane: "A",
        query: "rate limit"
      })
    ).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_TAVILY_REQUEST_FAILED,
      retryable: true,
      category: "RATE_LIMIT"
    });
  });

  it("marks 5xx responses as retryable provider errors", async () => {
    const fetch = async () =>
      createMockResponse({
        status: 500,
        payload: { message: "server error" }
      });
    const provider = createTavilyProvider({
      config: { api_key: "test_key", rate_limit: { qps: 10, burst: 10 } },
      fetch,
      retries: 0,
      now: () => 0,
      sleep: async () => {}
    });

    await expect(
      provider.searchLane({
        event_slug: "event-5",
        lane: "A",
        query: "server error"
      })
    ).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_TAVILY_REQUEST_FAILED,
      retryable: true,
      category: "PROVIDER"
    });
  });

  it("marks timeouts as retryable provider errors", async () => {
    const fetch = async () => {
      const error = new Error("timeout");
      error.name = "AbortError";
      throw error;
    };
    const provider = createTavilyProvider({
      config: { api_key: "test_key", rate_limit: { qps: 10, burst: 10 } },
      fetch,
      retries: 0,
      now: () => 0,
      sleep: async () => {}
    });

    await expect(
      provider.searchLane({
        event_slug: "event-6",
        lane: "A",
        query: "timeout"
      })
    ).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_TAVILY_REQUEST_FAILED,
      retryable: true
    });
  });
});
