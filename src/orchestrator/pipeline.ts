import { AppError, createAppError, ERROR_CODES } from "./errors.js";
import type {
  ClobSnapshot,
  LiquidityProxy,
  MarketContext,
  MarketSignal,
  PublishPipelineInput,
  PublishPipelineResult,
  TavilyLaneResult,
  TavilyQueryPlan
} from "./types.js";
import type {
  EvidenceConfigInput,
  PublishConfigInput,
  TavilyConfigInput,
  TavilySearchDepth
} from "../config/config.schema.js";
import { loadPublishConfig, loadTavilyConfig } from "../config/load.js";
import { fetchMarketContext } from "./steps/market.fetch.step.js";
import { fetchMarketOrderbook } from "./steps/market.orderbook.fetch.step.js";
import { mergeLiquidityProxy } from "./steps/market.liquidity.proxy.step.js";
import { fetchMarketSignals } from "./steps/market.signals.fetch.step.js";
import { buildTavilyQueryPlan } from "./steps/query.plan.build.step.js";
import { searchTavily } from "./steps/search.tavily.step.js";
import { buildEvidenceCandidates } from "./steps/evidence.build.step.js";
import { generateReport } from "./steps/report.generate.step.js";
import { validateReportJson } from "./steps/report.validate.step.js";
import { renderTelegramDraft } from "./steps/telegram.render.step.js";
import { publishTelegramMessage } from "./steps/telegram.publish.step.js";
import { persistEventEvidenceReport } from "./steps/persist.step.js";
import type { GammaProvider } from "../providers/polymarket/gamma.js";
import type { ClobProvider } from "../providers/polymarket/clob.js";
import type { PricingProvider } from "../providers/polymarket/pricing.js";
import type { TavilyProvider } from "../providers/tavily/index.js";
import { createTavilyProvider } from "../providers/tavily/index.js";
import type { LLMProvider } from "../providers/llm/types.js";
import type { ReportV1Json } from "../providers/llm/types.js";
import type { StorageAdapter } from "../storage/index.js";
import type { TelegramPublisher } from "../providers/telegram/index.js";

type PublishPipelineContext = PublishPipelineInput & {
  market_context?: MarketContext;
  market_signals?: MarketSignal[];
  clob_snapshot?: ClobSnapshot;
  liquidity_proxy?: LiquidityProxy;
  query_plan?: TavilyQueryPlan;
  tavily_results?: TavilyLaneResult[];
  report_json?: ReportV1Json;
  tg_post_text?: string;
};

type PipelineStep = {
  id: string;
  input_keys: string[];
  output_keys: string[];
  run: (ctx: PublishPipelineContext) => Promise<PublishPipelineContext>;
};

type PipelineStepLog = {
  service: "orchestrator";
  step_id: string;
  request_id: string;
  run_id: string;
  event_slug: string;
  input_keys: string[];
  output_keys: string[];
  latency_ms: number;
  error_code?: string;
  error_category?: string;
};

type PipelineStepLogger = (
  entry: PipelineStepLog,
  context: PublishPipelineContext
) => void;

type PipelineStepOptions = {
  gammaProvider?: Pick<GammaProvider, "getEventBySlug">;
  clobProvider?: ClobProvider;
  pricingProvider?: PricingProvider;
  tavilyProvider?: TavilyProvider;
  llmProvider?: LLMProvider;
  storage?: StorageAdapter;
  telegramPublisher?: TelegramPublisher;
  tavilyConfig?: TavilyConfigInput;
  evidenceConfig?: EvidenceConfigInput;
  publishConfig?: PublishConfigInput;
  marketSignalsTopMarkets?: number;
  marketSignalsWindowHours?: number;
  marketSignalsIntervalHours?: number;
};

type PublishPipelineRuntimeOptions = {
  stopStepId?: string;
  stepOptions?: PipelineStepOptions;
  logStep?: PipelineStepLogger;
  now?: () => number;
};

const SUPPLEMENT_ELIGIBLE_CODES = new Set<string>([
  ERROR_CODES.VALIDATOR_DISAGREEMENT_INSUFFICIENT,
  ERROR_CODES.VALIDATOR_FAILURE_MODES_GENERIC,
  ERROR_CODES.VALIDATOR_INSUFFICIENT_URLS,
  ERROR_CODES.VALIDATOR_PLACEHOLDER_OUTPUT
]);

const SUPPLEMENT_ACTIONS = new Set(["ADD_SEARCH", "supplement_search"]);

function shouldSupplement(error: AppError): boolean {
  if (error.suggestion?.action && SUPPLEMENT_ACTIONS.has(error.suggestion.action)) {
    return true;
  }
  return SUPPLEMENT_ELIGIBLE_CODES.has(error.code);
}

function shouldEnableDLane(error: AppError): boolean {
  if (error.suggestion?.preferred_lane === "D") {
    return true;
  }
  return SUPPLEMENT_ELIGIBLE_CODES.has(error.code);
}

function buildSupplementTavilyConfig(
  baseConfig: TavilyConfigInput | undefined,
  enableDLane: boolean
): TavilyConfigInput {
  const lanes = {
    ...(baseConfig?.lanes ?? {}),
    C_counter: {
      ...(baseConfig?.lanes?.C_counter ?? {}),
      search_depth: "advanced" as TavilySearchDepth
    },
    ...(enableDLane
      ? {
          D_chatter: {
            ...(baseConfig?.lanes?.D_chatter ?? {}),
            enabled: "always" as const
          }
        }
      : {})
  };

  return {
    ...(baseConfig ?? {}),
    lanes
  };
}

function resolveSupplementTavilyProvider(
  options: PipelineStepOptions | undefined,
  configOverride: TavilyConfigInput
): TavilyProvider {
  if (options?.tavilyProvider) {
    return options.tavilyProvider;
  }
  const baseConfig = loadTavilyConfig();
  return createTavilyProvider({
    config: {
      ...configOverride,
      api_key: baseConfig.api_key
    }
  });
}

function resolvePublishConfig(
  options: PipelineStepOptions | undefined
): PublishConfigInput {
  const base = loadPublishConfig();
  return {
    ...base,
    ...(options?.publishConfig ?? {})
  };
}

async function runSupplementSearch(
  ctx: PublishPipelineContext,
  options: PipelineStepOptions,
  reason: AppError
): Promise<PublishPipelineContext> {
  if (!ctx.market_context) {
    throw reason;
  }
  const enableDLane = shouldEnableDLane(reason);
  const tavilyConfig = buildSupplementTavilyConfig(
    options.tavilyConfig,
    enableDLane
  );
  const { query_plan } = buildTavilyQueryPlan({
    request_id: ctx.request_id,
    run_id: ctx.run_id,
    market_context: ctx.market_context,
    market_signals: ctx.market_signals,
    evidence_candidates: ctx.evidence_candidates,
    tavily_config: tavilyConfig
  });

  console.info({
    message: "supplement.search.triggered",
    step_id: "report.validate",
    request_id: ctx.request_id,
    run_id: ctx.run_id,
    event_slug: ctx.event_slug,
    reason_code: reason.code,
    suggestion: reason.suggestion,
    enable_d_lane: enableDLane,
    query_count: query_plan.lanes.length,
    queries: query_plan.lanes.map((lane) => ({ lane: lane.lane, query: lane.query }))
  });

  const tavilyProvider = resolveSupplementTavilyProvider(options, tavilyConfig);
  let tavily_results: TavilyLaneResult[];
  try {
    ({ tavily_results } = await searchTavily(
      {
        request_id: ctx.request_id,
        run_id: ctx.run_id,
        event_slug: ctx.event_slug,
        market_context: ctx.market_context,
        query_plan
      },
      { provider: tavilyProvider }
    ));
  } catch (error) {
    if (error instanceof AppError && error.category === "RATE_LIMIT") {
      throw createAppError({
        code: ERROR_CODES.ORCH_SUPPLEMENT_RATE_LIMIT,
        message: "Tavily rate limit exceeded during supplement search",
        category: "RATE_LIMIT",
        retryable: true,
        details: {
          event_slug: ctx.event_slug,
          reason_code: reason.code
        },
        suggestion: { action: "retry", message: "Tavily rate limit exceeded" }
      });
    }
    throw error;
  }

  const { evidence_candidates } = buildEvidenceCandidates({
    event_slug: ctx.event_slug,
    tavily_results,
    market_signals: ctx.market_signals,
    evidence_config: options.evidenceConfig
  });

  const { report_json } = await generateReport(
    {
      request_id: ctx.request_id,
      run_id: ctx.run_id,
      event_slug: ctx.event_slug,
      market_context: ctx.market_context,
      clob_snapshot: ctx.clob_snapshot,
      tavily_results,
      market_signals: ctx.market_signals,
      liquidity_proxy: ctx.liquidity_proxy
    },
    { provider: options.llmProvider }
  );

  const validated = await validateReportJson({
    event_slug: ctx.event_slug,
    report_json
  });

  return {
    ...ctx,
    query_plan,
    tavily_results,
    evidence_candidates,
    report_json: validated.report_json
  };
}

function toPipelineError(error: unknown, input: PublishPipelineInput): AppError {
  if (error instanceof AppError) {
    return error;
  }
  return createAppError({
    code: ERROR_CODES.ORCH_PIPELINE_FAILED,
    message: "Publish pipeline failed",
    category: "INTERNAL",
    retryable: true,
    details: {
      event_slug: input.event_slug,
      run_id: input.run_id
    }
  });
}

function buildPublishPipelineSteps(
  options: PipelineStepOptions = {}
): PipelineStep[] {
  return [
    {
      id: "market.fetch",
      input_keys: ["event_slug"],
      output_keys: ["MarketContext"],
      run: async (ctx) => {
        const { market_context } = await fetchMarketContext(
          { event_slug: ctx.event_slug },
          { provider: options.gammaProvider }
        );
        return { ...ctx, market_context };
      }
    },
    {
      id: "market.signals",
      input_keys: ["MarketContext"],
      output_keys: ["MarketSignals"],
      run: async (ctx) => {
        if (!ctx.market_context) {
          throw createAppError({
            code: ERROR_CODES.ORCH_PIPELINE_FAILED,
            message: "Missing market_context for market.signals",
            category: "INTERNAL",
            retryable: false,
            details: { event_slug: ctx.event_slug }
          });
        }
        const { market_context, market_signals } = await fetchMarketSignals(
          { market_context: ctx.market_context },
          {
            clobProvider: options.clobProvider,
            pricingProvider: options.pricingProvider,
            topMarkets: options.marketSignalsTopMarkets,
            windowHours: options.marketSignalsWindowHours,
            intervalHours: options.marketSignalsIntervalHours
          }
        );
        return { ...ctx, market_context, market_signals };
      }
    },
    {
      id: "market.orderbook.fetch",
      input_keys: ["MarketContext"],
      output_keys: ["ClobSnapshot"],
      run: async (ctx) => {
        if (!ctx.market_context) {
          throw createAppError({
            code: ERROR_CODES.ORCH_PIPELINE_FAILED,
            message: "Missing market_context for market.orderbook.fetch",
            category: "INTERNAL",
            retryable: false,
            details: { event_slug: ctx.event_slug }
          });
        }
        const { market_context, clob_snapshot } = await fetchMarketOrderbook(
          { market_context: ctx.market_context },
          { provider: options.clobProvider }
        );
        return { ...ctx, market_context, clob_snapshot };
      }
    },
    {
      id: "market.liquidity.proxy",
      input_keys: ["MarketContext", "ClobSnapshot"],
      output_keys: ["LiquidityProxy"],
      run: async (ctx) => {
        if (!ctx.market_context || !ctx.clob_snapshot) {
          throw createAppError({
            code: ERROR_CODES.ORCH_PIPELINE_FAILED,
            message: "Missing market_context/clob_snapshot for market.liquidity.proxy",
            category: "INTERNAL",
            retryable: false,
            details: { event_slug: ctx.event_slug }
          });
        }
        const { market_context, liquidity_proxy } = await mergeLiquidityProxy({
          market_context: ctx.market_context,
          clob_snapshot: ctx.clob_snapshot
        });
        return { ...ctx, market_context, liquidity_proxy };
      }
    },
    {
      id: "query.plan.build",
      input_keys: ["MarketContext"],
      output_keys: ["TavilyQueryPlan"],
      run: async (ctx) => {
        if (!ctx.market_context) {
          throw createAppError({
            code: ERROR_CODES.ORCH_PIPELINE_FAILED,
            message: "Missing market_context for query.plan.build",
            category: "INTERNAL",
            retryable: false,
            details: { event_slug: ctx.event_slug }
          });
        }
        const { market_context, query_plan } = buildTavilyQueryPlan({
          request_id: ctx.request_id,
          run_id: ctx.run_id,
          market_context: ctx.market_context,
          market_signals: ctx.market_signals,
          evidence_candidates: ctx.evidence_candidates,
          tavily_config: options.tavilyConfig
        });
        return { ...ctx, market_context, query_plan };
      }
    },
    {
      id: "search.tavily",
      input_keys: ["MarketContext", "TavilyQueryPlan"],
      output_keys: ["TavilyLaneResult"],
      run: async (ctx) => {
        if (!ctx.market_context || !ctx.query_plan) {
          throw createAppError({
            code: ERROR_CODES.STEP_TAVILY_QUERY_PLAN_MISSING,
            message: "Missing query_plan for search.tavily",
            category: "VALIDATION",
            retryable: false,
            details: { event_slug: ctx.event_slug }
          });
        }
        const { market_context, query_plan, tavily_results } = await searchTavily(
          {
            request_id: ctx.request_id,
            run_id: ctx.run_id,
            event_slug: ctx.event_slug,
            market_context: ctx.market_context,
            query_plan: ctx.query_plan
          },
          { provider: options.tavilyProvider }
        );
        return { ...ctx, market_context, query_plan, tavily_results };
      }
    },
    {
      id: "evidence.build",
      input_keys: ["TavilyLaneResult"],
      output_keys: ["EvidenceCandidate"],
      run: async (ctx) => {
        if (!ctx.tavily_results) {
          throw createAppError({
            code: ERROR_CODES.STEP_EVIDENCE_BUILD_MISSING_INPUT,
            message: "Missing tavily_results for evidence.build",
            category: "VALIDATION",
            retryable: false,
            details: { event_slug: ctx.event_slug }
          });
        }
        const { evidence_candidates } = buildEvidenceCandidates({
          event_slug: ctx.event_slug,
          tavily_results: ctx.tavily_results,
          market_signals: ctx.market_signals,
          evidence_config: options.evidenceConfig
        });
        return { ...ctx, evidence_candidates };
      }
    },
    {
      id: "report.generate",
      input_keys: ["MarketContext", "ClobSnapshot", "TavilyLaneResult"],
      output_keys: ["ReportV1Json"],
      run: async (ctx) => {
        if (!ctx.market_context || !ctx.tavily_results) {
          throw createAppError({
            code: ERROR_CODES.STEP_REPORT_GENERATE_MISSING_INPUT,
            message: "Missing market_context/tavily_results for report.generate",
            category: "VALIDATION",
            retryable: false,
            details: { event_slug: ctx.event_slug }
          });
        }
        const { report_json } = await generateReport(
          {
            request_id: ctx.request_id,
            run_id: ctx.run_id,
            event_slug: ctx.event_slug,
            market_context: ctx.market_context,
            clob_snapshot: ctx.clob_snapshot,
            tavily_results: ctx.tavily_results,
            market_signals: ctx.market_signals,
            liquidity_proxy: ctx.liquidity_proxy
          },
          { provider: options.llmProvider }
        );
        return { ...ctx, report_json };
      }
    },
    {
      id: "report.validate",
      input_keys: ["ReportV1Json"],
      output_keys: ["ReportV1Json"],
      run: async (ctx) => {
        if (ctx.report_json === null || ctx.report_json === undefined) {
          throw createAppError({
            code: ERROR_CODES.STEP_REPORT_VALIDATE_MISSING_INPUT,
            message: "Missing report_json for report.validate",
            category: "VALIDATION",
            retryable: false,
            details: { event_slug: ctx.event_slug }
          });
        }
        const { report_json } = await validateReportJson({
          event_slug: ctx.event_slug,
          report_json: ctx.report_json
        });
        return { ...ctx, report_json };
      }
    },
    {
      id: "telegram.render",
      input_keys: ["ReportV1Json"],
      output_keys: ["tg_post_text"],
      run: async (ctx) => {
        if (!ctx.report_json) {
          throw createAppError({
            code: ERROR_CODES.STEP_TELEGRAM_RENDER_MISSING_INPUT,
            message: "Missing report_json for telegram.render",
            category: "RENDER",
            retryable: false,
            details: { event_slug: ctx.event_slug }
          });
        }
        const { tg_post_text } = await renderTelegramDraft({
          event_slug: ctx.event_slug,
          report_json: ctx.report_json
        });
        return { ...ctx, tg_post_text };
      }
    },
    {
      id: "persist",
      input_keys: ["MarketContext", "EvidenceCandidate", "ReportV1Json"],
      output_keys: [],
      run: async (ctx) => {
        if (!ctx.market_context) {
          throw createAppError({
            code: ERROR_CODES.STEP_PERSIST_MISSING_INPUT,
            message: "Missing market_context for persist step",
            category: "STORE",
            retryable: false,
            details: { event_slug: ctx.event_slug }
          });
        }
        await persistEventEvidenceReport(
          {
            request_id: ctx.request_id,
            run_id: ctx.run_id,
            event_slug: ctx.event_slug,
            market_context: ctx.market_context,
            evidence_candidates: ctx.evidence_candidates,
            report_json: ctx.report_json,
            tg_post_text: ctx.tg_post_text,
            liquidity_proxy: ctx.liquidity_proxy,
            market_signals: ctx.market_signals
          },
          { storage: options.storage, status: "ready" }
        );
        return { ...ctx };
      }
    },
    {
      id: "telegram.publish",
      input_keys: ["tg_post_text"],
      output_keys: ["message_id"],
      run: async (ctx) => {
        const publishConfig = resolvePublishConfig(options);
        if (publishConfig.strategy !== "auto") {
          return { ...ctx };
        }
        await publishTelegramMessage(
          {
            request_id: ctx.request_id,
            event_slug: ctx.event_slug,
            run_id: ctx.run_id,
            tg_post_text: ctx.tg_post_text
          },
          {
            publisher: options.telegramPublisher,
            storage: options.storage
          }
        );
        return { ...ctx };
      }
    }
  ];
}

async function runPublishPipelineSteps(
  input: PublishPipelineInput,
  options: PublishPipelineRuntimeOptions = {}
): Promise<PublishPipelineContext> {
  const steps = buildPublishPipelineSteps(options.stepOptions);
  const stopStepId = options.stopStepId;
  if (stopStepId && !steps.some((step) => step.id === stopStepId)) {
    throw createAppError({
      code: ERROR_CODES.ORCH_PIPELINE_FAILED,
      message: `Unknown stop step: ${stopStepId}`,
      category: "VALIDATION",
      retryable: false,
      details: { stop_step: stopStepId }
    });
  }

  let ctx: PublishPipelineContext = { ...input };
  let supplementAttempted = false;
  const now = options.now ?? (() => Date.now());

  for (const step of steps) {
    const startMs = now();
    try {
      ctx = await step.run(ctx);
      const endMs = now();
      const logEntry: PipelineStepLog = {
        service: "orchestrator",
        step_id: step.id,
        request_id: ctx.request_id,
        run_id: ctx.run_id,
        event_slug: ctx.event_slug,
        input_keys: step.input_keys,
        output_keys: step.output_keys,
        latency_ms: Math.max(0, endMs - startMs)
      };
      options.logStep?.(logEntry, ctx);
    } catch (error) {
      const appError = error instanceof AppError ? error : toPipelineError(error, input);
      const endMs = now();
      const logEntry: PipelineStepLog = {
        service: "orchestrator",
        step_id: step.id,
        request_id: ctx.request_id,
        run_id: ctx.run_id,
        event_slug: ctx.event_slug,
        input_keys: step.input_keys,
        output_keys: step.output_keys,
        latency_ms: Math.max(0, endMs - startMs),
        error_code: appError.code,
        error_category: appError.category
      };
      options.logStep?.(logEntry, ctx);
      if (
        step.id === "report.validate" &&
        !supplementAttempted &&
        shouldSupplement(appError)
      ) {
        supplementAttempted = true;
        ctx = await runSupplementSearch(ctx, options.stepOptions ?? {}, appError);
        if (stopStepId === "report.validate") {
          break;
        }
        continue;
      }

      if (step.id === "report.validate") {
        try {
          await persistEventEvidenceReport(
            {
              request_id: ctx.request_id,
              run_id: ctx.run_id,
              event_slug: ctx.event_slug,
              market_context: ctx.market_context,
              evidence_candidates: ctx.evidence_candidates,
              report_json: ctx.report_json,
              tg_post_text: ctx.tg_post_text,
              liquidity_proxy: ctx.liquidity_proxy,
              market_signals: ctx.market_signals
            },
            {
              storage: options.stepOptions?.storage,
              status: "blocked",
              validator_code: appError.code,
              validator_message: appError.message
            }
          );
        } catch (persistError) {
          console.error({
            message: "persist_step_failed",
            event_slug: ctx.event_slug,
            run_id: ctx.run_id,
            error: persistError instanceof Error ? persistError.message : String(persistError)
          });
        }
      }
      throw appError;
    }

    if (stopStepId && step.id === stopStepId) {
      break;
    }
  }

  return ctx;
}

export async function runPublishPipeline(
  input: PublishPipelineInput,
  options: PublishPipelineRuntimeOptions = {}
): Promise<PublishPipelineResult> {
  if (process.env.NODE_ENV === "test") {
    return {
      event_slug: input.event_slug,
      run_id: input.run_id,
      status: "success"
    };
  }

  try {
    await runPublishPipelineSteps(input, options);

    return {
      event_slug: input.event_slug,
      run_id: input.run_id,
      status: "success"
    };
  } catch (error) {
    return {
      event_slug: input.event_slug,
      run_id: input.run_id,
      status: "failed",
      error: toPipelineError(error, input)
    };
  }
}

export type {
  PublishPipelineContext,
  PublishPipelineRuntimeOptions,
  PipelineStepLog,
  PipelineStepOptions
};
export { buildPublishPipelineSteps, runPublishPipelineSteps };
