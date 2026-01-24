import type { MarketContext } from "../types.js";
import type { GammaProvider } from "../../providers/polymarket/gamma.js";
import { createGammaProvider } from "../../providers/polymarket/gamma.js";

type MarketFetchInput = {
  event_slug: string;
  preferred_market_id?: string;
};

type MarketFetchOutput = {
  market_context: MarketContext;
};

type MarketFetchProvider = Pick<GammaProvider, "getEventBySlug">;

type MarketFetchOptions = {
  provider?: MarketFetchProvider;
};

export async function fetchMarketContext(
  input: MarketFetchInput,
  options: MarketFetchOptions = {}
): Promise<MarketFetchOutput> {
  const provider = options.provider ?? createGammaProvider();
  const marketContext = await provider.getEventBySlug(input.event_slug, {
    preferredMarketId: input.preferred_market_id
  });

  return { market_context: marketContext };
}

export type { MarketFetchInput, MarketFetchOutput, MarketFetchOptions };
