import type { ResolutionStructured } from "../types.js";

type ResolutionParseInput = {
  event_slug: string;
  resolution_rules_raw: string | undefined;
  resolution_source_raw?: string | null;
};

type ResolutionParseOutput = {
  resolution_structured: ResolutionStructured;
};

const URL_PATTERN = /https?:\/\/[^\s)]+/gi;
const TIMEZONE_SUFFIX = /\s*(ET|EST|EDT|UTC|GMT)$/i;

function normalizeUrl(url: string): string {
  return url.replace(/[),.;]+$/, "");
}

function extractUrls(text?: string | null): string[] {
  if (!text) {
    return [];
  }
  const matches = text.match(URL_PATTERN) ?? [];
  return matches.map((url) => normalizeUrl(url));
}

function extractResolverUrl(
  resolutionSourceRaw?: string | null,
  resolutionRulesRaw?: string | null
): string | null {
  const sourceUrls = extractUrls(resolutionSourceRaw);
  if (sourceUrls.length > 0) {
    return sourceUrls[0] ?? null;
  }
  const ruleUrls = extractUrls(resolutionRulesRaw);
  return ruleUrls[0] ?? null;
}

function normalizeDateString(raw: string): string {
  return raw.replace(TIMEZONE_SUFFIX, "").trim();
}

function extractDeadlineTs(text: string): number | null {
  const patterns = [
    /(?:by|before|until)\s+([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}(?:[,\s]+\d{1,2}:\d{2}\s*(?:AM|PM)?(?:\s*(?:ET|EST|EDT|UTC|GMT))?)?)/i,
    /(?:by|before|until)\s+(\d{4}-\d{2}-\d{2}[^\.\n]*)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match || !match[1]) {
      continue;
    }
    const normalized = normalizeDateString(match[1]);
    const parsed = Date.parse(normalized);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

function extractExclusions(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  return sentences.filter((sentence) => {
    const lowered = sentence.toLowerCase();
    return (
      lowered.includes("will not count") ||
      lowered.includes("does not count") ||
      lowered.includes("will not be considered") ||
      lowered.includes("excluded") ||
      lowered.includes("excluding")
    );
  });
}

function extractPartialShutdownCounts(text: string): boolean | null {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
  const target = sentences.find((sentence) =>
    sentence.toLowerCase().includes("partial shutdown")
  );
  if (!target) {
    return null;
  }
  const lowered = target.toLowerCase();
  if (lowered.includes("will not count") || lowered.includes("does not count")) {
    return false;
  }
  if (lowered.includes("will count") || lowered.includes("counts")) {
    return true;
  }
  return null;
}

function buildParseError(parts: {
  deadline_ts: number | null;
  resolver_url: string | null;
  partial_shutdown_counts: boolean | null;
  exclusions: string[];
}): string | undefined {
  const missing: string[] = [];
  if (!parts.deadline_ts) {
    missing.push("deadline_ts_missing");
  }
  if (!parts.resolver_url) {
    missing.push("resolver_url_missing");
  }
  if (parts.partial_shutdown_counts === null) {
    missing.push("partial_shutdown_counts_unknown");
  }
  if (parts.exclusions.length === 0) {
    missing.push("exclusions_empty");
  }
  if (missing.length === 0) {
    return undefined;
  }
  return missing.join("; ");
}

export async function parseResolutionRules(
  input: ResolutionParseInput
): Promise<ResolutionParseOutput> {
  const rules = input.resolution_rules_raw ?? "";
  const resolver_url = extractResolverUrl(input.resolution_source_raw, rules);
  const deadline_ts = rules ? extractDeadlineTs(rules) : null;
  const exclusions = rules ? extractExclusions(rules) : [];
  const partial_shutdown_counts = rules ? extractPartialShutdownCounts(rules) : null;
  const parse_error = buildParseError({
    deadline_ts,
    resolver_url,
    partial_shutdown_counts,
    exclusions
  });
  const baseStructured: ResolutionStructured = {
    deadline_ts,
    resolver_url,
    partial_shutdown_counts,
    exclusions
  };

  return {
    resolution_structured: {
      ...baseStructured,
      ...(parse_error ? { parse_error } : {})
    }
  };
}

export type { ResolutionParseInput, ResolutionParseOutput };
