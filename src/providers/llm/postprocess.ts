import { createAppError, ERROR_CODES } from "../../orchestrator/errors.js";
import type { ReportV1Json } from "./types.js";

const REQUIRED_TOP_LEVEL_KEYS = [
  "context",
  "market_framing",
  "disagreement_map",
  "priced_vs_new",
  "sentiment",
  "key_variables",
  "failure_modes",
  "risk_attribution",
  "limitations",
  "ai_vs_market"
] as const;
const REQUIRED_TOP_LEVEL_KEY_SET = new Set<string>(REQUIRED_TOP_LEVEL_KEYS);

const ALLOWED_SOURCE_TYPES = new Set([
  "官方公告",
  "主流媒体",
  "社交讨论",
  "链上数据",
  "市场行为"
]);

const ALLOWED_RISK_ATTRIBUTION = new Set([
  "info",
  "interpretation",
  "time",
  "market_structure",
  "political landscape"
]);

const RISK_ATTRIBUTION_ALIASES = new Map<string, string>([
  ["political dynamics", "political landscape"],
  ["political environment", "political landscape"],
  ["political risk", "political landscape"]
]);

const REQUIRED_NOT_INCLUDED = ["no_bet_advice", "no_position_sizing"] as const;
const CALL_TO_ACTION_PATTERNS: RegExp[] = [
  /买入|卖出|做多|做空|加仓|减仓|止损|止盈|下注|押注|梭哈|仓位管理|资金管理/,
  /\b(buy|sell|long|short|go long|go short|bet|wager|stop loss|take profit|position sizing|position size|all in)\b/i
];

type ReportObject = Record<string, unknown>;

function invalid(message: string, details?: Record<string, unknown>): never {
  throw createAppError({
    code: ERROR_CODES.PROVIDER_LLM_RESPONSE_INVALID,
    message,
    category: "LLM",
    retryable: false,
    details
  });
}

function expectObject(value: unknown, path: string): ReportObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid(`Expected object at ${path}`, { path });
  }
  return value as ReportObject;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    invalid(`Expected array at ${path}`, { path });
  }
  return value;
}

function expectNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(`Expected non-empty string at ${path}`, { path });
  }
  return value;
}

function assertNoCallToAction(text: string, path: string) {
  for (const pattern of CALL_TO_ACTION_PATTERNS) {
    if (pattern.test(text)) {
      invalid("Call-to-action language detected", { path, text });
    }
  }
}

function expectNumberInRange(
  value: unknown,
  min: number,
  max: number,
  path: string
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(`Expected number at ${path}`, { path });
  }
  if (value < min || value > max) {
    invalid(`Value out of range at ${path}`, { path, min, max, value });
  }
  return value;
}

function expectNullableNumber(value: unknown, min: number, path: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(`Expected number or null at ${path}`, { path });
  }
  if (value < min) {
    invalid(`Value out of range at ${path}`, { path, min, value });
  }
  return value;
}

function parseJsonStrict(text: string): unknown {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  if (!cleaned.startsWith("{") || !cleaned.endsWith("}")) {
    invalid("LLM response must be pure JSON object");
  }
  try {
    const parsed = JSON.parse(cleaned) as unknown;
    if (typeof parsed === "string") {
      const inner = parsed.trim();
      if (inner.startsWith("{") && inner.endsWith("}")) {
        return JSON.parse(inner) as unknown;
      }
    }
    return parsed;
  } catch (error) {
    invalid("LLM response is not valid JSON", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function validateTopLevel(report: ReportObject) {
  const keys = Object.keys(report);
  const missing = REQUIRED_TOP_LEVEL_KEYS.filter((key) => !(key in report));
  const extra = keys.filter((key) => !REQUIRED_TOP_LEVEL_KEY_SET.has(key));
  if (missing.length > 0 || extra.length > 0) {
    invalid("Report JSON top-level keys mismatch", { missing, extra });
  }
}

function validateContext(report: ReportObject) {
  const context = expectObject(report.context, "context");
  expectNonEmptyString(context.title, "context.title");
  expectNonEmptyString(context.url, "context.url");
  expectNonEmptyString(context.resolution_rules_raw, "context.resolution_rules_raw");
  expectNonEmptyString(context.time_remaining, "context.time_remaining");
  const odds = expectObject(context.market_odds, "context.market_odds");
  expectNumberInRange(odds.yes, 0, 100, "context.market_odds.yes");
  expectNumberInRange(odds.no, 0, 100, "context.market_odds.no");
  const liquidity = expectObject(context.liquidity_proxy, "context.liquidity_proxy");
  expectNullableNumber(
    liquidity.gamma_liquidity,
    0,
    "context.liquidity_proxy.gamma_liquidity"
  );
  expectNullableNumber(
    liquidity.book_depth_top10,
    0,
    "context.liquidity_proxy.book_depth_top10"
  );
  expectNullableNumber(
    liquidity.spread,
    0,
    "context.liquidity_proxy.spread"
  );
}

function validateAiVsMarket(report: ReportObject) {
  const aiVsMarket = expectObject(report.ai_vs_market, "ai_vs_market");
  expectNumberInRange(aiVsMarket.market_yes, 0, 100, "ai_vs_market.market_yes");
  expectNumberInRange(aiVsMarket.ai_yes_beta, 0, 100, "ai_vs_market.ai_yes_beta");
  expectNumberInRange(aiVsMarket.delta, -100, 100, "ai_vs_market.delta");
  const drivers = expectArray(aiVsMarket.drivers, "ai_vs_market.drivers");
  if (drivers.length < 1 || drivers.length > 3) {
    invalid("ai_vs_market.drivers must be length 1-3", {
      path: "ai_vs_market.drivers"
    });
  }
  drivers.forEach((driver, index) => {
    const text = expectNonEmptyString(driver, `ai_vs_market.drivers[${index}]`);
    assertNoCallToAction(text, `ai_vs_market.drivers[${index}]`);
  });
}

function validateDisagreement(report: ReportObject) {
  const disagreement = expectObject(report.disagreement_map, "disagreement_map");
  const pro = expectArray(disagreement.pro, "disagreement_map.pro");
  const con = expectArray(disagreement.con, "disagreement_map.con");
  if (pro.length < 2 || con.length < 2) {
    invalid("disagreement_map requires at least 2 pro/con items", {
      pro: pro.length,
      con: con.length
    });
  }
  [...pro, ...con].forEach((item, index) => {
    const entry = expectObject(item, `disagreement_map.item[${index}]`);
    expectNonEmptyString(entry.claim, `disagreement_map.item[${index}].claim`);
    expectNonEmptyString(entry.source_type, `disagreement_map.item[${index}].source_type`);
    expectNonEmptyString(entry.url, `disagreement_map.item[${index}].url`);
    expectNonEmptyString(entry.time, `disagreement_map.item[${index}].time`);
  });
}

function validatePricedVsNew(report: ReportObject) {
  const pricedVsNew = expectObject(report.priced_vs_new, "priced_vs_new");
  const pricedIn = expectArray(pricedVsNew.priced_in, "priced_vs_new.priced_in");
  const newInfo = expectArray(pricedVsNew.new_info, "priced_vs_new.new_info");
  const allItems = [...pricedIn, ...newInfo];
  allItems.forEach((item, index) => {
    const entry = expectObject(item, `priced_vs_new.item[${index}]`);
    const sourceType = expectNonEmptyString(
      entry.source_type,
      `priced_vs_new.item[${index}].source_type`
    );
    if (!ALLOWED_SOURCE_TYPES.has(sourceType)) {
      invalid("priced_vs_new.source_type invalid", {
        source_type: sourceType
      });
    }
  });
}

function validateFailureModes(report: ReportObject) {
  const failureModes = expectArray(report.failure_modes, "failure_modes");
  if (failureModes.length < 2) {
    invalid("failure_modes must contain at least 2 items", {
      count: failureModes.length
    });
  }
  failureModes.forEach((item, index) => {
    const entry = expectObject(item, `failure_modes[${index}]`);
    expectNonEmptyString(entry.mode, `failure_modes[${index}].mode`);
    expectNonEmptyString(
      entry.observable_signals,
      `failure_modes[${index}].observable_signals`
    );
  });
}

function validateSentiment(report: ReportObject) {
  const sentiment = expectObject(report.sentiment, "sentiment");
  const samples = expectArray(sentiment.samples, "sentiment.samples");
  if (samples.length === 0) {
    const bias = expectNonEmptyString(sentiment.bias, "sentiment.bias");
    const relation = expectNonEmptyString(sentiment.relation, "sentiment.relation");
    if (bias !== "unknown" || relation !== "unknown") {
      invalid("sentiment.bias/relation must be 'unknown' when samples empty", {
        bias,
        relation
      });
    }
  }
}

function validateKeyVariables(report: ReportObject) {
  const keyVars = expectArray(report.key_variables, "key_variables");
  if (keyVars.length < 1 || keyVars.length > 2) {
    invalid("key_variables must contain 1-2 items", { count: keyVars.length });
  }
  keyVars.forEach((item, index) => {
    const entry = expectObject(item, `key_variables[${index}]`);
    expectNonEmptyString(entry.name, `key_variables[${index}].name`);
    expectNonEmptyString(entry.impact, `key_variables[${index}].impact`);
    expectNonEmptyString(
      entry.observable_signals,
      `key_variables[${index}].observable_signals`
    );
  });
}

function validateRiskAttribution(report: ReportObject) {
  const riskAttribution = expectArray(report.risk_attribution, "risk_attribution");
  if (riskAttribution.length < 1) {
    invalid("risk_attribution must contain at least 1 item", {
      count: riskAttribution.length
    });
  }
  riskAttribution.forEach((item, index) => {
    if (typeof item !== "string") {
      invalid("risk_attribution value invalid", {
        index,
        value: item
      });
    }
    const normalized = item.trim().toLowerCase();
    const canonical = RISK_ATTRIBUTION_ALIASES.get(normalized) ?? normalized;
    if (!ALLOWED_RISK_ATTRIBUTION.has(canonical)) {
      invalid("risk_attribution value invalid", {
        index,
        value: item
      });
    }
    if (canonical !== item) {
      riskAttribution[index] = canonical;
    }
  });
}

function validateLimitations(report: ReportObject) {
  const limitations = expectObject(report.limitations, "limitations");
  const cannotDetect = expectArray(
    limitations.cannot_detect,
    "limitations.cannot_detect"
  );
  if (cannotDetect.length < 2) {
    invalid("limitations.cannot_detect must contain at least 2 items", {
      count: cannotDetect.length
    });
  }
  cannotDetect.forEach((item, index) => {
    expectNonEmptyString(item, `limitations.cannot_detect[${index}]`);
  });
  const notIncluded = expectArray(
    limitations.not_included,
    "limitations.not_included"
  );
  if (notIncluded.length < 2) {
    invalid("limitations.not_included must contain at least 2 items", {
      count: notIncluded.length
    });
  }
  const notIncludedValues = new Set<string>();
  notIncluded.forEach((item, index) => {
    const value = expectNonEmptyString(item, `limitations.not_included[${index}]`);
    notIncludedValues.add(value);
  });
  for (const required of REQUIRED_NOT_INCLUDED) {
    if (!notIncludedValues.has(required)) {
      invalid("limitations.not_included missing required value", {
        required
      });
    }
  }
}

export function postprocessReportV1Json(text: string): ReportV1Json {
  const parsed = parseJsonStrict(text);
  const report = expectObject(parsed, "report");
  validateTopLevel(report);
  validateContext(report);
  validateAiVsMarket(report);
  validateDisagreement(report);
  validatePricedVsNew(report);
  validateKeyVariables(report);
  validateFailureModes(report);
  validateRiskAttribution(report);
  validateLimitations(report);
  validateSentiment(report);
  return report;
}
