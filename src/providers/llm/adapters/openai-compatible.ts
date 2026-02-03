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
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_RETRY_MAX_MS = 5000;

type OpenAIErrorLike = {
  status?: number;
  message?: string;
  code?: string | null;
  type?: string;
  requestID?: string | null;
  headers?: Headers;
  name?: string;
};

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

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.floor(parsed);
}

function parseRetryAfterMs(headers?: Headers | null): number | undefined {
  if (!headers) {
    return undefined;
  }
  const value = headers.get("retry-after");
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.floor(seconds * 1000);
  }
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    const delta = parsed - Date.now();
    return delta > 0 ? delta : undefined;
  }
  return undefined;
}

function isRetryableStatus(status?: number): boolean {
  if (!status) {
    return true;
  }
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  const record = error as OpenAIErrorLike | null;
  if (record?.status) {
    return isRetryableStatus(record.status);
  }
  const name = record?.name ?? "";
  if (name.includes("APIConnectionError") || name.includes("APIConnectionTimeoutError")) {
    return true;
  }
  const message = record?.message ?? "";
  return /timeout|timed out|connection/i.test(message);
}

function isJsonModeUnsupported(error: unknown): boolean {
  const record = error as OpenAIErrorLike | null;
  const status = record?.status;
  if (status && status !== 400 && status !== 422) {
    return false;
  }
  const message = record?.message ?? "";
  return /response_format|json_schema|json_object|unsupported.*json/i.test(message);
}

function backoffDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  const expo = Math.min(maxMs, baseMs * 2 ** attempt);
  const jitter = Math.floor(Math.random() * baseMs);
  return Math.min(maxMs, expo + jitter);
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
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
  const maxRetries =
    parsePositiveInt(process.env.LLM_RETRIES) ?? DEFAULT_RETRIES;
  const retryBaseMs =
    parsePositiveInt(process.env.LLM_RETRY_BASE_MS) ?? DEFAULT_RETRY_BASE_MS;
  const retryMaxMs =
    parsePositiveInt(process.env.LLM_RETRY_MAX_MS) ?? DEFAULT_RETRY_MAX_MS;
  const allowJsonFallback = process.env.LLM_JSON_MODE_FALLBACK !== "0";
  const forceJsonMode = process.env.LLM_JSON_MODE !== "0";

  const client = new OpenAI({
    apiKey,
    baseURL,
    organization,
    timeout: timeoutMs
  });

  return {
    async generateJson(prompt, opts) {
      let useJsonMode = forceJsonMode;
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        try {
          const response = await client.chat.completions.create({
            model: opts.model,
            temperature: opts.temperature,
            messages: [
              { role: "system", content: prompt.system },
              { role: "user", content: prompt.user }
            ],
            ...(useJsonMode ? { response_format: { type: "json_object" } } : {})
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
        } catch (error) {
          lastError = error;
          if (useJsonMode && allowJsonFallback && isJsonModeUnsupported(error)) {
            useJsonMode = false;
            continue;
          }

          if (isRetryableError(error) && attempt < maxRetries) {
            const record = error as OpenAIErrorLike | null;
            const retryAfter = parseRetryAfterMs(record?.headers);
            const delayMs =
              retryAfter ?? backoffDelayMs(attempt, retryBaseMs, retryMaxMs);
            await sleep(delayMs);
            continue;
          }

          const record = error as OpenAIErrorLike | null;
          throw createAppError({
            code: ERROR_CODES.PROVIDER_LLM_REQUEST_FAILED,
            message: record?.message ?? "LLM request failed",
            category: "LLM",
            retryable: isRetryableError(error),
            details: {
              model: opts.model,
              base_url: baseURL,
              status: record?.status,
              code: record?.code,
              type: record?.type,
              request_id: record?.requestID
            }
          });
        }
      }

      throw createAppError({
        code: ERROR_CODES.PROVIDER_LLM_REQUEST_FAILED,
        message: "LLM request failed",
        category: "LLM",
        retryable: isRetryableError(lastError),
        details: {
          model: opts.model,
          base_url: baseURL
        }
      });
    }
  };
}

export type { OpenAICompatibleOptions };
