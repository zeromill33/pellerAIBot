import { createHash } from "node:crypto";

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export type TavilyCacheResult<T> = {
  value: T;
  cacheHit: boolean;
};

export class TavilyCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  async getOrSet<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>
  ): Promise<TavilyCacheResult<T>> {
    const cached = this.entries.get(key);
    const now = this.now();
    if (cached && cached.expiresAt > now) {
      return { value: cached.value as T, cacheHit: true };
    }

    const inflight = this.inflight.get(key);
    if (inflight) {
      return { value: (await inflight) as T, cacheHit: true };
    }

    const promise = (async () => {
      const value = await loader();
      this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
      return value;
    })();

    this.inflight.set(key, promise);
    try {
      return { value: (await promise) as T, cacheHit: false };
    } finally {
      this.inflight.delete(key);
    }
  }
}

export type TavilyCacheKeyInput = {
  event_slug: string;
  lane: string;
  query: string;
  now: number;
};

export function buildTavilyCacheKey(input: TavilyCacheKeyInput): string {
  const day = new Date(input.now).toISOString().slice(0, 10);
  return [
    "tavily",
    input.event_slug,
    day,
    input.lane,
    hashQuery(input.query)
  ].join(":");
}

export function hashQuery(query: string): string {
  return createHash("sha256").update(query.trim()).digest("hex").slice(0, 16);
}
