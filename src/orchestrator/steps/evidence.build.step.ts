import { createAppError, ERROR_CODES } from "../errors.js";
import type {
  EvidenceCandidate,
  EvidenceSourceType,
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
};

type EvidenceBuildOutput = {
  evidence_candidates: EvidenceCandidate[];
};

const TITLE_SIMILARITY_THRESHOLD = 0.9;
const MAX_CLAIM_CHARS = 280;
const DEFAULT_STANCE = "neutral";
const DEFAULT_NOVELTY = "unknown";
const DEFAULT_STRENGTH = 1;

const SOURCE_PRIORITY: Record<EvidenceSourceType, number> = {
  official: 0,
  media: 1,
  market: 2,
  social: 3,
  onchain: 4
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

type InternalCandidate = EvidenceCandidate & {
  normalized_url: string;
  similarity_key: string;
  priority: number;
  published_at_ms: number | null;
};

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

function resolveSourceType(domain: string, url: string): EvidenceSourceType {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedUrl = url.toLowerCase();
  if (SOCIAL_DOMAINS.has(normalizedDomain)) {
    return "social";
  }
  if (MARKET_DOMAINS.has(normalizedDomain)) {
    return "market";
  }
  if (ONCHAIN_DOMAINS.has(normalizedDomain)) {
    return "onchain";
  }
  if (
    normalizedDomain.endsWith(".gov") ||
    normalizedDomain.includes(".gov.") ||
    normalizedDomain.endsWith(".mil")
  ) {
    return "official";
  }
  if (hasPrefixMatch(normalizedUrl, OFFICIAL_PATH_HINTS)) {
    return "official";
  }
  return "media";
}

function buildClaim(result: TavilySearchResult): string {
  const raw = result.raw_content?.trim() ?? "";
  const title = result.title?.trim() ?? "";
  const fallback = result.url.trim();
  const base = raw || title || fallback;
  return truncateText(base, MAX_CLAIM_CHARS);
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
  const sourceType = resolveSourceType(domain, url);
  const publishedAtMs = parsePublishedAt(result.published_at);

  const candidate: InternalCandidate = {
    source_type: sourceType,
    url,
    domain,
    published_at: result.published_at,
    claim: buildClaim(result),
    stance: DEFAULT_STANCE,
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
