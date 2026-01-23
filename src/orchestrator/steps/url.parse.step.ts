import { createAppError, ERROR_CODES } from "../errors.js";
import type { InvalidUrlResult, UrlParseResult } from "../types.js";

const VALID_HOSTS = new Set(["polymarket.com", "www.polymarket.com"]);
const EVENT_SEGMENT = "event";
const SLUG_PATTERN = /^[A-Za-z0-9-]+$/;

function invalidUrlError(input: string) {
  return createAppError({
    code: ERROR_CODES.STEP_URL_PARSE_INVALID_URL,
    message: "Invalid Polymarket event URL",
    category: "VALIDATION",
    retryable: false,
    details: { input }
  });
}

function extractSlug(urlString: string): { slug: string } | { error: InvalidUrlResult } {
  const trimmed = urlString.trim();
  if (!trimmed) {
    return { error: { url: urlString, error: invalidUrlError(urlString) } };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { error: { url: urlString, error: invalidUrlError(urlString) } };
  }

  if (!VALID_HOSTS.has(parsed.hostname.toLowerCase())) {
    return { error: { url: urlString, error: invalidUrlError(urlString) } };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: { url: urlString, error: invalidUrlError(urlString) } };
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length !== 2 || segments[0] !== EVENT_SEGMENT) {
    return { error: { url: urlString, error: invalidUrlError(urlString) } };
  }

  const slugSegment = segments[1];
  if (!slugSegment) {
    return { error: { url: urlString, error: invalidUrlError(urlString) } };
  }

  let slug: string;
  try {
    slug = decodeURIComponent(slugSegment);
  } catch {
    return { error: { url: urlString, error: invalidUrlError(urlString) } };
  }
  if (!slug || !SLUG_PATTERN.test(slug)) {
    return { error: { url: urlString, error: invalidUrlError(urlString) } };
  }

  return { slug };
}

export function parseUrlsToSlugs(urls: string[]): UrlParseResult {
  const eventSlugs: string[] = [];
  const invalidUrls: InvalidUrlResult[] = [];
  const seenUrls = new Set<string>();
  const seenSlugs = new Set<string>();

  for (const rawUrl of urls) {
    const trimmed = rawUrl.trim();
    const dedupeKey = trimmed.toLowerCase();
    if (seenUrls.has(dedupeKey)) {
      continue;
    }
    seenUrls.add(dedupeKey);

    const result = extractSlug(rawUrl);
    if ("error" in result) {
      invalidUrls.push(result.error);
      continue;
    }

    if (seenSlugs.has(result.slug)) {
      continue;
    }
    seenSlugs.add(result.slug);
    eventSlugs.push(result.slug);
  }

  return {
    event_slugs: eventSlugs,
    invalid_urls: invalidUrls
  };
}
