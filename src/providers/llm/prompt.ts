import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { LlmPromptInput } from "./types.js";

const PROMPT_URL = new URL("../../../prompts/report_v1_generate.prompt.txt", import.meta.url);
const PROMPT_NAME = "report_v1_generate";

type PromptTemplate = {
  system: string;
  user: string;
  prompt_name: string;
  prompt_sha256: string;
};

let cachedTemplate: PromptTemplate | null = null;

function splitPromptSections(raw: string): { system: string; user: string } {
  const systemMarker = "SYSTEM:";
  const userMarker = "USER:";
  const systemIndex = raw.indexOf(systemMarker);
  const userIndex = raw.indexOf(userMarker);
  if (systemIndex < 0 || userIndex < 0 || userIndex <= systemIndex) {
    throw new Error("Prompt file must contain SYSTEM: and USER: sections");
  }
  const system = raw.slice(systemIndex + systemMarker.length, userIndex).trim();
  const user = raw.slice(userIndex + userMarker.length).trim();
  return { system, user };
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "null";
  }
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => stableStringify(item));
    return `[${items.join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map((key) => {
    const encodedKey = JSON.stringify(key);
    const encodedValue = stableStringify(record[key]);
    return `${encodedKey}:${encodedValue}`;
  });
  return `{${entries.join(",")}}`;
}

function loadPromptTemplate(): PromptTemplate {
  if (cachedTemplate) {
    return cachedTemplate;
  }
  const raw = readFileSync(PROMPT_URL, "utf-8");
  const { system, user } = splitPromptSections(raw);
  const prompt_sha256 = createHash("sha256").update(raw).digest("hex");
  cachedTemplate = {
    system,
    user,
    prompt_name: PROMPT_NAME,
    prompt_sha256
  };
  return cachedTemplate;
}

export function buildReportPrompt(input: LlmPromptInput): {
  system: string;
  user: string;
  prompt_name: string;
  prompt_sha256: string;
} {
  const template = loadPromptTemplate();
  const payload = stableStringify(input);
  return {
    system: template.system,
    user: `${template.user}\n\n${payload}`,
    prompt_name: template.prompt_name,
    prompt_sha256: template.prompt_sha256
  };
}

export type { PromptTemplate };
