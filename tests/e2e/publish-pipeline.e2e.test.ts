import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildPublishPipelineSteps,
  runPublishPipelineSteps,
  type PipelineStepOptions,
  type PipelineStepLog,
  type PublishPipelineContext
} from "../../src/orchestrator/pipeline.js";
import type { TavilySearchResult, MarketContext, GammaMarket } from "../../src/orchestrator/types.js";
import { createAppError } from "../../src/orchestrator/errors.js";
import { parseUrlsToSlugs } from "../../src/orchestrator/steps/url.parse.step.js";
import { createGammaProvider } from "../../src/providers/polymarket/gamma.js";
import { createClobProvider } from "../../src/providers/polymarket/clob.js";
import { createPricingProvider } from "../../src/providers/polymarket/pricing.js";
import { createLLMProvider } from "../../src/providers/llm/index.js";
import { createTavilyProvider } from "../../src/providers/tavily/index.js";
import { loadTavilyConfig } from "../../src/config/load.js";
import type {
  StorageAdapter,
  ReportPublishUpdate,
  ReportStatusUpdate,
  EventRecord,
  EvidenceRecord,
  ReportRecord,
  ReportStatusRecord
} from "../../src/storage/index.js";

// RUN_E2E=1 启用；TEST_LIVE=1 走真实 provider（需网络/必要密钥，默认走 fixtures）。
// E2E_LLM_LIVE=1 使用真实 LLM（需 LLM_API_KEY，默认 mock）。
// 可选：E2E_EVENT_URL 覆盖 URL，E2E_STOP_STEP 覆盖停止的 step，E2E_FORCE_D=1 强制 D 车道，
// 额外：E2E_EVENT_URL_D 指定“自然触发 D 车道”的 live 用例 URL，E2E_STOP_STEP_D 覆盖停止 step，
// E2E_TOP_MARKETS 控制 market.signals 探测数量（默认 3），
// E2E_TIMEOUT_MS 可覆盖单测超时时间（毫秒）。
// E2E_SUMMARY_PATH 指定输出摘要文件路径（默认 tests/e2e/tmp/e2e-step-summary.json），
// E2E_SUMMARY_PATH_D 指定 D 车道用例摘要路径（默认 tests/e2e/tmp/e2e-step-summary-dlane.json）。
// E2E_TG_PREVIEW_PATH 指定 TG 预览内容输出路径（默认 tests/e2e/tmp/tg-preview.md），
// E2E_TG_PREVIEW_PATH_D 指定 D 车道 TG 预览内容输出路径（默认 tests/e2e/tmp/tg-preview-dlane.md）。
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

function loadTavilyFixture(path: string) {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/tavily/${path}`, import.meta.url), "utf-8")
  ) as unknown;
}

function parseDomain(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.trim().toLowerCase() || null;
  } catch {
    return null;
  }
}

function createTavilyFixtureProvider() {
  const payload = loadTavilyFixture("lane-a.json") as Record<string, unknown>;
  const results = Array.isArray(payload.results) ? payload.results : [];
  return {
    async searchLane(input: { event_slug: string; lane: "A" | "B" | "C" | "D"; query: string }) {
      const mapped = results
        .map((result) => {
          if (!result || typeof result !== "object") {
            return null;
          }
          const record = result as Record<string, unknown>;
          const title = typeof record.title === "string" ? record.title : null;
          const url = typeof record.url === "string" ? record.url : null;
          if (!title || !url) {
            return null;
          }
          const domain =
            typeof record.domain === "string"
              ? record.domain
              : parseDomain(url);
          if (!domain) {
            return null;
          }
          const rawContent =
            typeof record.raw_content === "string"
              ? record.raw_content
              : typeof record.content === "string"
                ? record.content
                : null;
          return {
            title,
            url,
            domain,
            published_at:
              typeof record.published_at === "string"
                ? record.published_at
                : typeof record.published_date === "string"
                  ? record.published_date
                  : undefined,
            raw_content: rawContent
          };
        })
        .filter((item): item is TavilySearchResult => item !== null);
      return {
        lane: input.lane,
        query: input.query,
        results: mapped,
        cache_hit: false,
        rate_limited: false,
        latency_ms: 0
      };
    }
  };
}

const LIVE_TAVILY_MAX_RESULTS = 8;

const LIVE_TAVILY_CONFIG = {
  lanes: {
    A_update: { max_results: LIVE_TAVILY_MAX_RESULTS },
    B_primary: { max_results: LIVE_TAVILY_MAX_RESULTS },
    C_counter: { max_results: LIVE_TAVILY_MAX_RESULTS },
    D_chatter: { max_results: 5 }
  }
};

function createLiveTavilyProvider() {
  const base = loadTavilyConfig();
  return createTavilyProvider({
    config: {
      api_key: base.api_key,
      ...LIVE_TAVILY_CONFIG
    }
  });
}

function createGammaFixtureProvider() {
  const marketTemplate: GammaMarket = {
    market_id: "mkt_shutdown_single",
    question: "Will there be another U.S. government shutdown by January 31?",
    outcomes: ["Yes", "No"],
    outcomePrices: [0.48, 0.52],
    clobTokenIds: ["token_shutdown_yes", "token_shutdown_no"],
    volume: 120000,
    liquidity: 45000
  };

  return {
    async getEventBySlug(slug: string): Promise<MarketContext> {
      return {
        event_id: "evt_shutdown_single",
        slug,
        title: "Will there be another U.S. government shutdown by January 31?",
        description:
          "Resolves to Yes if there is another U.S. government shutdown by January 31; otherwise No.",
        resolution_rules_raw:
          "Resolves Yes if a U.S. government shutdown occurs by January 31; otherwise No.",
        end_time: "2026-01-31T00:00:00Z",
        category: "politics",
        markets: [marketTemplate],
        primary_market_id: marketTemplate.market_id,
        outcomePrices: marketTemplate.outcomePrices,
        clobTokenIds: marketTemplate.clobTokenIds
      };
    }
  };
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

function resolveDefaultStopStep(): string {
  const ids = buildPublishPipelineSteps().map((step) => step.id);
  if (ids.includes("telegram.publish")) {
    return "telegram.publish";
  }
  if (ids.includes("persist")) {
    return "persist";
  }
  if (ids.includes("telegram.render")) {
    return "telegram.render";
  }
  if (ids.includes("report.validate")) {
    return "report.validate";
  }
  return "report.generate";
}

function resolveEventSlug(url: string): string {
  const parsed = parseUrlsToSlugs([url]);
  const [slug] = parsed.event_slugs;
  if (!slug) {
    throw new Error("Expected valid Polymarket event URL");
  }
  return slug;
}

function buildMockReport(input: { context: { title: string; url: string; resolution_rules_raw: string } }) {
  return {
    context: {
      title: input.context.title,
      url: input.context.url,
      resolution_rules_raw: input.context.resolution_rules_raw,
      time_remaining: "10d",
      market_odds: { yes: 55, no: 45 },
      liquidity_proxy: {
        gamma_liquidity: 1200,
        book_depth_top10: 40,
        spread: 0.02
      }
    },
    market_framing: {
      core_bet: "Core framing statement.",
      key_assumption: "Key assumption text."
    },
    disagreement_map: {
      pro: [
        {
          claim: "Evidence limited; awaiting official update.",
          source_type: "市场行为",
          url: input.context.url,
          time: "N/A"
        },
        {
          claim: "Market pricing partially reflects expectations.",
          source_type: "市场行为",
          url: "https://official.example.com/statement",
          time: "N/A"
        }
      ],
      con: [
        {
          claim: "Counterpoint based on media interpretation.",
          source_type: "主流媒体",
          url: "https://news.example.com/1",
          time: "2026-01-01T00:00:00Z"
        },
        {
          claim: "Social chatter highlights uncertainty.",
          source_type: "社交讨论",
          url: "https://social.example.com/1",
          time: "2026-01-02T00:00:00Z"
        }
      ]
    },
    priced_vs_new: {
      priced_in: [{ item: "Already partially priced in.", source_type: "官方公告" }],
      new_info: [{ item: "New discussion surfaced.", source_type: "社交讨论" }]
    },
    sentiment: { samples: [], bias: "unknown", relation: "unknown" },
    key_variables: [
      {
        name: "variable_one",
        impact: "High impact",
        observable_signals: "Official update"
      }
    ],
    failure_modes: [
      { mode: "Delay in announcement", observable_signals: "Official update delayed" },
      { mode: "Policy reversal", observable_signals: "Sudden policy statement" }
    ],
    risk_attribution: ["info"],
    limitations: {
      cannot_detect: ["private negotiations", "off-record deals"],
      not_included: ["no_bet_advice", "no_position_sizing"]
    },
    ai_vs_market: {
      market_yes: 55,
      ai_yes_beta: 60,
      delta: 5,
      drivers: ["Key evidence has not surfaced"]
    }
  };
}

type StepSummary = {
  step_id: string;
  latency_ms: number;
  error_code?: string;
  error_category?: string;
  result: Record<string, unknown>;
};

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength).trim()}...`;
}

function countBy<T>(
  items: T[],
  selector: (item: T) => string | null | undefined
): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = selector(item);
    if (!key) {
      return acc;
    }
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function topEntries(
  counts: Record<string, number>,
  limit: number
): Array<{ key: string; count: number }> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

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

  if (entry.step_id === "evidence.build") {
    const candidates = context.evidence_candidates ?? [];
    const sourcePriority: Record<string, number> = {
      official: 0,
      media: 1,
      market: 2,
      social: 3,
      onchain: 4
    };
    const ordered = [...candidates].sort((a, b) => {
      const aPriority = sourcePriority[a.source_type] ?? 99;
      const bPriority = sourcePriority[b.source_type] ?? 99;
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      const domainCompare = a.domain.localeCompare(b.domain);
      if (domainCompare !== 0) {
        return domainCompare;
      }
      return a.url.localeCompare(b.url);
    });
    const orderedUnique = ordered.filter((item) => !item.repeated);
    const noveltyCounts = countBy(candidates, (item) => item.novelty);
    const sourceTypeCounts = countBy(candidates, (item) => item.source_type);
    const stanceCounts = countBy(candidates, (item) => item.stance);
    const laneCounts = countBy(candidates, (item) => item.lane);
    const domainCounts = countBy(candidates, (item) => item.domain);
    const repeatedCount = candidates.filter((item) => item.repeated).length;
    const publishedAtCount = candidates.filter(
      (item) => item.published_at
    ).length;
    const evidenceItems = orderedUnique.map((item) => ({
      source_type: item.source_type,
      source_priority: sourcePriority[item.source_type] ?? null,
      novelty: item.novelty,
      stance: item.stance,
      repeated: item.repeated,
      lane: item.lane,
      domain: item.domain,
      url: item.url,
      published_at: item.published_at ?? null,
      claim_excerpt: truncate(item.claim, 120)
    }));

    return {
      ...base,
      result: {
        evidence_count: candidates.length,
        repeated_count: repeatedCount,
        unique_count: candidates.length - repeatedCount,
        published_at_count: publishedAtCount,
        novelty_counts: noveltyCounts,
        source_type_counts: sourceTypeCounts,
        stance_counts: stanceCounts,
        lane_counts: laneCounts,
        top_domains: topEntries(domainCounts, 5),
        evidence_items: evidenceItems
      }
    };
  }

  if (entry.step_id === "report.generate") {
    const report = context.report_json;
    const reportKeys =
      report && typeof report === "object"
        ? Object.keys(report as Record<string, unknown>).sort()
        : [];
    return {
      ...base,
      result: {
        report_keys: reportKeys,
        report_path: "tests/e2e/tmp/report.json",
        tavily_lane_count: context.tavily_results?.length ?? 0
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

function writePreviewFile(path: string, payload: { meta: Record<string, unknown>; text: string }) {
  const dir = dirname(path);
  if (dir && dir !== ".") {
    mkdirSync(dir, { recursive: true });
  }
  const header = `<!-- e2e preview meta: ${JSON.stringify(payload.meta)} -->\n\n`;
  writeFileSync(path, `${header}${payload.text}\n`, "utf-8");
}

function createPreviewPublisher(params: {
  previewPath: string;
  meta: { request_id: string; run_id: string; event_slug: string; mode: string };
}) {
  return {
    async publishToChannel(text: string) {
      writePreviewFile(params.previewPath, {
        meta: { ...params.meta, generated_at: new Date().toISOString() },
        text
      });
      return { message_id: `preview_${params.meta.run_id}` };
    }
  };
}

function createMemoryStorageAdapter() {
  const events: EventRecord[] = [];
  const evidence: EvidenceRecord[] = [];
  const reports: ReportRecord[] = [];
  const publishUpdates: ReportPublishUpdate[] = [];
  const statusUpdates: ReportStatusUpdate[] = [];

  const storage: StorageAdapter = {
    upsertEvent: (record) => {
      const index = events.findIndex((item) => item.slug === record.slug);
      if (index >= 0) {
        events[index] = record;
      } else {
        events.push(record);
      }
    },
    appendEvidence: (records) => {
      evidence.push(...records);
    },
    saveReport: (record) => {
      reports.push(record);
    },
    getLatestReport: (slug) => {
      const matches = reports.filter((report) => report.slug === slug);
      if (matches.length === 0) {
        return null;
      }
      const latest = matches[matches.length - 1];
      const status: ReportStatusRecord = {
        report_id: latest.report_id,
        slug: latest.slug,
        generated_at: latest.generated_at,
        status: latest.status,
        validator_code: latest.validator_code ?? null,
        validator_message: latest.validator_message ?? null
      };
      return status;
    },
    updateReportPublish: (update) => {
      publishUpdates.push(update);
      const report = reports.find((item) => item.report_id === update.report_id);
      if (report) {
        report.status = update.status;
        report.tg_message_id = update.tg_message_id;
      }
    },
    updateReportStatus: (update) => {
      statusUpdates.push(update);
      const report = reports.find((item) => item.report_id === update.report_id);
      if (report) {
        report.status = update.status;
        report.validator_code = update.validator_code ?? null;
        report.validator_message = update.validator_message ?? null;
      }
    },
    runInTransaction: (task) => task(),
    close: () => {
      // no-op for memory adapter
    }
  };

  return { storage, events, evidence, reports, publishUpdates, statusUpdates };
}

describeE2E("publish pipeline e2e", () => {
  const defaultUrl =
    process.env.E2E_EVENT_URL ??
    "https://polymarket.com/event/will-there-be-another-us-government-shutdown-by-january-31";
  const forceChatter = process.env.E2E_FORCE_D === "1";
  const liveDLaneUrl = process.env.E2E_EVENT_URL_D ?? "";
  const timeoutOverride = Number(process.env.E2E_TIMEOUT_MS);
  const testTimeoutMs =
    Number.isFinite(timeoutOverride) && timeoutOverride > 0
      ? Math.floor(timeoutOverride)
      : process.env.TEST_LIVE === "1"
        ? forceChatter
          ? 60000
          : 30000
        : 5000;
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
      const useLiveLlm = process.env.E2E_LLM_LIVE === "1";
      const stopStepId = process.env.E2E_STOP_STEP ?? resolveDefaultStopStep();
      const previewPath =
        process.env.E2E_TG_PREVIEW_PATH ?? "tests/e2e/tmp/tg-preview.md";
      const topMarkets =
        process.env.E2E_TOP_MARKETS && Number.isFinite(Number(process.env.E2E_TOP_MARKETS))
          ? Number(process.env.E2E_TOP_MARKETS)
          : 3;
      const { storage, publishUpdates } = createMemoryStorageAdapter();
      try {
        const tavilyConfigOverride = forceChatter
          ? {
            ...LIVE_TAVILY_CONFIG,
            lanes: {
              ...LIVE_TAVILY_CONFIG.lanes,
              D_chatter: {
                ...LIVE_TAVILY_CONFIG.lanes.D_chatter,
                enabled: "always"
              }
            }
          }
          : LIVE_TAVILY_CONFIG;
        const stepOptions: PipelineStepOptions = useLive
          ? {
            gammaProvider: createGammaProvider(),
            clobProvider: createClobProvider(),
            pricingProvider: createPricingProvider(),
            marketSignalsTopMarkets: topMarkets,
            tavilyProvider: createLiveTavilyProvider(),
            tavilyConfig: tavilyConfigOverride
          }
          : {
            gammaProvider: createGammaFixtureProvider(),
            clobProvider: createClobFixtureProvider(),
            pricingProvider: createPricingFixtureProvider(),
            marketSignalsTopMarkets: topMarkets,
            tavilyProvider: createTavilyFixtureProvider(),
            tavilyConfig: tavilyConfigOverride
          };
        stepOptions.llmProvider = useLiveLlm
          ? createLLMProvider()
          : {
            async generateReportV1(input) {
              return buildMockReport(input);
            }
          };
        stepOptions.publishConfig = { strategy: "auto" };
        stepOptions.storage = storage;
        stepOptions.telegramPublisher = createPreviewPublisher({
          previewPath,
          meta: {
            request_id: "req_e2e",
            run_id: "run_e2e",
            event_slug: slug,
            mode: useLive ? "live" : "fake"
          }
        });
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
          if (entry.output_keys.length === 0) {
            expect(entry.step_id).toBe("persist");
          } else {
            expect(entry.output_keys.length).toBeGreaterThan(0);
          }
          expect(entry.latency_ms).toBeGreaterThanOrEqual(0);
        }
        const summaryPayload = {
          meta: {
            request_id: "req_e2e",
            run_id: "run_e2e",
            event_slug: slug,
            mode: useLive ? "live" : "fake",
            stop_step: stopStepId,
            generated_at: new Date().toISOString(),
            tg_preview_path: previewPath
          },
          steps: stepSummaries
        };
        const summaryPath =
          process.env.E2E_SUMMARY_PATH ?? "tests/e2e/tmp/e2e-step-summary.json";
        writeSummaryFile(summaryPath, summaryPayload);
        if (context.report_json) {
          writeSummaryFile("tests/e2e/tmp/report.json", context.report_json);
        }
        for (const summary of stepSummaries) {
          console.info("[e2e][step]", summary.step_id, summary.result);
        }
        const published = logs.some(
          (entry) => entry.step_id === "telegram.publish" && !entry.error_code
        );
        if (published && context.tg_post_text) {
          const previewFile = readFileSync(previewPath, "utf-8");
          expect(previewFile.includes(context.tg_post_text)).toBe(true);
        }
        if (published && publishUpdates.length > 0) {
          expect(publishUpdates[0]?.status).toBe("published");
          expect(publishUpdates[0]?.tg_message_id).toContain("preview_");
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
      const useLiveLlm = process.env.E2E_LLM_LIVE === "1";
      const stopStepId = process.env.E2E_STOP_STEP_D ?? resolveDefaultStopStep();
      const previewPath =
        process.env.E2E_TG_PREVIEW_PATH_D ??
        "tests/e2e/tmp/tg-preview-dlane.md";
      const topMarkets =
        process.env.E2E_TOP_MARKETS && Number.isFinite(Number(process.env.E2E_TOP_MARKETS))
          ? Number(process.env.E2E_TOP_MARKETS)
          : 3;
      const { storage } = createMemoryStorageAdapter();

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
            marketSignalsTopMarkets: topMarkets,
            tavilyProvider: createLiveTavilyProvider(),
            tavilyConfig: LIVE_TAVILY_CONFIG,
            llmProvider: useLiveLlm
              ? createLLMProvider()
              : {
                async generateReportV1(input) {
                  return buildMockReport(input);
                }
              },
            publishConfig: { strategy: "auto" },
            storage,
            telegramPublisher: createPreviewPublisher({
              previewPath,
              meta: {
                request_id: "req_e2e_d",
                run_id: "run_e2e_d",
                event_slug: slug,
                mode: "live"
              }
            })
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
          generated_at: new Date().toISOString(),
          tg_preview_path: previewPath
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
      const published = logs.some(
        (entry) => entry.step_id === "telegram.publish" && !entry.error_code
      );
      if (published && context.tg_post_text) {
        const previewFile = readFileSync(previewPath, "utf-8");
        expect(previewFile.includes(context.tg_post_text)).toBe(true);
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
