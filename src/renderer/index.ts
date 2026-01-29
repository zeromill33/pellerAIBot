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
