import type {
  ClobSnapshot,
  GammaMarket,
  LiquidityProxy,
  MarketContext,
  OrderBookLevel
} from "../types.js";

type LiquidityProxyInput = {
  market_context: MarketContext;
  clob_snapshot: ClobSnapshot;
};

type LiquidityProxyOutput = {
  market_context: MarketContext;
  liquidity_proxy: LiquidityProxy;
};

const DEPTH_LEVELS = 10;

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

function sortLevels(
  levels: OrderBookLevel[],
  side: OrderBookLevel["side"]
): OrderBookLevel[] {
  return levels
    .slice()
    .sort((a, b) => (side === "bid" ? b.price - a.price : a.price - b.price));
}

function sumTopLevels(levels: OrderBookLevel[], side: OrderBookLevel["side"]): number {
  const filtered = levels.filter((level) => level.side === side);
  if (filtered.length === 0) {
    return 0;
  }
  const sorted = sortLevels(filtered, side);
  return sorted
    .slice(0, DEPTH_LEVELS)
    .reduce((sum, level) => sum + level.size, 0);
}

function computeBookDepthTop10(levels: OrderBookLevel[]): number {
  const bidDepth = sumTopLevels(levels, "bid");
  const askDepth = sumTopLevels(levels, "ask");
  return bidDepth + askDepth;
}

export async function mergeLiquidityProxy(
  input: LiquidityProxyInput
): Promise<LiquidityProxyOutput> {
  const primaryMarket = resolvePrimaryMarket(input.market_context);
  const liquidityProxy: LiquidityProxy = {
    gamma_liquidity: primaryMarket?.liquidity ?? null,
    book_depth_top10: computeBookDepthTop10(input.clob_snapshot.book_top_levels),
    spread: input.clob_snapshot.spread,
    midpoint: input.clob_snapshot.midpoint,
    notable_walls: input.clob_snapshot.notable_walls
  };

  return {
    market_context: {
      ...input.market_context,
      liquidity_proxy: liquidityProxy
    },
    liquidity_proxy: liquidityProxy
  };
}

export type { LiquidityProxyInput, LiquidityProxyOutput };
