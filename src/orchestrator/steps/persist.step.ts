import { randomUUID } from "node:crypto";
import { createAppError, ERROR_CODES } from "../errors.js";
import type {
  EvidenceCandidate,
  LiquidityProxy,
  MarketContext,
  MarketSignal,
  PriceContext
} from "../types.js";
import type { ReportV1Json } from "../../providers/llm/types.js";
import {
  getDefaultSqliteStorageAdapter,
  type StorageAdapter,
  type EventRecord,
  type EvidenceRecord,
  type ReportRecord
} from "../../storage/index.js";

const MARKET_BASE_URL = "https://polymarket.com/event";

export type PersistInput = {
  request_id: string;
  run_id: string;
  event_slug: string;
  market_context?: MarketContext;
  evidence_candidates?: EvidenceCandidate[];
  report_json?: ReportV1Json | string | null;
  liquidity_proxy?: LiquidityProxy;
  market_signals?: MarketSignal[];
  tg_post_text?: string | null;
};

export type PersistOptions = {
  storage?: StorageAdapter;
  status?: "ready" | "blocked" | "published";
  validator_code?: string | null;
  validator_message?: string | null;
  now?: () => number;
};

function buildMarketUrl(slug: string): string {
  return `${MARKET_BASE_URL}/${slug}`;
}

function formatTimeRemaining(endTime: string | undefined, now: () => number): string | null {
  if (!endTime) {
    return null;
  }
  const endMs = Date.parse(endTime);
  if (Number.isNaN(endMs)) {
    return null;
  }
  const diffMs = Math.max(0, endMs - now());
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function resolvePrimaryMarket(context: MarketContext) {
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

function normalizeProbability(value: number | null): number | null {
  if (value === null) {
    return null;
  }
  if (value >= 0 && value <= 1) {
    return Number((value * 100).toFixed(2));
  }
  return value;
}

function resolveMarketOdds(context: MarketContext): { yes: number | null; no: number | null } {
  const market = resolvePrimaryMarket(context);
  const outcomes = market?.outcomes ?? [];
  const prices = market?.outcomePrices ?? context.outcomePrices ?? [];
  if (prices.length === 0) {
    return { yes: null, no: null };
  }

  const normalizedOutcomes = outcomes.map((outcome) => outcome.trim().toLowerCase());
  const yesIndex = normalizedOutcomes.findIndex((outcome) => outcome === "yes");
  const noIndex = normalizedOutcomes.findIndex((outcome) => outcome === "no");

  const yes = yesIndex >= 0 ? prices[yesIndex] ?? null : prices[0] ?? null;
  const no =
    noIndex >= 0
      ? prices[noIndex] ?? null
      : prices.length > 1
        ? prices[1] ?? null
        : null;

  return {
    yes: typeof yes === "number" ? normalizeProbability(yes) : null,
    no: typeof no === "number" ? normalizeProbability(no) : null
  };
}

function resolveClobTokenIds(context: MarketContext): string[] {
  if (context.clobTokenIds && context.clobTokenIds.length > 0) {
    return context.clobTokenIds;
  }
  const primary = resolvePrimaryMarket(context);
  return primary?.clobTokenIds ?? [];
}

function resolvePriceContext(
  context: MarketContext,
  marketSignals?: MarketSignal[]
): PriceContext | null {
  if (context.price_context) {
    return context.price_context;
  }
  const signals = marketSignals ?? context.market_signals ?? [];
  if (signals.length === 0) {
    return null;
  }
  if (context.primary_market_id) {
    const match = signals.find(
      (signal) => signal.market_id === context.primary_market_id
    );
    if (match) {
      return match.price_context;
    }
  }
  return signals[0]?.price_context ?? null;
}

function toJsonString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function buildEventRecord(
  input: PersistInput,
  now: () => number
): EventRecord {
  const marketContext = input.market_context;
  if (!marketContext) {
    throw createAppError({
      code: ERROR_CODES.STEP_PERSIST_MISSING_INPUT,
      message: "Missing market_context for persist step",
      category: "STORE",
      retryable: false,
      details: { event_slug: input.event_slug }
    });
  }

  const odds = resolveMarketOdds(marketContext);
  const priceContext = resolvePriceContext(marketContext, input.market_signals);
  const liquidityProxy = marketContext.liquidity_proxy ?? input.liquidity_proxy ?? null;
  const createdAt = new Date(now()).toISOString();

  return {
    slug: marketContext.slug,
    url: buildMarketUrl(marketContext.slug),
    title: marketContext.title,
    description: marketContext.description ?? null,
    resolution_rules_raw:
      marketContext.resolution_rules_raw ?? marketContext.description ?? null,
    end_time: marketContext.end_time ?? null,
    time_remaining: formatTimeRemaining(marketContext.end_time, now),
    market_yes: odds.yes,
    market_no: odds.no,
    clob_token_ids_json: toJsonString(resolveClobTokenIds(marketContext)),
    gamma_liquidity: liquidityProxy?.gamma_liquidity ?? null,
    book_depth_top10: liquidityProxy?.book_depth_top10 ?? null,
    spread: liquidityProxy?.spread ?? null,
    price_latest: priceContext?.latest_price ?? null,
    price_midpoint: priceContext?.midpoint_price ?? null,
    price_change_1h: priceContext?.signals.change_1h ?? null,
    price_change_4h: priceContext?.signals.change_4h ?? null,
    price_change_24h: priceContext?.signals.change_24h ?? null,
    price_volatility_24h: priceContext?.signals.volatility_24h ?? null,
    price_range_low_24h: priceContext?.signals.range_low_24h ?? null,
    price_range_high_24h: priceContext?.signals.range_high_24h ?? null,
    price_trend_slope_24h: priceContext?.signals.trend_slope_24h ?? null,
    price_spike_flag: priceContext?.signals.spike_flag ?? null,
    price_history_24h_json: toJsonString(priceContext?.history_24h ?? null),
    created_at: createdAt
  };
}

function buildEvidenceRecords(
  input: PersistInput
): EvidenceRecord[] {
  const evidence = input.evidence_candidates ?? [];
  return evidence.map((candidate) => ({
    evidence_id: `evidence_${randomUUID()}`,
    slug: input.event_slug,
    lane: candidate.lane,
    source_type: candidate.source_type,
    url: candidate.url,
    domain: candidate.domain,
    published_at: candidate.published_at ?? null,
    claim: candidate.claim,
    stance: candidate.stance,
    novelty: candidate.novelty === "priced" ? "priced_in" : candidate.novelty,
    strength: candidate.strength,
    repeated: candidate.repeated
  }));
}

function buildReportRecord(
  input: PersistInput,
  options: PersistOptions,
  now: () => number
): ReportRecord {
  const generatedAt = new Date(now()).toISOString();
  return {
    report_id: `report_${input.run_id}`,
    slug: input.event_slug,
    generated_at: generatedAt,
    report_json: toJsonString(input.report_json ?? null),
    tg_post_text: input.tg_post_text ?? null,
    status: options.status ?? "ready",
    validator_code: options.validator_code ?? null,
    validator_message: options.validator_message ?? null,
    regenerate_count_1h: 0,
    tg_message_id: null,
    reviewer: null
  };
}

export async function persistEventEvidenceReport(
  input: PersistInput,
  options: PersistOptions = {}
): Promise<void> {
  const storage = options.storage ?? getDefaultSqliteStorageAdapter();
  const now = options.now ?? (() => Date.now());
  const eventRecord = buildEventRecord(input, now);
  const evidenceRecords = buildEvidenceRecords(input);
  const reportRecord = buildReportRecord(input, options, now);

  try {
    storage.runInTransaction(() => {
      storage.upsertEvent(eventRecord);
      storage.appendEvidence(evidenceRecords);
      storage.saveReport(reportRecord);
    });
  } catch (error) {
    throw createAppError({
      code: ERROR_CODES.STORE_PERSIST_FAILED,
      message: error instanceof Error ? error.message : "Persist to storage failed",
      category: "STORE",
      retryable: false,
      details: {
        event_slug: input.event_slug,
        run_id: input.run_id
      }
    });
  }
}
