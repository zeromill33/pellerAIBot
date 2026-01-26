import { createAppError, ERROR_CODES } from "../errors.js";
import type { MarketContext, TavilyQueryLane, TavilyQueryPlan } from "../types.js";

type QueryPlanBuildInput = {
  market_context: MarketContext;
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

function buildLaneQueryPlan(context: MarketContext): TavilyQueryPlan {
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

  return { lanes };
}

export function buildTavilyQueryPlan(
  input: QueryPlanBuildInput
): QueryPlanBuildOutput {
  const query_plan = buildLaneQueryPlan(input.market_context);
  return { market_context: input.market_context, query_plan };
}

export type { QueryPlanBuildInput, QueryPlanBuildOutput };
