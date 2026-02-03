import type { OfficialSource } from "../types.js";

type FetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponse>;

type OfficialFetchInput = {
  event_slug: string;
  resolver_url?: string | null;
};

type OfficialFetchOutput = {
  official_sources: OfficialSource[];
  official_sources_error?: string;
};

type OfficialFetchOptions = {
  fetch?: FetchLike;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 8000;
const FALLBACK_PUBLISHED_AT = "1970-01-01T00:00:00Z";

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!match || !match[1]) {
    return null;
  }
  const title = decodeHtmlEntities(match[1]).trim();
  return title.length > 0 ? title : null;
}

function extractPublishedAt(html: string): string | null {
  const patterns = [
    /<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']pubdate["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

async function fetchWithTimeout(
  url: string,
  fetcher: FetchLike,
  timeoutMs: number
): Promise<FetchResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function fetchOfficialSource(
  input: OfficialFetchInput,
  options: OfficialFetchOptions = {}
): Promise<OfficialFetchOutput> {
  if (!input.resolver_url) {
    return {
      official_sources: [],
      official_sources_error: "resolver_url_missing"
    };
  }

  const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);
  try {
    const response = await fetchWithTimeout(
      input.resolver_url,
      fetcher,
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    );
    if (!response.ok) {
      return {
        official_sources: [],
        official_sources_error: `request_failed:${response.status}`
      };
    }
    const body = await response.text();
    if (!body || body.trim().length === 0) {
      return {
        official_sources: [],
        official_sources_error: "empty_body"
      };
    }

    const text = stripHtml(body);
    const snippet = truncate(text, 280);
    const title = extractTitle(body) ?? input.resolver_url;
    const published_at = extractPublishedAt(body) ?? FALLBACK_PUBLISHED_AT;
    const domain = new URL(input.resolver_url).hostname;

    return {
      official_sources: [
        {
          url: input.resolver_url,
          domain,
          title,
          published_at,
          snippet
        }
      ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      official_sources: [],
      official_sources_error: `request_failed:${message}`
    };
  }
}

export type { OfficialFetchInput, OfficialFetchOutput, OfficialFetchOptions };
