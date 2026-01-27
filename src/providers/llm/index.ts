import { createAppError, ERROR_CODES } from "../../orchestrator/errors.js";
import { buildReportPrompt } from "./prompt.js";
import { createOpenAICompatibleAdapter } from "./adapters/openai-compatible.js";
import type {
  LLMAdapter,
  LLMProvider,
  LLMProviderOptions,
  LlmPromptInput,
  LlmReportInput,
  ReportV1Json
} from "./types.js";

const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_TEMPERATURE = 0;

function parseTemperature(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function resolveAdapter(adapter: LLMAdapter | undefined): LLMAdapter {
  if (adapter) {
    return adapter;
  }
  const apiKey = process.env.LLM_API_KEY?.trim();
  if (!apiKey) {
    throw createAppError({
      code: ERROR_CODES.PROVIDER_LLM_NOT_CONFIGURED,
      message: "LLM adapter not configured",
      category: "LLM",
      retryable: false
    });
  }
  return createOpenAICompatibleAdapter({ apiKey });
}

function buildPromptInput(input: LlmReportInput): LlmPromptInput {
  return {
    market_context: input.context,
    clob_snapshot: input.clob ?? null,
    tavily_results: input.evidence.tavily_results
  };
}

export function createLLMProvider(options: LLMProviderOptions = {}): LLMProvider {
  return {
    async generateReportV1(input: LlmReportInput): Promise<ReportV1Json> {
      const adapter = resolveAdapter(options.adapter);
      const promptInput = buildPromptInput(input);
      const prompt = buildReportPrompt(promptInput);
      const response = await adapter.generateJson(
        { system: prompt.system, user: prompt.user },
        {
          model:
            options.model ??
            process.env.LLM_MODEL?.trim() ??
            DEFAULT_MODEL,
          temperature:
            options.temperature ??
            parseTemperature(process.env.LLM_TEMPERATURE) ??
            DEFAULT_TEMPERATURE
        }
      );
      try {
        return JSON.parse(response.text) as ReportV1Json;
      } catch (error) {
        throw createAppError({
          code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID,
          message: "LLM response is not valid JSON",
          category: "LLM",
          retryable: false,
          details: {
            error: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }
  };
}

export type {
  LLMAdapter,
  LLMProvider,
  LLMProviderOptions,
  LlmPromptInput,
  LlmReportInput,
  ReportV1Json
};
export { createOpenAICompatibleAdapter } from "./adapters/openai-compatible.js";
