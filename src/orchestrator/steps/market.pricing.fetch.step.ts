import { createAppError, ERROR_CODES } from "../errors.js";
import type {
  GammaMarket,
  MarketContext,
  PriceContext,
  PriceHistoryWarning,
  PricePoint,
  PriceSignals
} from "../types.js";
import type { PricingProvider, PriceHistoryOptions } from "../../providers/polymarket/pricing.js";
import { createPricingProvider } from "../../providers/polymarket/pricing.js";

type PricingStepInput = {
  market_context: MarketContext;
};

type PricingStepOutput = {
  market_context: MarketContext;
  price_context: PriceContext;
};

type PricingStepOptions = PriceHistoryOptions & {
  provider?: PricingProvider;
};

type HistoryPointMs = {
  tsMs: number;
  price: number;
};

function resolvePrimaryMarket(context: MarketContext): GammaMarket | null {
  if (!context.markets || context.markets.length === 0) {
    return null;
  }
  if (context.primary_market_id) {
    const match = context.markets.find(
      (market) => market.market_id === context.primary_market_id
    );
    if (match) {
      return match;
    }
  }
  if (context.markets.length === 1) {
    return context.markets[0] ?? null;
  }
  return null;
}

function selectTokenId(context: MarketContext): string {
  const primaryMarket = resolvePrimaryMarket(context);
  const tokenIds =
    (context.clobTokenIds && context.clobTokenIds.length > 0
      ? context.clobTokenIds
      : primaryMarket?.clobTokenIds) ?? [];

  if (tokenIds.length === 0) {
    throw createAppError({
      code: ERROR_CODES.PROVIDER_PM_PRICING_TOKEN_INVALID,
      message: "Pricing token_id is required",
      category: "PROVIDER",
      retryable: false,
      details: { slug: context.slug }
    });
  }

  if (primaryMarket?.outcomes && primaryMarket.outcomes.length === tokenIds.length) {
    const yesIndex = primaryMarket.outcomes.findIndex(
      (outcome) => outcome.trim().toLowerCase() === "yes"
    );
    if (yesIndex >= 0 && tokenIds[yesIndex]) {
      return tokenIds[yesIndex]!;
    }
  }

  return tokenIds[0]!;
}

function normalizeHistoryPoints(history: PricePoint[]): HistoryPointMs[] {
  if (history.length === 0) {
    return [];
  }
  const maxTs = history.reduce((max, point) => Math.max(max, point.ts), history[0]!.ts);
  const scale = maxTs > 1_000_000_000_000 ? 1 : 1000;
  return history
    .slice()
    .sort((a, b) => a.ts - b.ts)
    .map((point) => ({ tsMs: point.ts * scale, price: point.price }));
}

function findPointAtOrBefore(
  history: HistoryPointMs[],
  targetMs: number
): HistoryPointMs | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]!.tsMs <= targetMs) {
      return history[i]!;
    }
  }
  return null;
}

function computeStdDev(values: number[]): number | null {
  if (values.length < 2) {
    return null;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function computeMedian(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
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

function computePriceSignals(history: PricePoint[]): {
  signals: PriceSignals;
  warning?: PriceHistoryWarning;
} {
  if (history.length < 2) {
    return {
      signals: buildEmptySignals(),
      warning: {
        code: "PRICE_HISTORY_INSUFFICIENT",
        message: "History points less than 2; derived signals are null."
      }
    };
  }

  const normalized = normalizeHistoryPoints(history);
  if (normalized.length < 2) {
    return {
      signals: buildEmptySignals(),
      warning: {
        code: "PRICE_HISTORY_INSUFFICIENT",
        message: "History points less than 2 after normalization; signals null."
      }
    };
  }

  const last = normalized[normalized.length - 1]!;
  const first = normalized[0]!;
  const changeAt = (hours: number): number | null => {
    const target = findPointAtOrBefore(
      normalized,
      last.tsMs - hours * 60 * 60 * 1000
    );
    return target ? last.price - target.price : null;
  };

  const deltas: number[] = [];
  for (let i = 1; i < normalized.length; i += 1) {
    deltas.push(normalized[i]!.price - normalized[i - 1]!.price);
  }

  const volatility = computeStdDev(deltas);
  const absDeltas = deltas.map((delta) => Math.abs(delta));
  const maxAbsDelta = absDeltas.length > 0 ? Math.max(...absDeltas) : null;
  const medianAbsDelta = computeMedian(absDeltas);
  const spikeFlag = (() => {
    if (maxAbsDelta === null || absDeltas.length < 2) {
      return null;
    }
    const stddev = volatility ?? 0;
    const median = medianAbsDelta ?? 0;
    const threshold = Math.max(4 * stddev, 3 * median);
    if (threshold <= 0) {
      return false;
    }
    return maxAbsDelta >= threshold;
  })();

  const prices = normalized.map((point) => point.price);
  const hoursDiff = (last.tsMs - first.tsMs) / (60 * 60 * 1000);
  const trendSlope = hoursDiff > 0 ? (last.price - first.price) / hoursDiff : null;

  return {
    signals: {
      change_1h: changeAt(1),
      change_4h: changeAt(4),
      change_24h: changeAt(24),
      volatility_24h: volatility,
      range_high_24h: Math.max(...prices),
      range_low_24h: Math.min(...prices),
      trend_slope_24h: trendSlope,
      spike_flag: spikeFlag
    }
  };
}

export async function buildPriceContext(
  tokenId: string,
  provider: PricingProvider,
  options: PriceHistoryOptions = {}
): Promise<PriceContext> {
  const latestPrice = await provider.getMarketPrice(tokenId);
  const midpointPrice = await provider.getMidpointPrice(tokenId);
  const history = await provider.getPriceHistory(tokenId, options);
  const { signals, warning } = computePriceSignals(history);

  const priceContext: PriceContext = {
    token_id: tokenId,
    latest_price: latestPrice,
    midpoint_price: midpointPrice,
    history_24h: history,
    signals
  };

  if (warning) {
    priceContext.history_warning = warning;
  }

  return priceContext;
}

export async function fetchMarketPricing(
  input: PricingStepInput,
  options: PricingStepOptions = {}
): Promise<PricingStepOutput> {
  const tokenId = selectTokenId(input.market_context);
  const provider = options.provider ?? createPricingProvider();
  const priceContext = await buildPriceContext(tokenId, provider, options);

  return {
    market_context: {
      ...input.market_context,
      price_context: priceContext
    },
    price_context: priceContext
  };
}

export type { PricingStepInput, PricingStepOutput, PricingStepOptions };
