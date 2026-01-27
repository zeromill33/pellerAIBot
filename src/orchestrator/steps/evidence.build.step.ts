import { createAppError, ERROR_CODES } from "../errors.js";
import type {
  EvidenceCandidate,
  EvidenceSourceType,
  MarketSignal,
  TavilyLane,
  TavilyLaneResult,
  TavilySearchResult
} from "../types.js";
import {
  diceCoefficient,
  normalizeDomain,
  normalizeText,
  truncateText
} from "../../utils/text.js";

type EvidenceBuildInput = {
  event_slug: string;
  tavily_results: TavilyLaneResult[];
  market_signals?: MarketSignal[];
};

type EvidenceBuildOutput = {
  evidence_candidates: EvidenceCandidate[];
};

const TITLE_SIMILARITY_THRESHOLD = 0.9;
const MAX_CLAIM_CHARS = 280;
const DEFAULT_STANCE = "neutral";
const DEFAULT_NOVELTY = "unknown";
const DEFAULT_STRENGTH = 1;
const MARKET_EVIDENCE_LANE: TavilyLane = "A";
const MARKET_EVIDENCE_QUERY = "market_behavior";

const SOURCE_PRIORITY: Record<EvidenceSourceType, number> = {
  official: 0,
  media: 1,
  market: 2,
  social: 3,
  onchain: 4
};

const DEFAULT_SOURCE_TYPE_BY_LANE: Record<TavilyLane, EvidenceSourceType> = {
  A: "media",
  B: "media",
  C: "media",
  D: "social"
};

const SOCIAL_DOMAINS = new Set([
  "x.com",
  "twitter.com",
  "t.co",
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "t.me",
  "telegram.org",
  "discord.com",
  "discord.gg",
  "youtube.com",
  "youtu.be"
]);

const MARKET_DOMAINS = new Set([
  "polymarket.com",
  "kalshi.com",
  "predictit.org",
  "manifold.markets",
  "betfair.com"
]);

const OFFICIAL_DOMAINS = new Set([
  "whitehouse.gov",
  "sec.gov",
  "federalreserve.gov",
  "who.int",
  "ec.europa.eu"
]);

const MEDIA_DOMAINS = new Set([
  "reuters.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "nytimes.com",
  "apnews.com",
  "bbc.com",
  "cnn.com"
]);

const ONCHAIN_DOMAINS = new Set([
  "etherscan.io",
  "basescan.org",
  "bscscan.com",
  "arbiscan.io",
  "polygonscan.com",
  "blockchain.com",
  "solscan.io",
  "explorer.solana.com"
]);

const OFFICIAL_PATH_HINTS = [
  "/press",
  "/official",
  "/statement",
  "/newsroom"
];

const STANCE_YES_KEYWORDS = new Set([
  "confirm",
  "confirmed",
  "confirms",
  "approve",
  "approved",
  "approves",
  "pass",
  "passed",
  "passes",
  "sign",
  "signed",
  "signs",
  "ratify",
  "ratified",
  "ratifies",
  "win",
  "won",
  "wins",
  "elect",
  "elected",
  "elects",
  "appoint",
  "appointed",
  "appoints",
  "nominate",
  "nominated",
  "nominates",
  "announce",
  "announced",
  "announces",
  "launch",
  "launched",
  "launches",
  "acquire",
  "acquired",
  "acquires",
  "merge",
  "merged",
  "merger",
  "settle",
  "settled",
  "settlement",
  "resign",
  "resigned",
  "resigns",
  "close",
  "closed",
  "complete",
  "completed",
  "submit",
  "submitted",
  "submits",
  "file",
  "filed",
  "files"
]);

const STANCE_NO_KEYWORDS = new Set([
  "deny",
  "denied",
  "denies",
  "refute",
  "refuted",
  "refutes",
  "reject",
  "rejected",
  "rejects",
  "veto",
  "vetoed",
  "block",
  "blocked",
  "cancel",
  "canceled",
  "cancelled",
  "scrap",
  "scrapped",
  "postpone",
  "postponed",
  "delay",
  "delayed",
  "lose",
  "lost",
  "loses",
  "defeat",
  "defeated",
  "fails",
  "fail",
  "failed",
  "withdraw",
  "withdrawn",
  "withdraws",
  "refuse",
  "refused",
  "refuses",
  "false",
  "fake",
  "hoax"
]);

const STANCE_YES_PHRASES = ["set to", "expected to"];

const STANCE_NO_PHRASES = [
  "did not",
  "does not",
  "do not",
  "will not",
  "won t",
  "can t",
  "cannot",
  "not expected",
  "unlikely",
  "no evidence",
  "rules out",
  "ruled out"
];

const ALLOW_ONCHAIN_SOURCE_TYPES = false;

type InternalCandidate = EvidenceCandidate & {
  normalized_url: string;
  similarity_key: string;
  priority: number;
  published_at_ms: number | null;
};

const POLYMARKET_BASE_URL = "https://polymarket.com";

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const path =
      parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    const search = parsed.search ?? "";
    const hash = parsed.hash ?? "";
    return `${parsed.protocol}//${host}${path}${search}${hash}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

function normalizeTitle(input: string): string {
  return normalizeText(input);
}

function buildSimilarityKey(domain: string, title: string): string {
  const titleKey = normalizeTitle(title);
  const domainKey = normalizeDomain(domain);
  return `${domainKey} ${titleKey}`.trim();
}

function parsePublishedAt(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }
  return parsed.valueOf();
}

function hasPrefixMatch(value: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => value.includes(prefix));
}

function buildMarketUrl(eventSlug: string): string {
  const slug = eventSlug.trim();
  if (!slug) {
    return POLYMARKET_BASE_URL;
  }
  return `${POLYMARKET_BASE_URL}/event/${encodeURIComponent(slug)}`;
}

function formatSignedPct(value: number): string {
  const pct = value * 100;
  const rounded = Math.abs(pct) < 0.05 ? 0 : pct;
  const formatted = Math.abs(rounded).toFixed(1);
  if (rounded > 0) {
    return `+${formatted}%`;
  }
  if (rounded < 0) {
    return `-${formatted}%`;
  }
  return `0.0%`;
}

function isOfficialDomain(domain: string, url: string): boolean {
  const normalizedDomain = normalizeDomain(domain);
  if (OFFICIAL_DOMAINS.has(normalizedDomain)) {
    return true;
  }
  if (
    normalizedDomain.endsWith(".gov") ||
    normalizedDomain.includes(".gov.") ||
    normalizedDomain.endsWith(".mil")
  ) {
    return true;
  }
  return hasPrefixMatch(url, OFFICIAL_PATH_HINTS);
}

function resolveSourceType(
  lane: TavilyLane,
  domain: string,
  url: string
): EvidenceSourceType {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedUrl = url.toLowerCase();

  if (lane === "D") {
    return "social";
  }

  if (lane === "B" && isOfficialDomain(normalizedDomain, normalizedUrl)) {
    return "official";
  }
  if ((lane === "A" || lane === "C") && MEDIA_DOMAINS.has(normalizedDomain)) {
    return "media";
  }

  if (SOCIAL_DOMAINS.has(normalizedDomain)) {
    return "social";
  }
  if (MARKET_DOMAINS.has(normalizedDomain)) {
    return "market";
  }
  if (ALLOW_ONCHAIN_SOURCE_TYPES && ONCHAIN_DOMAINS.has(normalizedDomain)) {
    return "onchain";
  }
  if (isOfficialDomain(normalizedDomain, normalizedUrl)) {
    return "official";
  }
  if (MEDIA_DOMAINS.has(normalizedDomain)) {
    return "media";
  }
  return DEFAULT_SOURCE_TYPE_BY_LANE[lane];
}

function buildMarketClaim(signal: MarketSignal): string {
  const parts: string[] = [];
  const change24h = signal.price_context.signals.change_24h;
  if (typeof change24h === "number") {
    parts.push(`过去24h价格变动${formatSignedPct(change24h)}`);
  }
  const spread = signal.clob_snapshot.spread;
  if (typeof spread === "number") {
    parts.push(`盘口点差${spread.toFixed(4)}`);
  }
  const walls = signal.clob_snapshot.notable_walls.length;
  if (walls > 0) {
    parts.push(`检测到${walls}个显著墙`);
  }
  if (signal.price_context.signals.spike_flag === true) {
    parts.push("检测到价格尖峰");
  }
  if (parts.length === 0) {
    return "";
  }
  return `市场行为：${parts.join("；")}`;
}

function selectMarketSignal(signals: MarketSignal[]): MarketSignal | null {
  let fallback: MarketSignal | null = null;
  for (const signal of signals) {
    if (!fallback) {
      fallback = signal;
    }
    const hasSignal =
      typeof signal.price_context.signals.change_24h === "number" ||
      signal.clob_snapshot.notable_walls.length > 0 ||
      typeof signal.clob_snapshot.spread === "number";
    if (hasSignal) {
      return signal;
    }
  }
  return fallback;
}

function buildMarketEvidenceCandidates(
  eventSlug: string,
  signals: MarketSignal[] | undefined
): InternalCandidate[] {
  if (!signals || signals.length === 0) {
    return [];
  }
  const signal = selectMarketSignal(signals);
  if (!signal) {
    return [];
  }
  const claim = buildMarketClaim(signal);
  if (!claim) {
    return [];
  }
  const url = buildMarketUrl(eventSlug);
  const domain = normalizeDomain(url);
  const normalizedUrl = normalizeUrl(url);
  const similarityKey = buildSimilarityKey(domain, claim);

  return [
    {
      source_type: "market",
      url,
      domain,
      published_at: undefined,
      claim: truncateText(claim, MAX_CLAIM_CHARS),
      stance: DEFAULT_STANCE,
      novelty: DEFAULT_NOVELTY,
      repeated: false,
      strength: DEFAULT_STRENGTH,
      lane: MARKET_EVIDENCE_LANE,
      query: MARKET_EVIDENCE_QUERY,
      normalized_url: normalizedUrl,
      similarity_key: similarityKey || normalizedUrl,
      priority: SOURCE_PRIORITY.market,
      published_at_ms: null
    }
  ];
}

function buildClaim(result: TavilySearchResult): string {
  const raw = result.raw_content?.trim() ?? "";
  const title = result.title?.trim() ?? "";
  const fallback = result.url.trim();
  const base = raw || title || fallback;
  return truncateText(base, MAX_CLAIM_CHARS);
}

function hasKeyword(tokens: string[], keywords: Set<string>): boolean {
  return tokens.some((token) => keywords.has(token));
}

function hasPhrase(normalized: string, phrases: string[]): boolean {
  return phrases.some((phrase) => normalized.includes(phrase));
}

function resolveStance(claim: string): EvidenceCandidate["stance"] {
  const normalized = normalizeText(claim);
  if (!normalized) {
    return DEFAULT_STANCE;
  }
  if (hasPhrase(normalized, STANCE_NO_PHRASES)) {
    return "supports_no";
  }
  const tokens = normalized.split(" ").filter(Boolean);
  const yesHit =
    hasKeyword(tokens, STANCE_YES_KEYWORDS) ||
    hasPhrase(normalized, STANCE_YES_PHRASES);
  const noHit =
    hasKeyword(tokens, STANCE_NO_KEYWORDS);

  if (yesHit && !noHit) {
    return "supports_yes";
  }
  if (noHit && !yesHit) {
    return "supports_no";
  }
  return DEFAULT_STANCE;
}

function buildCandidate(
  lane: TavilyLaneResult,
  result: TavilySearchResult
): InternalCandidate | null {
  const url = result.url?.trim() ?? "";
  if (!url) {
    return null;
  }
  const normalizedUrl = normalizeUrl(url);
  const domain = normalizeDomain(result.domain ?? url);
  if (!domain) {
    return null;
  }
  const similarityKey = buildSimilarityKey(domain, result.title ?? url);
  const sourceType = resolveSourceType(lane.lane, domain, url);
  const publishedAtMs = parsePublishedAt(result.published_at);

  const claim = buildClaim(result);
  const candidate: InternalCandidate = {
    source_type: sourceType,
    url,
    domain,
    published_at: result.published_at,
    claim,
    stance: resolveStance(claim),
    novelty: DEFAULT_NOVELTY,
    repeated: false,
    strength: DEFAULT_STRENGTH,
    lane: lane.lane,
    query: lane.query,
    normalized_url: normalizedUrl,
    similarity_key: similarityKey || normalizedUrl,
    priority: SOURCE_PRIORITY[sourceType],
    published_at_ms: publishedAtMs
  };

  return candidate;
}

function compareCandidates(a: InternalCandidate, b: InternalCandidate): number {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  const aTime = a.published_at_ms;
  const bTime = b.published_at_ms;
  if (aTime !== null && bTime !== null && aTime !== bTime) {
    return aTime - bTime;
  }
  if (aTime !== null && bTime === null) {
    return -1;
  }
  if (aTime === null && bTime !== null) {
    return 1;
  }
  const urlCompare = a.normalized_url.localeCompare(b.normalized_url);
  if (urlCompare !== 0) {
    return urlCompare;
  }
  const laneCompare = a.lane.localeCompare(b.lane);
  if (laneCompare !== 0) {
    return laneCompare;
  }
  return a.query.localeCompare(b.query);
}

function isSimilar(a: InternalCandidate, b: InternalCandidate): boolean {
  const score = diceCoefficient(a.similarity_key, b.similarity_key);
  return score >= TITLE_SIMILARITY_THRESHOLD;
}

function groupBySimilarity(
  candidates: InternalCandidate[]
): InternalCandidate[][] {
  const groups: InternalCandidate[][] = [];
  for (const candidate of candidates) {
    let matched = false;
    for (const group of groups) {
      const anchor = group[0];
      if (anchor && isSimilar(candidate, anchor)) {
        group.push(candidate);
        matched = true;
        break;
      }
    }
    if (!matched) {
      groups.push([candidate]);
    }
  }
  return groups;
}

export function buildEvidenceCandidates(
  input: EvidenceBuildInput
): EvidenceBuildOutput {
  if (!Array.isArray(input.tavily_results)) {
    throw createAppError({
      code: ERROR_CODES.STEP_EVIDENCE_BUILD_MISSING_INPUT,
      message: "Missing tavily_results for evidence.build",
      category: "VALIDATION",
      retryable: false,
      details: { event_slug: input.event_slug }
    });
  }

  const urlSeen = new Set<string>();
  const candidates: InternalCandidate[] = [];
  const marketCandidates = buildMarketEvidenceCandidates(
    input.event_slug,
    input.market_signals
  );

  for (const candidate of marketCandidates) {
    if (candidate.normalized_url && urlSeen.has(candidate.normalized_url)) {
      continue;
    }
    urlSeen.add(candidate.normalized_url);
    candidates.push(candidate);
  }

  for (const lane of input.tavily_results) {
    for (const result of lane.results) {
      const candidate = buildCandidate(lane, result);
      if (!candidate) {
        continue;
      }
      if (urlSeen.has(candidate.normalized_url)) {
        continue;
      }
      urlSeen.add(candidate.normalized_url);
      candidates.push(candidate);
    }
  }

  const sorted = [...candidates].sort((a, b) => {
    const keyCompare = a.similarity_key.localeCompare(b.similarity_key);
    if (keyCompare !== 0) {
      return keyCompare;
    }
    return a.normalized_url.localeCompare(b.normalized_url);
  });

  const groups = groupBySimilarity(sorted);
  const flattened: EvidenceCandidate[] = [];

  for (const group of groups) {
    const ordered = [...group].sort(compareCandidates);
    ordered.forEach((item, index) => {
      const repeated = index !== 0;
      flattened.push({
        source_type: item.source_type,
        url: item.url,
        domain: item.domain,
        published_at: item.published_at,
        claim: item.claim,
        stance: item.stance,
        novelty: item.novelty,
        repeated,
        strength: item.strength,
        lane: item.lane,
        query: item.query
      });
    });
  }

  return { evidence_candidates: flattened };
}

export type { EvidenceBuildInput, EvidenceBuildOutput };
export { MAX_CLAIM_CHARS };
