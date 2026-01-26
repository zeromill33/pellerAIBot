import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildPublishPipelineSteps,
  runPublishPipelineSteps,
  type PipelineStepLog,
  type PublishPipelineContext
} from "../../src/orchestrator/pipeline.js";
import { createAppError } from "../../src/orchestrator/errors.js";
import { parseUrlsToSlugs } from "../../src/orchestrator/steps/url.parse.step.js";
import { createGammaProvider } from "../../src/providers/polymarket/gamma.js";
import { createClobProvider } from "../../src/providers/polymarket/clob.js";
import { createPricingProvider } from "../../src/providers/polymarket/pricing.js";

// RUN_E2E=1 启用；TEST_LIVE=1 走真实 provider（需网络/必要密钥，默认走 fixtures）。
// 可选：E2E_EVENT_URL 覆盖 URL，E2E_STOP_STEP 覆盖停止的 step，E2E_FORCE_D=1 强制 D 车道，
// 额外：E2E_EVENT_URL_D 指定“自然触发 D 车道”的 live 用例 URL，E2E_STOP_STEP_D 覆盖停止 step，
// E2E_TOP_MARKETS 控制 market.signals 探测数量（默认 3），
// E2E_SUMMARY_PATH 指定输出摘要文件路径（默认 tests/e2s/tmp/e2e-step-summary.json），
// E2E_SUMMARY_PATH_D 指定 D 车道用例摘要路径（默认 tests/e2e/tmp/e2e-step-summary-dlane.json）。
const describeE2E = process.env.RUN_E2E === "1" ? describe : describe.skip;

type MockResponse = {
  status: number;
  payload: unknown;
};

function createMockResponse(options: MockResponse) {
  return {
    ok: options.status >= 200 && options.status < 300,
    status: options.status,
    json: async () => options.payload,
    headers: {
      get() {
        return null;
      }
    }
  };
}

function loadFixture(path: string) {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/polymarket/${path}`, import.meta.url), "utf-8")
  ) as unknown;
}

function createGammaFixtureProvider() {
  const events = loadFixture("real-events.json");
  const markets = loadFixture("real-markets.json");
  const fetch = async (input: string) => {
    if (input.includes("/events")) {
      return createMockResponse({ status: 200, payload: events });
    }
    if (input.includes("/markets")) {
      return createMockResponse({ status: 200, payload: markets });
    }
    return createMockResponse({ status: 404, payload: { message: "Not found" } });
  };
  return createGammaProvider({
    fetch,
    retries: 0,
    sleep: async () => { },
    now: () => 0
  });
}

function createClobFixtureProvider() {
  const book = loadFixture("fed-chair-clob-book.json");
  const fetch = async () => createMockResponse({ status: 200, payload: book });
  return createClobProvider({
    fetch,
    retries: 0,
    sleep: async () => { },
    now: () => 0
  });
}

function createPricingFixtureProvider() {
  const price = loadFixture("pricing-market-price.json");
  const midpoint = loadFixture("pricing-midpoint.json");
  const history = loadFixture("pricing-history.json");
  const fetch = async (input: string) => {
    if (input.includes("/prices-history")) {
      return createMockResponse({ status: 200, payload: history });
    }
    if (input.includes("/midpoint")) {
      return createMockResponse({ status: 200, payload: midpoint });
    }
    if (input.includes("/price") || input.includes("/prices")) {
      return createMockResponse({ status: 200, payload: price });
    }
    return createMockResponse({ status: 404, payload: { message: "Not found" } });
  };
  return createPricingProvider({
    fetch,
    retries: 0,
    sleep: async () => { },
    now: () => 0
  });
}

function createStepClock(stepMs = 5) {
  let current = 0;
  return () => {
    current += stepMs;
    return current;
  };
}

function resolveEventSlug(url: string): string {
  const parsed = parseUrlsToSlugs([url]);
  const [slug] = parsed.event_slugs;
  if (!slug) {
    throw new Error("Expected valid Polymarket event URL");
  }
  return slug;
}

type StepSummary = {
  step_id: string;
  latency_ms: number;
  error_code?: string;
  error_category?: string;
  result: Record<string, unknown>;
};

function buildStepSummary(
  entry: PipelineStepLog,
  context: PublishPipelineContext
): StepSummary {
  const base = {
    step_id: entry.step_id,
    latency_ms: entry.latency_ms,
    error_code: entry.error_code,
    error_category: entry.error_category
  };

  if (entry.step_id === "market.fetch") {
    const market = context.market_context;
    return {
      ...base,
      result: {
        event_id: market?.event_id ?? null,
        title: market?.title ?? null,
        markets_count: market?.markets?.length ?? 0,
        primary_market_id: market?.primary_market_id ?? null
      }
    };
  }

  if (entry.step_id === "market.signals") {
    const signals = context.market_signals ?? context.market_context?.market_signals ?? [];
    const sample = signals.slice(0, 3).map((signal) => ({
      market_id: signal.market_id,
      token_id: signal.token_id,
      latest_price: signal.price_context.latest_price,
      midpoint_price: signal.price_context.midpoint_price,
      history_warning: signal.price_context.history_warning?.code ?? null
    }));
    return {
      ...base,
      result: {
        signals_count: signals.length,
        sample
      }
    };
  }

  if (entry.step_id === "market.orderbook.fetch") {
    const snapshot = context.clob_snapshot;
    return {
      ...base,
      result: {
        clob_market_id_used: context.market_context?.clob_market_id_used ?? null,
        clob_token_id_used: context.market_context?.clob_token_id_used ?? null,
        spread: snapshot?.spread ?? null,
        midpoint: snapshot?.midpoint ?? null,
        top_levels_count: snapshot?.book_top_levels?.length ?? 0,
        notable_walls_count: snapshot?.notable_walls?.length ?? 0
      }
    };
  }

  if (entry.step_id === "market.liquidity.proxy") {
    const proxy = context.liquidity_proxy;
    return {
      ...base,
      result: {
        gamma_liquidity: proxy?.gamma_liquidity ?? null,
        book_depth_top10: proxy?.book_depth_top10 ?? null,
        spread: proxy?.spread ?? null,
        midpoint: proxy?.midpoint ?? null,
        notable_walls_count: proxy?.notable_walls?.length ?? 0
      }
    };
  }

  if (entry.step_id === "query.plan.build") {
    return {
      ...base,
      result: {
        lanes: context.query_plan?.lanes ?? []
      }
    };
  }

  if (entry.step_id === "search.tavily") {
    return {
      ...base,
      result: {
        tavily_results: context.tavily_results ?? []
      }
    };
  }

  return { ...base, result: {} };
}

function writeSummaryFile(path: string, payload: unknown) {
  const dir = dirname(path);
  if (dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

describeE2E("publish pipeline e2e", () => {
  const defaultUrl =
    process.env.E2E_EVENT_URL ??
    "https://polymarket.com/event/who-will-trump-nominate-as-fed-chair";
  const forceChatter = process.env.E2E_FORCE_D === "1";
  const liveDLaneUrl = process.env.E2E_EVENT_URL_D ?? "";
  const testTimeoutMs =
    process.env.TEST_LIVE === "1" ? (forceChatter ? 60000 : 30000) : 5000;
  const runLiveDLane =
    process.env.TEST_LIVE === "1" && liveDLaneUrl.trim().length > 0;

  function collectClientErrors(entries: unknown[]): unknown[] {
    return entries.filter((entry) => {
      if (!entry || typeof entry !== "object") {
        return false;
      }
      const record = entry as Record<string, unknown>;
      const status = record.status;
      if (typeof status === "number" && status >= 400 && status < 500) {
        return true;
      }
      const errorMessage =
        typeof record.error === "string" ? record.error : undefined;
      return errorMessage ? /responded with 4\d\d/.test(errorMessage) : false;
    });
  }

  it(
    "runs pipeline steps with fake providers and logs summaries",
    async () => {
      const logs: PipelineStepLog[] = [];
      const stepSummaries: StepSummary[] = [];
      const warnings: unknown[] = [];
      const warnSpy = vi.spyOn(console, "warn").mockImplementation((entry) => {
        warnings.push(entry);
      });
      const slug = resolveEventSlug(defaultUrl);
      const clock = createStepClock();
      const useLive = process.env.TEST_LIVE === "1";
      const stopStepId = process.env.E2E_STOP_STEP ?? "market.liquidity.proxy";
      const topMarkets =
        process.env.E2E_TOP_MARKETS && Number.isFinite(Number(process.env.E2E_TOP_MARKETS))
          ? Number(process.env.E2E_TOP_MARKETS)
          : 3;
      try {
      const stepOptions = useLive
          ? {
            gammaProvider: createGammaProvider(),
            clobProvider: createClobProvider(),
            pricingProvider: createPricingProvider(),
            marketSignalsTopMarkets: topMarkets
          }
          : {
            gammaProvider: createGammaFixtureProvider(),
            clobProvider: createClobFixtureProvider(),
            pricingProvider: createPricingFixtureProvider(),
            marketSignalsTopMarkets: topMarkets
          };
        if (forceChatter) {
          stepOptions.tavilyConfig = {
            lanes: {
              D_chatter: {
                enabled: "always"
              }
            }
          };
        }
        const context = await runPublishPipelineSteps(
          {
            request_id: "req_e2e",
            run_id: "run_e2e",
            event_slug: slug
          },
          {
            stopStepId,
            now: clock,
            logStep: (entry, stepContext) => {
              logs.push(entry);
              stepSummaries.push(buildStepSummary(entry, stepContext));
            },
            stepOptions
          }
        );

        expect(context.market_context?.slug).toBe(slug);
        const storageSnapshot = {
          events: [context.market_context],
          evidence: [{ event_slug: slug, items: [] }],
          reports: [{ event_slug: slug, report_json: null }]
        };

        expect(storageSnapshot.events).toHaveLength(1);
        expect(storageSnapshot.evidence).toHaveLength(1);
        expect(storageSnapshot.reports).toHaveLength(1);

        const expectedSteps = buildPublishPipelineSteps(stepOptions)
          .map((step) => step.id)
          .filter((stepId, index, list) => {
            if (!stopStepId) {
              return true;
            }
            const stopIndex = list.indexOf(stopStepId);
            if (stopIndex < 0) {
              return true;
            }
            return index <= stopIndex;
          });
        expect(logs.map((entry) => entry.step_id)).toEqual(expectedSteps);
        for (const entry of logs) {
          expect(entry.request_id).toBe("req_e2e");
          expect(entry.run_id).toBe("run_e2e");
          expect(entry.event_slug).toBe(slug);
          expect(entry.input_keys.length).toBeGreaterThan(0);
          expect(entry.output_keys.length).toBeGreaterThan(0);
          expect(entry.latency_ms).toBeGreaterThanOrEqual(0);
        }
        const summaryPayload = {
          meta: {
            request_id: "req_e2e",
            run_id: "run_e2e",
            event_slug: slug,
            mode: useLive ? "live" : "fake",
            stop_step: stopStepId,
            generated_at: new Date().toISOString()
          },
          steps: stepSummaries
        };
        const summaryPath =
          process.env.E2E_SUMMARY_PATH ?? "tests/e2e/tmp/e2e-step-summary.json";
        writeSummaryFile(summaryPath, summaryPayload);
        for (const summary of stepSummaries) {
          console.info("[e2e][step]", summary.step_id, summary.result);
        }
      } finally {
        warnSpy.mockRestore();
      }

      const clientErrors = collectClientErrors(warnings);
      if (clientErrors.length > 0) {
        throw new Error(
          `Detected 4xx provider responses during E2E: ${JSON.stringify(clientErrors)}`
        );
      }
    },
    testTimeoutMs
  );

  const itLiveDLane = runLiveDLane ? it : it.skip;
  itLiveDLane(
    "runs live pipeline and expects D lane to trigger",
    async () => {
      const logs: PipelineStepLog[] = [];
      const stepSummaries: StepSummary[] = [];
      const slug = resolveEventSlug(liveDLaneUrl);
      const clock = createStepClock();
      const stopStepId = process.env.E2E_STOP_STEP_D ?? "search.tavily";
      const topMarkets =
        process.env.E2E_TOP_MARKETS && Number.isFinite(Number(process.env.E2E_TOP_MARKETS))
          ? Number(process.env.E2E_TOP_MARKETS)
          : 3;

      const context = await runPublishPipelineSteps(
        {
          request_id: "req_e2e_d",
          run_id: "run_e2e_d",
          event_slug: slug
        },
        {
          stopStepId,
          now: clock,
          logStep: (entry, stepContext) => {
            logs.push(entry);
            stepSummaries.push(buildStepSummary(entry, stepContext));
          },
          stepOptions: {
            gammaProvider: createGammaProvider(),
            clobProvider: createClobProvider(),
            pricingProvider: createPricingProvider(),
            marketSignalsTopMarkets: topMarkets
          }
        }
      );

      const lanes = context.query_plan?.lanes ?? [];
      const dLanes = lanes.filter((lane) => lane.lane === "D");
      expect(dLanes.length).toBeGreaterThanOrEqual(2);

      const tavilyResults = context.tavily_results ?? [];
      const hasDLaneResults = tavilyResults.some((lane) => lane.lane === "D");
      if (stopStepId === "search.tavily") {
        expect(hasDLaneResults).toBe(true);
      }

      const summaryPayload = {
        meta: {
          request_id: "req_e2e_d",
          run_id: "run_e2e_d",
          event_slug: slug,
          mode: "live",
          stop_step: stopStepId,
          generated_at: new Date().toISOString()
        },
        steps: stepSummaries
      };
      const summaryPath =
        process.env.E2E_SUMMARY_PATH_D ??
        "tests/e2e/tmp/e2e-step-summary-dlane.json";
      writeSummaryFile(summaryPath, summaryPayload);
      for (const summary of stepSummaries) {
        console.info("[e2e][step][D]", summary.step_id, summary.result);
      }
    },
    testTimeoutMs
  );

  it(
    "captures error logs when a step fails",
    async () => {
      const logs: PipelineStepLog[] = [];
      const slug = resolveEventSlug(defaultUrl);
      const failingProvider = {
        getEventBySlug: async () => {
          throw createAppError({
            code: "PROVIDER_PM_GAMMA_REQUEST_FAILED",
            message: "Gamma provider failed",
            category: "PROVIDER",
            retryable: true,
            suggestion: { action: "retry" }
          });
        }
      };

      await expect(
        runPublishPipelineSteps(
          {
            request_id: "req_e2e_fail",
            run_id: "run_e2e_fail",
            event_slug: slug
          },
          {
            now: createStepClock(),
            logStep: (entry) => logs.push(entry),
            stepOptions: { gammaProvider: failingProvider }
          }
        )
      ).rejects.toMatchObject({ code: "PROVIDER_PM_GAMMA_REQUEST_FAILED" });

      expect(logs).toHaveLength(1);
      expect(logs[0]?.error_code).toBe("PROVIDER_PM_GAMMA_REQUEST_FAILED");
      expect(logs[0]?.error_category).toBe("PROVIDER");
    },
    testTimeoutMs
  );
});
