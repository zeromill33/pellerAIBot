import { validateTavilyConfig } from "../../config/config.schema.js";
import type {
  TavilyChatterConfig,
  TavilyConfigInput
} from "../../config/config.schema.js";
import { createAppError, ERROR_CODES } from "../errors.js";
import type {
  EvidenceCandidate,
  MarketContext,
  MarketSignal,
  PriceContext,
  TavilyQueryLane,
  TavilyQueryPlan
} from "../types.js";

type QueryPlanBuildInput = {
  request_id?: string;
  run_id?: string;
  market_context: MarketContext;
  market_signals?: MarketSignal[];
  evidence_candidates?: EvidenceCandidate[];
  tavily_config?: TavilyConfigInput;
};

type QueryPlanBuildOutput = {
  market_context: MarketContext;
  query_plan: TavilyQueryPlan;
};

const MAX_QUERY_CHARS = 400;
const MAX_SUBJECT_WORDS = 6;
const MAX_OBJECT_WORDS = 12;
const FALLBACK_SUBJECT = "event";
const FALLBACK_OBJECT = "resolution";
const FALLBACK_TIME_ANCHOR = "this week";
const DISAGREEMENT_MIN_COUNT = 2;

const ACTION_KEYWORDS = [
  "nominate",
  "win",
  "approve",
  "ban",
  "launch",
  "announce",
  "settle",
  "pass",
  "reject",
  "delay",
  "acquire",
  "merge",
  "resign",
  "appoint",
  "elect",
  "lose",
  "raise",
  "cut",
  "issue"
];

const STOP_ENTITY_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "be",
  "to",
  "will",
  "would",
  "should",
  "could",
  "can",
  "may",
  "on",
  "in",
  "for"
]);

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function limitWords(value: string, maxWords: number): string {
  const words = normalizeWhitespace(value).split(" ");
  return words.slice(0, maxWords).join(" ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractSubjectEntities(text: string): string[] {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return [];
  }

  const entities = new Set<string>();
  const tickerMatches = normalized.match(/\$[A-Z0-9]{2,10}\b/g) ?? [];
  for (const match of tickerMatches) {
    entities.add(match.slice(1));
  }

  const capitalizedMatches =
    normalized.match(
      /\b[A-Z][A-Za-z0-9&.-]*(?:\s+[A-Z][A-Za-z0-9&.-]*){0,2}\b/g
    ) ?? [];
  for (const match of capitalizedMatches) {
    const candidate = match.trim();
    if (!candidate) {
      continue;
    }
    if (STOP_ENTITY_WORDS.has(candidate.toLowerCase())) {
      continue;
    }
    entities.add(candidate);
  }

  const results = Array.from(entities).filter((entity) => entity.length > 1);
  if (results.length > 0) {
    return results.slice(0, 3);
  }

  const fallback = limitWords(normalized, MAX_SUBJECT_WORDS);
  return fallback ? [fallback] : [];
}

function extractAction(text: string): string {
  const normalized = normalizeWhitespace(text).toLowerCase();
  for (const keyword of ACTION_KEYWORDS) {
    const pattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "i");
    if (pattern.test(normalized)) {
      return keyword;
    }
  }

  const willMatch = normalized.match(/\bwill\s+([a-z0-9-]+)/);
  if (willMatch?.[1]) {
    return willMatch[1];
  }
  const toMatch = normalized.match(/\bto\s+([a-z0-9-]+)/);
  if (toMatch?.[1]) {
    return toMatch[1];
  }

  return "update";
}

function extractObject(text: string, action: string): string {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return "";
  }
  if (action) {
    const pattern = new RegExp(`\\b${escapeRegExp(action)}\\b`, "i");
    const match = pattern.exec(normalized);
    if (match) {
      const after = normalized.slice(match.index + match[0].length).trim();
      if (after) {
        return limitWords(after, MAX_OBJECT_WORDS);
      }
    }
  }
  return limitWords(normalized, MAX_OBJECT_WORDS);
}

function buildTimeAnchor(endTime: string | undefined): string {
  if (hasText(endTime)) {
    const parsed = new Date(endTime);
    if (!Number.isNaN(parsed.valueOf())) {
      return `before ${parsed.toISOString().slice(0, 10)}`;
    }
  }
  return FALLBACK_TIME_ANCHOR;
}

function finalizeQuery(query: string): string {
  const normalized = normalizeWhitespace(query);
  if (normalized.length <= MAX_QUERY_CHARS) {
    return normalized;
  }
  return normalized.slice(0, MAX_QUERY_CHARS).trim();
}

type BaseQueryPlan = {
  lanes: TavilyQueryLane[];
  topic_core: string;
  event_keywords: string;
};

type ChatterTriggerSummary = {
  odds_change_24h_pct: {
    available: boolean;
    value_pct: number | null;
    threshold: number;
    triggered: boolean;
  };
  social_category: {
    available: boolean;
    value: string | null;
    eligible: string[];
    triggered: boolean;
  };
  disagreement_insufficient: {
    enabled: boolean;
    evidence_available: boolean;
    evidence_count: number | null;
    threshold: number;
    triggered: boolean;
  };
};

type ChatterTriggerEvaluation = {
  enabled: boolean;
  mode: TavilyChatterConfig["enabled"];
  reasons: string[];
  triggers: ChatterTriggerSummary;
};

function resolvePriceContext(
  context: MarketContext,
  marketSignals: MarketSignal[] | undefined
): PriceContext | null {
  if (context.price_context) {
    return context.price_context;
  }
  const signals = marketSignals ?? context.market_signals;
  if (!signals || signals.length === 0) {
    return null;
  }
  const primaryId = context.primary_market_id ?? context.clob_market_id_used;
  let selected =
    primaryId !== undefined
      ? signals.find((signal) => signal.market_id === primaryId)
      : undefined;
  if (!selected && context.clob_token_id_used) {
    selected = signals.find(
      (signal) => signal.token_id === context.clob_token_id_used
    );
  }
  return (selected ?? signals[0])?.price_context ?? null;
}

function normalizeCategory(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

function buildEventKeywords(subjectText: string, fallbackText: string): string {
  const candidate = subjectText || fallbackText || FALLBACK_SUBJECT;
  const limited = limitWords(candidate, MAX_SUBJECT_WORDS);
  return normalizeWhitespace(limited || FALLBACK_SUBJECT);
}

function applyTemplate(
  template: string,
  replacements: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.split(`{${key}}`).join(value);
  }
  return finalizeQuery(result);
}

function buildChatterQueries(
  config: TavilyChatterConfig,
  replacements: Record<string, string>
): TavilyQueryLane[] {
  const seen = new Set<string>();
  const lanes: TavilyQueryLane[] = [];

  for (const query of config.queries) {
    const rendered = applyTemplate(query.template, replacements);
    if (!rendered) {
      continue;
    }
    const key = rendered.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    lanes.push({ lane: "D", query: rendered });
  }

  return lanes.slice(0, 3);
}

function countDisagreementEvidence(candidates: EvidenceCandidate[]): number {
  const conStances = new Set([
    "supports_no",
    "con",
    "contra",
    "against",
    "negative",
    "no"
  ]);
  return candidates.reduce((count, candidate) => {
    const stance = candidate.stance?.trim().toLowerCase();
    if (stance && conStances.has(stance)) {
      return count + 1;
    }
    return count;
  }, 0);
}

function evaluateChatterTriggers(
  context: MarketContext,
  config: TavilyChatterConfig,
  evidenceCandidates: EvidenceCandidate[] | undefined,
  marketSignals: MarketSignal[] | undefined
): ChatterTriggerEvaluation {
  const priceContext = resolvePriceContext(context, marketSignals);
  const change24h = priceContext?.signals.change_24h;
  const oddsAvailable = typeof change24h === "number";
  const changePct = oddsAvailable ? Math.abs(change24h) * 100 : null;
  const oddsTriggered =
    changePct !== null && changePct >= config.triggers.odds_change_24h_pct;

  const category = normalizeCategory(context.category);
  const eligibleCategories = config.triggers.social_categories
    .map((entry) => normalizeCategory(entry))
    .filter((entry): entry is string => Boolean(entry));
  const socialTriggered = Boolean(
    category &&
      eligibleCategories.some(
        (entry) => category === entry || category.includes(entry)
      )
  );

  const disagreementEnabled = config.triggers.disagreement_insufficient;
  const evidenceAvailable = Array.isArray(evidenceCandidates);
  const evidenceCount = evidenceAvailable
    ? countDisagreementEvidence(evidenceCandidates)
    : 0;
  const disagreementTriggered =
    disagreementEnabled &&
    evidenceAvailable &&
    evidenceCount < DISAGREEMENT_MIN_COUNT;

  const reasons: string[] = [];
  if (config.enabled === "always") {
    reasons.push("always");
  } else if (config.enabled === "never") {
    reasons.push("never");
  } else {
    if (oddsTriggered) {
      reasons.push("odds_change_24h");
    }
    if (socialTriggered) {
      reasons.push("social_category");
    }
    if (disagreementTriggered) {
      reasons.push("disagreement_insufficient");
    }
  }

  const enabled =
    config.enabled === "always"
      ? true
      : config.enabled === "never"
        ? false
        : reasons.length > 0;

  return {
    enabled,
    mode: config.enabled,
    reasons,
    triggers: {
      odds_change_24h_pct: {
        available: oddsAvailable,
        value_pct: changePct,
        threshold: config.triggers.odds_change_24h_pct,
        triggered: oddsTriggered
      },
      social_category: {
        available: Boolean(category),
        value: category,
        eligible: eligibleCategories,
        triggered: socialTriggered
      },
      disagreement_insufficient: {
        enabled: disagreementEnabled,
        evidence_available: evidenceAvailable,
        evidence_count: evidenceCount,
        threshold: DISAGREEMENT_MIN_COUNT,
        triggered: disagreementTriggered
      }
    }
  };
}

function buildLaneQueryPlan(context: MarketContext): BaseQueryPlan {
  const textParts = [
    context.title,
    context.description,
    context.resolution_rules_raw,
    context.category
  ].filter(hasText);

  const hasInput = textParts.length > 0 || hasText(context.end_time);
  if (!hasInput) {
    throw createAppError({
      code: ERROR_CODES.STEP_QUERY_PLAN_EMPTY_INPUT,
      message: "Missing inputs for tavily query plan",
      category: "VALIDATION",
      retryable: false,
      details: { event_slug: context.slug }
    });
  }

  const fallbackText = normalizeWhitespace(textParts.join(" "));
  const subjectSource = textParts[0] ?? fallbackText;
  const subjectEntities = extractSubjectEntities(subjectSource);
  const subjectText = subjectEntities.join(" ");
  const actionText = extractAction(fallbackText || subjectSource || "");
  const objectSource =
    [context.description, context.resolution_rules_raw, context.title, context.category].find(
      hasText
    ) ?? "";
  const objectText = extractObject(objectSource, actionText) || FALLBACK_OBJECT;
  const timeAnchor = buildTimeAnchor(context.end_time);

  const topicCore = normalizeWhitespace(
    [
      subjectText || fallbackText || FALLBACK_SUBJECT,
      actionText,
      objectText
    ]
      .filter(Boolean)
      .join(" ")
  );
  const eventKeywords = buildEventKeywords(subjectText, fallbackText);

  const updateQuery = finalizeQuery(
    `${topicCore} latest update ${timeAnchor}`
  );
  const primaryQuery = finalizeQuery(
    `${
      subjectText
        ? `${subjectText} official statement ${objectText}`
        : `${topicCore} official announcement`
    } ${timeAnchor}`
  );
  const counterQuery = finalizeQuery(
    `${topicCore} controversy OR fact check ${timeAnchor}`
  );

  const lanes: TavilyQueryLane[] = [
    { lane: "A", query: updateQuery },
    { lane: "B", query: primaryQuery },
    { lane: "C", query: counterQuery }
  ];

  if (lanes.some((lane) => lane.query.length === 0)) {
    throw createAppError({
      code: ERROR_CODES.STEP_QUERY_PLAN_EMPTY_INPUT,
      message: "Generated empty tavily query",
      category: "VALIDATION",
      retryable: false,
      details: { event_slug: context.slug }
    });
  }

  return { lanes, topic_core: topicCore, event_keywords: eventKeywords };
}

export function buildTavilyQueryPlan(
  input: QueryPlanBuildInput
): QueryPlanBuildOutput {
  const basePlan = buildLaneQueryPlan(input.market_context);
  const config = validateTavilyConfig(input.tavily_config ?? {});
  const chatterConfig = config.lanes.D_chatter;
  const evaluation = evaluateChatterTriggers(
    input.market_context,
    chatterConfig,
    input.evidence_candidates,
    input.market_signals
  );
  const replacements = {
    event_keywords: basePlan.event_keywords,
    topic_core: basePlan.topic_core
  };
  const chatterQueries = evaluation.enabled
    ? buildChatterQueries(chatterConfig, replacements)
    : [];
  const chatterEnabled = evaluation.enabled && chatterQueries.length >= 2;
  const reasons = chatterEnabled
    ? evaluation.reasons
    : evaluation.enabled
      ? [...evaluation.reasons, "queries_insufficient"]
      : evaluation.reasons;

  const lanes = chatterEnabled
    ? [...basePlan.lanes, ...chatterQueries]
    : basePlan.lanes;

  console.info({
    message: "step.query.plan.build",
    step_id: "query.plan.build",
    request_id: input.request_id ?? null,
    run_id: input.run_id ?? null,
    event_slug: input.market_context.slug,
    cache_hit: {},
    rate_limited: {},
    lane_d: {
      enabled: chatterEnabled,
      mode: evaluation.mode,
      reasons,
      query_count: chatterQueries.length,
      triggers: evaluation.triggers
    }
  });

  const query_plan: TavilyQueryPlan = { lanes };
  return { market_context: input.market_context, query_plan };
}

export type { QueryPlanBuildInput, QueryPlanBuildOutput };
