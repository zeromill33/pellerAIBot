import type { ErrorSuggestion } from "../orchestrator/errors.js";
import { ERROR_CODES } from "../orchestrator/errors.js";
import type { ReportV1Json } from "../providers/llm/types.js";

const DEFAULT_CALL_TO_ACTION_KEYWORDS = [
  "buy",
  "sell",
  "long",
  "short",
  "go long",
  "go short",
  "all in",
  "all-in",
  "bet",
  "wager",
  "position sizing",
  "position size",
  "buy in",
  "买入",
  "卖出",
  "做多",
  "做空",
  "加仓",
  "减仓",
  "止损",
  "止盈",
  "下注",
  "押注",
  "梭哈",
  "重仓",
  "满仓",
  "跟单",
  "建议下注",
  "直接买"
];

const ALLOWED_SOURCE_TYPES = new Set([
  "官方公告",
  "主流媒体",
  "社交讨论",
  "链上数据",
  "市场行为"
]);

const DEFAULT_GATE_CONFIG = {
  minFailureSignalLength: 20,
  minDistinctUrls: 4,
  minDistinctDomains: 2,
  callToActionKeywords: DEFAULT_CALL_TO_ACTION_KEYWORDS
} as const;

type GateConfigInput = Partial<{
  minFailureSignalLength: number;
  minDistinctUrls: number;
  minDistinctDomains: number;
  callToActionKeywords: string[];
}>;

export type ContentGateResult =
  | { ok: true }
  | {
      ok: false;
      code: string;
      message: string;
      suggestion?: ErrorSuggestion;
      details?: Record<string, unknown>;
    };

export type ContentGateConfig = {
  minFailureSignalLength: number;
  minDistinctUrls: number;
  minDistinctDomains: number;
  callToActionKeywords: string[];
};

type EvidenceItem = {
  claim: string;
  source_type: string;
  url: string;
  time: string;
};

type PricedItem = {
  item: string;
  source_type: string;
};

type SentimentSample = {
  url: string;
  summary: string;
};

type ReportV1 = {
  context: {
    resolution_rules_raw: string;
  };
  market_framing: {
    core_bet: string;
    key_assumption: string;
  };
  disagreement_map: {
    pro: EvidenceItem[];
    con: EvidenceItem[];
  };
  priced_vs_new: {
    priced_in: PricedItem[];
    new_info: PricedItem[];
  };
  sentiment: {
    bias: string;
    relation: string;
    samples: SentimentSample[];
  };
  key_variables: Array<{
    name: string;
    impact: string;
    observable_signals: string;
  }>;
  failure_modes: Array<{
    mode: string;
    observable_signals: string;
  }>;
  limitations: {
    cannot_detect: string[];
    not_included: string[];
  };
  ai_vs_market: {
    drivers: string[];
  };
};

function normalizeConfig(input?: GateConfigInput): ContentGateConfig {
  return {
    minFailureSignalLength:
      input?.minFailureSignalLength ?? DEFAULT_GATE_CONFIG.minFailureSignalLength,
    minDistinctUrls: input?.minDistinctUrls ?? DEFAULT_GATE_CONFIG.minDistinctUrls,
    minDistinctDomains:
      input?.minDistinctDomains ?? DEFAULT_GATE_CONFIG.minDistinctDomains,
    callToActionKeywords:
      input?.callToActionKeywords ?? DEFAULT_GATE_CONFIG.callToActionKeywords
  };
}

function suggestionForEvidence(message: string): ErrorSuggestion {
  return {
    action: "supplement_search",
    preferred_lane: "C",
    message
  };
}

function normalizeDomain(domain: string): string {
  const lowered = domain.trim().toLowerCase();
  if (lowered.startsWith("www.")) {
    return lowered.slice(4);
  }
  return lowered;
}

function extractDomain(value: string): string | null {
  try {
    const url = new URL(value);
    return normalizeDomain(url.hostname);
  } catch {
    return null;
  }
}

function collectEvidenceUrls(report: ReportV1): { urls: string[]; domains: string[] } {
  const urlSet = new Set<string>();
  const domainSet = new Set<string>();

  const evidenceItems = [
    ...report.disagreement_map.pro,
    ...report.disagreement_map.con
  ];
  for (const item of evidenceItems) {
    const url = item.url?.trim();
    if (!url) {
      continue;
    }
    urlSet.add(url);
    const domain = extractDomain(url) ?? "unknown";
    domainSet.add(domain);
  }

  for (const sample of report.sentiment.samples ?? []) {
    const url = sample.url?.trim();
    if (!url) {
      continue;
    }
    urlSet.add(url);
    const domain = extractDomain(url) ?? "unknown";
    domainSet.add(domain);
  }

  return {
    urls: Array.from(urlSet),
    domains: Array.from(domainSet)
  };
}

function buildCallToActionMatchers(keywords: string[]): RegExp[] {
  return keywords.map((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (/^[a-zA-Z0-9\s-]+$/.test(keyword)) {
      const pattern = escaped.replace(/\s+/g, "\\s+");
      return new RegExp(`\\b${pattern}\\b`, "i");
    }
    return new RegExp(escaped, "i");
  });
}

function findCallToAction(
  report: ReportV1,
  matchers: RegExp[]
): { path: string; text: string } | null {
  const candidates: Array<{ path: string; text: string }> = [];
  candidates.push({ path: "market_framing.core_bet", text: report.market_framing.core_bet });
  candidates.push({ path: "market_framing.key_assumption", text: report.market_framing.key_assumption });

  report.disagreement_map.pro.forEach((item, index) => {
    candidates.push({
      path: `disagreement_map.pro[${index}].claim`,
      text: item.claim
    });
  });
  report.disagreement_map.con.forEach((item, index) => {
    candidates.push({
      path: `disagreement_map.con[${index}].claim`,
      text: item.claim
    });
  });

  report.priced_vs_new.priced_in.forEach((item, index) => {
    candidates.push({ path: `priced_vs_new.priced_in[${index}].item`, text: item.item });
  });
  report.priced_vs_new.new_info.forEach((item, index) => {
    candidates.push({ path: `priced_vs_new.new_info[${index}].item`, text: item.item });
  });

  report.key_variables.forEach((item, index) => {
    candidates.push({ path: `key_variables[${index}].name`, text: item.name });
    candidates.push({ path: `key_variables[${index}].impact`, text: item.impact });
    candidates.push({
      path: `key_variables[${index}].observable_signals`,
      text: item.observable_signals
    });
  });

  report.failure_modes.forEach((item, index) => {
    candidates.push({ path: `failure_modes[${index}].mode`, text: item.mode });
    candidates.push({
      path: `failure_modes[${index}].observable_signals`,
      text: item.observable_signals
    });
  });

  report.sentiment.samples.forEach((item, index) => {
    candidates.push({ path: `sentiment.samples[${index}].summary`, text: item.summary });
  });

  for (const candidate of candidates) {
    const text = candidate.text ?? "";
    for (const matcher of matchers) {
      if (matcher.test(text)) {
        return { path: candidate.path, text };
      }
    }
  }

  return null;
}

export function validateContentGates(
  reportJson: ReportV1Json,
  configInput?: GateConfigInput
): ContentGateResult {
  const report = reportJson as ReportV1;
  const config = normalizeConfig(configInput);

  if (!report.context?.resolution_rules_raw?.trim()) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATOR_RESOLUTION_RULES_MISSING,
      message: "context.resolution_rules_raw is required"
    };
  }

  if (report.disagreement_map.pro.length < 2 || report.disagreement_map.con.length < 2) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATOR_DISAGREEMENT_INSUFFICIENT,
      message: "disagreement_map requires at least 2 pro/con items",
      suggestion: suggestionForEvidence("补充正反双方证据")
    };
  }

  const pricedItems = [
    ...report.priced_vs_new.priced_in,
    ...report.priced_vs_new.new_info
  ];
  for (const item of pricedItems) {
    if (!ALLOWED_SOURCE_TYPES.has(item.source_type)) {
      return {
        ok: false,
        code: ERROR_CODES.VALIDATOR_PRICED_SOURCE_INVALID,
        message: "priced_vs_new.source_type invalid",
        details: { source_type: item.source_type }
      };
    }
  }

  if (report.failure_modes.length < 2) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATOR_FAILURE_MODES_GENERIC,
      message: "failure_modes requires at least 2 items",
      suggestion: suggestionForEvidence("补充失败路径与可观测信号")
    };
  }
  for (const [index, mode] of report.failure_modes.entries()) {
    const length = mode.observable_signals?.trim().length ?? 0;
    if (length < config.minFailureSignalLength) {
      return {
        ok: false,
        code: ERROR_CODES.VALIDATOR_FAILURE_MODES_GENERIC,
        message: "failure_modes.observable_signals is too short",
        details: {
          index,
          min_length: config.minFailureSignalLength,
          length
        },
        suggestion: suggestionForEvidence("补充失败路径的可观测信号")
      };
    }
  }

  const { urls, domains } = collectEvidenceUrls(report);
  if (urls.length < config.minDistinctUrls) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATOR_INSUFFICIENT_URLS,
      message: "insufficient distinct evidence urls",
      details: {
        count: urls.length,
        min_required: config.minDistinctUrls
      },
      suggestion: suggestionForEvidence("补充更多来源 URL")
    };
  }
  if (domains.length < config.minDistinctDomains) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATOR_INSUFFICIENT_URLS,
      message: "insufficient domain diversity",
      details: {
        distinct_domains: domains.length,
        min_required: config.minDistinctDomains
      },
      suggestion: suggestionForEvidence("补充不同域名来源")
    };
  }

  const callToActionMatchers = buildCallToActionMatchers(
    config.callToActionKeywords
  );
  const callToAction = findCallToAction(report, callToActionMatchers);
  if (callToAction) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATOR_CALL_TO_ACTION_DETECTED,
      message: "Call-to-action language detected",
      details: callToAction
    };
  }

  if (report.sentiment.samples.length === 0) {
    if (report.sentiment.bias !== "unknown" || report.sentiment.relation !== "unknown") {
      return {
        ok: false,
        code: ERROR_CODES.VALIDATOR_SENTIMENT_INVALID,
        message: "sentiment.bias/relation must be unknown when samples empty",
        details: {
          bias: report.sentiment.bias,
          relation: report.sentiment.relation
        }
      };
    }
  }

  const drivers = report.ai_vs_market.drivers ?? [];
  if (drivers.length < 1 || drivers.length > 3) {
    return {
      ok: false,
      code: ERROR_CODES.VALIDATOR_AI_DRIVERS_INVALID,
      message: "ai_vs_market.drivers must be length 1-3",
      details: { length: drivers.length }
    };
  }
  for (const [index, driver] of drivers.entries()) {
    for (const matcher of callToActionMatchers) {
      if (matcher.test(driver)) {
        return {
          ok: false,
          code: ERROR_CODES.VALIDATOR_AI_DRIVERS_INVALID,
          message: "ai_vs_market.drivers contains call-to-action language",
          details: { index, text: driver }
        };
      }
    }
  }

  return { ok: true };
}
