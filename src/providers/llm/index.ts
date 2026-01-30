import { createAppError, ERROR_CODES } from "../../orchestrator/errors.js";
import { buildReportPrompt } from "./prompt.js";
import { createOpenAICompatibleAdapter } from "./adapters/openai-compatible.js";
import { postprocessReportV1Json } from "./postprocess.js";
import type {
  LLMAdapter,
  LLMProvider,
  LLMProviderOptions,
  LlmAuditEntry,
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
    tavily_results: input.evidence.tavily_results,
    market_metrics_summary: input.market_metrics_summary
  };
}

function defaultAudit(entry: LlmAuditEntry) {
  console.info("[llm][report_v1]", entry);
}

export function createLLMProvider(options: LLMProviderOptions = {}): LLMProvider {
  return {
    async generateReportV1(input: LlmReportInput): Promise<ReportV1Json> {
      const adapter = resolveAdapter(options.adapter);
      const promptInput = buildPromptInput(input);
      const prompt = buildReportPrompt(promptInput);
      const model = options.model ?? process.env.LLM_MODEL?.trim() ?? DEFAULT_MODEL;
      const temperature =
        options.temperature ??
        parseTemperature(process.env.LLM_TEMPERATURE) ??
        DEFAULT_TEMPERATURE;
      const audit: LlmAuditEntry = {
        prompt_name: prompt.prompt_name,
        prompt_sha256: prompt.prompt_sha256,
        model,
        temperature
      };
      (options.onAudit ?? defaultAudit)(audit);
      const response = await adapter.generateJson(
        { system: prompt.system, user: prompt.user },
        { model, temperature }
      );
      return postprocessReportV1Json(response.text);
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
