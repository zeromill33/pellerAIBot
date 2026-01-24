import type {
  ClobSnapshot,
  GammaMarket,
  MarketContext,
  MarketSignal,
  PriceContext,
  PriceSignals
} from "../types.js";
import type { ClobProvider } from "../../providers/polymarket/clob.js";
import type { PricingProvider, PriceHistoryOptions } from "../../providers/polymarket/pricing.js";
import { createClobProvider } from "../../providers/polymarket/clob.js";
import { createPricingProvider } from "../../providers/polymarket/pricing.js";
import { buildPriceContext } from "./market.pricing.fetch.step.js";

type MarketSignalsInput = {
  market_context: MarketContext;
  top_markets?: number;
};

type MarketSignalsOutput = {
  market_context: MarketContext;
  market_signals: MarketSignal[];
};

type MarketSignalsOptions = PriceHistoryOptions & {
  clobProvider?: ClobProvider;
  pricingProvider?: PricingProvider;
  topMarkets?: number;
};

type MarketRank = {
  market: GammaMarket;
  score: number;
};

const DEFAULT_TOP_MARKETS = 10;

function scoreMarket(market: GammaMarket): number {
  if (typeof market.volume === "number") {
    return market.volume;
  }
  if (typeof market.liquidity === "number") {
    return market.liquidity;
  }
  return 0;
}

function prioritizeTokenIds(outcomes: string[] | undefined, tokenIds: string[]): string[] {
  if (!outcomes || outcomes.length !== tokenIds.length) {
    return tokenIds;
  }
  const yesIndex = outcomes.findIndex(
    (outcome) => outcome.trim().toLowerCase() === "yes"
  );
  if (yesIndex < 0 || !tokenIds[yesIndex]) {
    return tokenIds;
  }
  return [tokenIds[yesIndex]!, ...tokenIds.filter((_, index) => index !== yesIndex)];
}

function buildMarketOrder(context: MarketContext): GammaMarket[] {
  const markets = context.markets ?? [];
  if (markets.length === 0) {
    return [];
  }
  const primaryId = context.primary_market_id;
  const primary = primaryId
    ? markets.find((market) => market.market_id === primaryId)
    : null;
  const ranked: MarketRank[] = markets
    .filter((market) => market !== primary)
    .map((market) => ({ market, score: scoreMarket(market) }))
    .sort((a, b) => b.score - a.score);

  const ordered = primary ? [primary, ...ranked.map((item) => item.market)] : ranked.map((item) => item.market);
  return ordered;
}

function resolveTokenIds(
  market: GammaMarket,
  context: MarketContext
): string[] {
  if (
    context.primary_market_id &&
    market.market_id === context.primary_market_id &&
    context.clobTokenIds &&
    context.clobTokenIds.length > 0
  ) {
    return context.clobTokenIds;
  }
  return market.clobTokenIds ?? [];
}

function buildEmptyClobSnapshot(): ClobSnapshot {
  return {
    spread: null,
    midpoint: null,
    book_top_levels: [],
    notable_walls: []
  };
}

function buildEmptySignals(): PriceSignals {
  return {
    change_1h: null,
    change_4h: null,
    change_24h: null,
    volatility_24h: null,
    range_high_24h: null,
    range_low_24h: null,
    trend_slope_24h: null,
    spike_flag: null
  };
}

function buildPriceFailureContext(
  tokenId: string,
  error: unknown,
  fallbackMidpoint: number | null
): PriceContext {
  const warningDetail =
    fallbackMidpoint !== null
      ? "Pricing API failed; used clob midpoint fallback."
      : "Pricing API failed; no midpoint fallback available.";

  return {
    token_id: tokenId,
    latest_price: fallbackMidpoint,
    midpoint_price: fallbackMidpoint,
    history_24h: [],
    signals: buildEmptySignals(),
    history_warning: {
      code: "PRICE_API_FAILED",
      message:
        error instanceof Error
          ? `Pricing API failed: ${error.message}. ${warningDetail}`
          : `Pricing API failed. ${warningDetail}`
    }
  };
}

export async function fetchMarketSignals(
  input: MarketSignalsInput,
  options: MarketSignalsOptions = {}
): Promise<MarketSignalsOutput> {
  const topMarkets = options.topMarkets ?? input.top_markets ?? DEFAULT_TOP_MARKETS;
  const markets = buildMarketOrder(input.market_context).slice(0, topMarkets);
  const clobProvider = options.clobProvider ?? createClobProvider();
  const pricingProvider = options.pricingProvider ?? createPricingProvider();
  const historyOptions: PriceHistoryOptions = {
    windowHours: options.windowHours,
    intervalHours: options.intervalHours
  };

  const signals: MarketSignal[] = [];
  let lastError: unknown;

  for (const market of markets) {
    const tokenIds = prioritizeTokenIds(
      market.outcomes,
      resolveTokenIds(market, input.market_context)
    );
    for (const tokenId of tokenIds) {
      let clobSnapshot = buildEmptyClobSnapshot();
      let priceContext: PriceContext;

      try {
        clobSnapshot = await clobProvider.getOrderBookSummary(tokenId);
      } catch (error) {
        lastError = error;
        console.warn({
          message: "market_signal_clob_failed",
          market_id: market.market_id,
          token_id: tokenId,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      try {
        priceContext = await buildPriceContext(
          tokenId,
          pricingProvider,
          historyOptions
        );
      } catch (error) {
        lastError = error;
        console.warn({
          message: "market_signal_pricing_failed",
          market_id: market.market_id,
          token_id: tokenId,
          error: error instanceof Error ? error.message : String(error)
        });
        priceContext = buildPriceFailureContext(
          tokenId,
          error,
          clobSnapshot.midpoint ?? null
        );
      }

      signals.push({
        market_id: market.market_id,
        token_id: tokenId,
        clob_snapshot: clobSnapshot,
        price_context: priceContext
      });
    }
  }

  if (signals.length === 0 && lastError) {
    throw lastError;
  }

  return {
    market_context: {
      ...input.market_context,
      market_signals: signals
    },
    market_signals: signals
  };
}

export type { MarketSignalsInput, MarketSignalsOutput, MarketSignalsOptions };
