import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createClobProvider } from "../../../src/providers/polymarket/clob.js";
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
  readFileSync(new URL("../../fixtures/polymarket_clob_book.json", import.meta.url), "utf-8")
) as unknown;

describe("createClobProvider", () => {
  it("maps order book data into ClobSnapshot", async () => {
    const fetch = async () => createMockResponse({ status: 200, payload: fixture });
    const provider = createClobProvider({
      fetch,
      topLevels: 3,
      wallMultiple: 5
    });

    const snapshot = await provider.getOrderBookSummary("token-yes");

    expect(snapshot.spread).toBeCloseTo(0.01, 5);
    expect(snapshot.midpoint).toBeCloseTo(0.555, 5);
    expect(snapshot.book_top_levels).toEqual([
      { side: "bid", price: 0.55, size: 1000 },
      { side: "bid", price: 0.54, size: 1 },
      { side: "bid", price: 0.53, size: 1 },
      { side: "ask", price: 0.56, size: 1 },
      { side: "ask", price: 0.57, size: 1 },
      { side: "ask", price: 0.58, size: 1 }
    ]);
    expect(snapshot.notable_walls).toHaveLength(1);
    expect(snapshot.notable_walls[0].side).toBe("bid");
    expect(snapshot.notable_walls[0].price).toBe(0.55);
    expect(snapshot.notable_walls[0].size).toBe(1000);
    expect(snapshot.notable_walls[0].multiple).toBeGreaterThan(5);
  });

  it("retries on 429 responses using Retry-After", async () => {
    let calls = 0;
    const delays: number[] = [];
    const fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return createMockResponse({
          status: 429,
          payload: { message: "rate limited" },
          headers: { "retry-after": "1" }
        });
      }
      return createMockResponse({ status: 200, payload: fixture });
    };
    const provider = createClobProvider({
      fetch,
      retryBaseDelayMs: 0,
      sleep: async (ms) => {
        delays.push(ms);
      },
      now: () => 0
    });

    await provider.getOrderBookSummary("token-yes");

    expect(calls).toBe(2);
    expect(delays).toEqual([1000]);
  });

  it("returns empty snapshot when bids/asks are missing", async () => {
    const fetch = async () =>
      createMockResponse({
        status: 200,
        payload: { bids: [] }
      });
    const provider = createClobProvider({ fetch });

    const snapshot = await provider.getOrderBookSummary("token-yes");

    expect(snapshot.book_top_levels).toEqual([]);
    expect(snapshot.notable_walls).toEqual([]);
    expect(snapshot.spread).toBeNull();
    expect(snapshot.midpoint).toBeNull();
  });

  it("throws when order book levels are malformed", async () => {
    const fetch = async () =>
      createMockResponse({
        status: 200,
        payload: {
          bids: [{ price: "0.5" }],
          asks: [{ price: "0.6", size: "10" }]
        }
      });
    const provider = createClobProvider({ fetch });

    await expect(provider.getOrderBookSummary("token-yes")).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_PM_CLOB_BOOK_INVALID
    });
  });
});
