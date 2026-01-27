import OpenAI from "openai";
import { createAppError, ERROR_CODES } from "../../../orchestrator/errors.js";
import type { LLMAdapter } from "../types.js";

type OpenAICompatibleOptions = {
  apiKey?: string;
  baseUrl?: string;
  organization?: string;
  timeoutMs?: number;
};

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_TIMEOUT_MS = 30000;

function parseTimeoutMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function resolveApiKey(options: OpenAICompatibleOptions): string {
  const apiKey = options.apiKey ?? process.env.LLM_API_KEY?.trim();
  if (!apiKey) {
    throw createAppError({
      code: ERROR_CODES.PROVIDER_LLM_NOT_CONFIGURED,
      message: "LLM api key is required",
      category: "LLM",
      retryable: false
    });
  }
  return apiKey;
}

export function createOpenAICompatibleAdapter(
  options: OpenAICompatibleOptions = {}
): LLMAdapter {
  const apiKey = resolveApiKey(options);
  const baseURL = options.baseUrl?.trim() || process.env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const organization =
    options.organization?.trim() || process.env.LLM_ORG?.trim() || undefined;
  const timeoutMs =
    options.timeoutMs ?? parseTimeoutMs(process.env.LLM_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;

  const client = new OpenAI({
    apiKey,
    baseURL,
    organization,
    timeout: timeoutMs
  });

  return {
    async generateJson(prompt, opts) {
      const response = await client.chat.completions.create({
        model: opts.model,
        temperature: opts.temperature,
        messages: [
          { role: "system", content: prompt.system },
          { role: "user", content: prompt.user }
        ],
        response_format: { type: "json_object" }
      });

      const text = response.choices[0]?.message?.content?.trim();
      if (!text) {
        throw createAppError({
          code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID,
          message: "LLM response missing JSON content",
          category: "LLM",
          retryable: false,
          details: {
            model: opts.model,
            base_url: baseURL
          }
        });
      }

      return { text, raw: response };
    }
  };
}

export type { OpenAICompatibleOptions };
