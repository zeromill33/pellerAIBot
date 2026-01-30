import { readFileSync } from "node:fs";
import type { ReportV1Json } from "../providers/llm/types.js";

const MAX_RULES_LENGTH = 1000;
const TRUNCATION_NOTICE = "（内容过长，已截断；以市场页原文为准）";
const SECTION_SEPARATOR = "\n\n";

let cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (cachedTemplate) {
    return cachedTemplate;
  }
  const templateUrl = new URL("./templates/telegram.md.txt", import.meta.url);
  cachedTemplate = readFileSync(templateUrl, "utf8");
  return cachedTemplate;
}

function truncateResolutionRules(value: string): string {
  if (value.length <= MAX_RULES_LENGTH) {
    return value;
  }
  const trimmed = value.slice(0, MAX_RULES_LENGTH).trimEnd();
  return `${trimmed}\n${TRUNCATION_NOTICE}`;
}

type TemplateData = Record<string, unknown>;

export type RenderTelegramOptions = {
  parseMode?: "Markdown" | "MarkdownV2" | "HTML";
  maxLength?: number;
};

function getPathValue(data: TemplateData, path: string): unknown {
  const tokens: Array<string | number> = [];
  const parts = path.split(".");
  for (const part of parts) {
    const matches = part.matchAll(/([^[\]]+)|\[(\d+)\]/g);
    for (const match of matches) {
      if (match[1]) {
        tokens.push(match[1]);
      } else if (match[2]) {
        tokens.push(Number(match[2]));
      }
    }
  }

  let current: unknown = data;
  for (const token of tokens) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof token === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[token];
      continue;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(1);
}

function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

function isLikelyUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}

function formatValue(value: unknown, options?: RenderTelegramOptions): string {
  if (value === null || value === undefined) {
    return "N/A";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatNumber(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(" / ");
  }
  const result = String(value);
  if (options?.parseMode === "MarkdownV2" && !isLikelyUrl(result)) {
    return escapeMarkdownV2(result);
  }
  return result;
}

function cloneReport(report: ReportV1Json): TemplateData {
  if (typeof structuredClone === "function") {
    return structuredClone(report) as TemplateData;
  }
  return JSON.parse(JSON.stringify(report)) as TemplateData;
}

type CitationEntry = {
  number: number;
  url: string;
  domain: string;
  title: string;
};

function parseDomain(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.trim().toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "unknown";
  }
}

function truncateTitle(title: string, maxLength = 80): string {
  if (title.length <= maxLength) {
    return title;
  }
  return `${title.slice(0, maxLength).trim()}…`;
}

function buildCitations(report: TemplateData): {
  citationMap: Map<string, number>;
  sources: string;
} {
  const citationMap = new Map<string, number>();
  const entries: CitationEntry[] = [];

  const addCitation = (url?: string, title?: string, domain?: string) => {
    if (!url) {
      return;
    }
    const normalizedUrl = url.trim();
    if (!normalizedUrl) {
      return;
    }
    const existing = citationMap.get(normalizedUrl);
    if (existing) {
      return;
    }
    const entryDomain = domain?.trim() || parseDomain(normalizedUrl);
    const entryTitle = truncateTitle(title?.trim() || "来源");
    const number = entries.length + 1;
    citationMap.set(normalizedUrl, number);
    entries.push({ number, url: normalizedUrl, domain: entryDomain, title: entryTitle });
  };

  const context = (report.context ?? {}) as Record<string, unknown>;
  addCitation(context.url as string | undefined, context.title as string | undefined);

  const disagreement = report.disagreement_map as Record<string, unknown> | undefined;
  const pro = (disagreement?.pro as Array<Record<string, unknown>> | undefined) ?? [];
  const con = (disagreement?.con as Array<Record<string, unknown>> | undefined) ?? [];
  [...pro, ...con].forEach((item) =>
    addCitation(
      item.url as string | undefined,
      item.title as string | undefined,
      item.domain as string | undefined
    )
  );

  const sentiment = report.sentiment as Record<string, unknown> | undefined;
  const samples = (sentiment?.samples as Array<Record<string, unknown>> | undefined) ?? [];
  samples.forEach((sample) =>
    addCitation(
      sample.url as string | undefined,
      sample.summary as string | undefined,
      undefined
    )
  );

  const sources = entries
    .map((entry) => `【${entry.number}】${entry.domain} — ${entry.title} — ${entry.url}`)
    .join("\n");

  return { citationMap, sources };
}

function buildTemplateData(report: ReportV1Json): TemplateData {
  const data = cloneReport(report);
  const context = (data.context ?? {}) as Record<string, unknown>;
  const rulesRaw = context.resolution_rules_raw;
  if (typeof rulesRaw === "string") {
    context.resolution_rules_raw = truncateResolutionRules(rulesRaw);
  }
  data.context = context;

  const risk = data.risk_attribution;
  if (Array.isArray(risk)) {
    data.risk_attribution = risk.map((item) => String(item)).join(" / ");
  }

  const { citationMap, sources } = buildCitations(data);
  data.sources = sources;
  const contextCitation = context.url
    ? citationMap.get(String(context.url))
    : undefined;
  context.citation = contextCitation ? `【${contextCitation}】` : "";

  const disagreement = data.disagreement_map as Record<string, unknown> | undefined;
  const pro = (disagreement?.pro as Array<Record<string, unknown>> | undefined) ?? [];
  const con = (disagreement?.con as Array<Record<string, unknown>> | undefined) ?? [];
  [...pro, ...con].forEach((item) => {
    const url = item.url ? String(item.url) : "";
    const number = citationMap.get(url);
    item.citation = number ? `【${number}】` : "";
  });

  const sentiment = data.sentiment as Record<string, unknown> | undefined;
  const samples = (sentiment?.samples as Array<Record<string, unknown>> | undefined) ?? [];
  samples.forEach((sample) => {
    const url = sample.url ? String(sample.url) : "";
    const number = citationMap.get(url);
    sample.citation = number ? `【${number}】` : "";
  });

  return data;
}

function renderTemplate(
  template: string,
  data: TemplateData,
  options?: RenderTelegramOptions
): string {
  return template.replace(/\{([^}]+)\}/g, (_match, path) => {
    const value = getPathValue(data, path.trim());
    return formatValue(value, options);
  });
}

function splitTemplateSections(template: string): string[] {
  const lines = template.split(/\r?\n/);
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith("【") && current.length > 0) {
      sections.push(current.join("\n").trimEnd());
      current = [];
    }
    current.push(line);
  }

  if (current.length > 0) {
    sections.push(current.join("\n").trimEnd());
  }

  return sections.filter((section) => section.trim().length > 0);
}

function splitByMaxLength(sections: string[], maxLength: number): string[] {
  const parts: string[] = [];
  let current = "";

  const flushCurrent = () => {
    if (current.trim().length > 0) {
      parts.push(current.trimEnd());
      current = "";
    }
  };

  const appendSection = (section: string) => {
    if (!current) {
      current = section;
      return;
    }
    const candidate = `${current}${SECTION_SEPARATOR}${section}`;
    if (candidate.length <= maxLength) {
      current = candidate;
      return;
    }
    flushCurrent();
    current = section;
  };

  const splitLongSection = (section: string) => {
    const lines = section.split(/\r?\n/);
    let buffer = "";
    for (const line of lines) {
      const candidate = buffer ? `${buffer}\n${line}` : line;
      if (candidate.length <= maxLength) {
        buffer = candidate;
        continue;
      }
      if (buffer) {
        parts.push(buffer.trimEnd());
        buffer = "";
      }
      if (line.length <= maxLength) {
        buffer = line;
        continue;
      }
      for (let i = 0; i < line.length; i += maxLength) {
        parts.push(line.slice(i, i + maxLength));
      }
    }
    if (buffer.trim().length > 0) {
      parts.push(buffer.trimEnd());
    }
  };

  for (const section of sections) {
    if (section.length > maxLength) {
      flushCurrent();
      splitLongSection(section);
      continue;
    }
    appendSection(section);
  }

  flushCurrent();
  return parts;
}

export function renderTelegramReportParts(
  report: ReportV1Json,
  options: RenderTelegramOptions = {}
): string[] {
  const template = loadTemplate();
  const data = buildTemplateData(report);
  const sections = splitTemplateSections(template).map((section) =>
    renderTemplate(section, data, options)
  );

  if (options.maxLength && options.maxLength > 0) {
    return splitByMaxLength(sections, options.maxLength);
  }

  return sections;
}

export function renderTelegramReport(
  report: ReportV1Json,
  options: RenderTelegramOptions = {}
): string {
  const parts = renderTelegramReportParts(report, options);
  return parts.join(SECTION_SEPARATOR);
}
