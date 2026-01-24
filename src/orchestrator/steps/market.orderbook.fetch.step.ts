import { createAppError, ERROR_CODES } from "../errors.js";
import type {
  ClobSnapshot,
  GammaMarket,
  MarketContext,
  MarketSignal
} from "../types.js";
import type { ClobProvider } from "../../providers/polymarket/clob.js";
import { createClobProvider } from "../../providers/polymarket/clob.js";

type OrderbookFetchInput = {
  market_context: MarketContext;
};

type OrderbookFetchOutput = {
  market_context: MarketContext;
  clob_snapshot: ClobSnapshot;
};

type OrderbookFetchOptions = {
  provider?: ClobProvider;
};

type MarketTokenGroup = {
  market_id?: string;
  outcomes?: string[];
  token_ids: string[];
  volume?: number;
};

const MAX_MARKET_PROBES = 8;

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

function buildMarketGroups(context: MarketContext): MarketTokenGroup[] {
  const markets = context.markets ?? [];
  if (markets.length === 0) {
    if (context.clobTokenIds && context.clobTokenIds.length > 0) {
      return [
        {
          outcomes: undefined,
          token_ids: context.clobTokenIds
        }
      ];
    }
    return [];
  }

  const primaryId = context.primary_market_id;
  const primaryMarket = primaryId
    ? markets.find((market) => market.market_id === primaryId)
    : null;

  const ordered = [
    ...(primaryMarket ? [primaryMarket] : []),
    ...markets
      .filter((market) => market !== primaryMarket)
      .slice()
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
  ];

  return ordered
    .map((market) => {
      const tokenIds =
        market.market_id === primaryId &&
        context.clobTokenIds &&
        context.clobTokenIds.length > 0
          ? context.clobTokenIds
          : market.clobTokenIds;
      return {
        market_id: market.market_id,
        outcomes: market.outcomes,
        token_ids: tokenIds ?? [],
        volume: market.volume
      };
    })
    .filter((group) => group.token_ids.length > 0);
}

function hasBothSides(snapshot: ClobSnapshot): boolean {
  let hasBid = false;
  let hasAsk = false;
  for (const level of snapshot.book_top_levels) {
    if (level.side === "bid") {
      hasBid = true;
    } else if (level.side === "ask") {
      hasAsk = true;
    }
    if (hasBid && hasAsk) {
      return true;
    }
  }
  return false;
}

function scoreSnapshot(snapshot: ClobSnapshot): number {
  if (snapshot.book_top_levels.length === 0) {
    return 0;
  }
  return hasBothSides(snapshot) ? 2 : 1;
}

function selectSignal(
  signals: MarketSignal[]
): MarketSignal | null {
  let fallback: MarketSignal | null = null;
  for (const signal of signals) {
    if (!fallback && signal.clob_snapshot.book_top_levels.length > 0) {
      fallback = signal;
    }
    if (hasBothSides(signal.clob_snapshot)) {
      return signal;
    }
  }
  return fallback;
}

export async function fetchMarketOrderbook(
  input: OrderbookFetchInput,
  options: OrderbookFetchOptions = {}
): Promise<OrderbookFetchOutput> {
  if (input.market_context.market_signals?.length) {
    const selected = selectSignal(input.market_context.market_signals);
    if (selected) {
      return {
        market_context: {
          ...input.market_context,
          clob_market_id_used: selected.market_id,
          clob_token_id_used: selected.token_id
        },
        clob_snapshot: selected.clob_snapshot
      };
    }
  }

  const provider = options.provider ?? createClobProvider();
  const groups = buildMarketGroups(input.market_context);

  if (groups.length === 0) {
    throw createAppError({
      code: ERROR_CODES.PROVIDER_PM_CLOB_TOKEN_INVALID,
      message: "CLOB token_id is required",
      category: "PROVIDER",
      retryable: false,
      details: { slug: input.market_context.slug }
    });
  }

  let bestSnapshot: ClobSnapshot | null = null;
  let bestMarketId: string | undefined;
  let bestTokenId: string | undefined;
  let bestScore = -1;
  let lastError: unknown;

  const groupsToProbe = groups.slice(0, MAX_MARKET_PROBES);
  for (const group of groupsToProbe) {
    const tokenIds = prioritizeTokenIds(group.outcomes, group.token_ids);
    for (const tokenId of tokenIds) {
      try {
        const snapshot = await provider.getOrderBookSummary(tokenId);
        const score = scoreSnapshot(snapshot);
        if (score > bestScore) {
          bestSnapshot = snapshot;
          bestScore = score;
          bestMarketId = group.market_id;
          bestTokenId = tokenId;
        }
        if (score === 2) {
          return {
            market_context: {
              ...input.market_context,
              clob_market_id_used: group.market_id,
              clob_token_id_used: tokenId
            },
            clob_snapshot: snapshot
          };
        }
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (bestSnapshot) {
    return {
      market_context: {
        ...input.market_context,
        clob_market_id_used: bestMarketId,
        clob_token_id_used: bestTokenId
      },
      clob_snapshot: bestSnapshot
    };
  }

  if (lastError) {
    throw lastError;
  }

  return {
    market_context: input.market_context,
    clob_snapshot: {
      spread: null,
      midpoint: null,
      book_top_levels: [],
      notable_walls: []
    }
  };
}

export type { OrderbookFetchInput, OrderbookFetchOutput, OrderbookFetchOptions };
