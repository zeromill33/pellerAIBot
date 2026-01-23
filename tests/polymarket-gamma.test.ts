import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createGammaProvider } from "../src/providers/polymarket/gamma.js";
import { ERROR_CODES } from "../src/orchestrator/errors.js";

type MockResponse = {
  status: number;
  json: unknown;
  headers?: Record<string, string>;
};

type ResponseLike = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  headers: {
    get(name: string): string | null;
  };
};

type FetchLike = (input: string, init?: RequestInit) => Promise<ResponseLike>;

function loadFixture(name: string) {
  const url = new URL(`./fixtures/polymarket/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8"));
}

function createFetchMock(responses: MockResponse[]) {
  const calls: string[] = [];
  const fetchMock: FetchLike = async (input) => {
    const response = responses.shift();
    if (!response) {
      throw new Error("No mock response available");
    }
    calls.push(input);
    const headers = new Map<string, string>();
    for (const [key, value] of Object.entries(response.headers ?? {})) {
      headers.set(key.toLowerCase(), value);
    }
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.json,
      headers: {
        get: (name: string) => headers.get(name.toLowerCase()) ?? null
      }
    };
  };
  return { fetchMock, calls };
}

describe("Polymarket Gamma provider", () => {
  it("maps event and primary market into MarketContext", async () => {
    const events = loadFixture("events.json");
    const markets = loadFixture("markets.json");
    const { fetchMock } = createFetchMock([
      { status: 200, json: events },
      { status: 200, json: markets }
    ]);

    const provider = createGammaProvider({
      fetch: fetchMock,
      retries: 0,
      sleep: async () => {}
    });

    const result = await provider.getEventBySlug(
      "who-will-trump-nominate-as-fed-chair"
    );

    expect(result.event_id).toBe("event_123");
    expect(result.slug).toBe("who-will-trump-nominate-as-fed-chair");
    expect(result.title).toBe("Who will Trump nominate as Fed Chair?");
    expect(result.outcomePrices).toEqual([0.6, 0.4]);
    expect(result.clobTokenIds).toEqual(["token_yes", "token_no"]);
    expect(result.primary_market_id).toBe("market_456");
    expect(result.markets).toHaveLength(1);
  });

  it("retries on 429 and surfaces provider error", async () => {
    const { fetchMock, calls } = createFetchMock([
      { status: 429, json: { message: "rate limited" }, headers: { "retry-after": "0" } },
      { status: 429, json: { message: "rate limited" }, headers: { "retry-after": "0" } },
      { status: 429, json: { message: "rate limited" }, headers: { "retry-after": "0" } }
    ]);

    const provider = createGammaProvider({
      fetch: fetchMock,
      retries: 2,
      retryBaseDelayMs: 1,
      sleep: async () => {}
    });

    await expect(provider.getEventBySlug("rate-limited-slug")).rejects.toMatchObject(
      {
        code: ERROR_CODES.PROVIDER_PM_GAMMA_REQUEST_FAILED
      }
    );
    expect(calls).toHaveLength(3);
  });

  it("fails fast when required market fields are missing", async () => {
    const events = loadFixture("events.json");
    const markets = loadFixture("markets.missing-fields.json");
    const { fetchMock } = createFetchMock([
      { status: 200, json: events },
      { status: 200, json: markets }
    ]);

    const provider = createGammaProvider({
      fetch: fetchMock,
      retries: 0,
      sleep: async () => {}
    });

    await expect(
      provider.getEventBySlug("who-will-trump-nominate-as-fed-chair")
    ).rejects.toMatchObject({
      code: ERROR_CODES.PROVIDER_PM_GAMMA_MARKET_INVALID
    });
  });

  it("accepts stringified arrays from Gamma", async () => {
    const events = loadFixture("events.json");
    const markets = loadFixture("markets.string-fields.json");
    const { fetchMock } = createFetchMock([
      { status: 200, json: events },
      { status: 200, json: markets }
    ]);

    const provider = createGammaProvider({
      fetch: fetchMock,
      retries: 0,
      sleep: async () => {}
    });

    const result = await provider.getEventBySlug(
      "who-will-trump-nominate-as-fed-chair"
    );

    expect(result.outcomePrices).toEqual([0.6, 0.4]);
    expect(result.clobTokenIds).toEqual(["token_yes", "token_no"]);
  });

  it("replays real Gamma fixtures offline", async () => {
    const events = loadFixture("real-events.json");
    const markets = loadFixture("real-markets.json");
    const { fetchMock } = createFetchMock([
      { status: 200, json: events },
      { status: 200, json: markets }
    ]);

    const provider = createGammaProvider({
      fetch: fetchMock,
      retries: 0,
      sleep: async () => {}
    });

    const result = await provider.getEventBySlug(
      "who-will-trump-nominate-as-fed-chair"
    );

    expect(result.slug).toBe("who-will-trump-nominate-as-fed-chair");
    expect(result.markets.length).toBeGreaterThan(0);
    expect(result.outcomePrices?.length ?? 0).toBeGreaterThan(0);
    expect(result.clobTokenIds?.length ?? 0).toBeGreaterThan(0);
  });
});
