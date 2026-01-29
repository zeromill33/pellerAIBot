import type { ReportV1Json } from "../providers/llm/types.js";

const MAX_RULES_LENGTH = 1000;
const TRUNCATION_NOTICE = "（内容过长，已截断；以市场页原文为准）";

let cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (cachedTemplate) {
    return cachedTemplate;
  }
  cachedTemplate = TEMPLATE_INLINE;
  return cachedTemplate;
}

function truncateResolutionRules(value: string): string {
  if (value.length <= MAX_RULES_LENGTH) {
    return value;
  }
  const trimmed = value.slice(0, MAX_RULES_LENGTH).trimEnd();
  return `${trimmed}\n${TRUNCATION_NOTICE}`;
}

type TemplateData = Record<string, unknown>;

function getPathValue(data: TemplateData, path: string): unknown {
  const tokens: Array<string | number> = [];
  const parts = path.split(".");
  for (const part of parts) {
    const matches = part.matchAll(/([^[\]]+)|\[(\d+)\]/g);
    for (const match of matches) {
      if (match[1]) {
        tokens.push(match[1]);
      } else if (match[2]) {
        tokens.push(Number(match[2]));
      }
    }
  }

  let current: unknown = data;
  for (const token of tokens) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof token === "number") {
      if (!Array.isArray(current)) {
        return undefined;
      }
      current = current[token];
      continue;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[token];
  }
  return current;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(1);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "N/A";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatNumber(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(" / ");
  }
  return String(value);
}

function cloneReport(report: ReportV1Json): TemplateData {
  if (typeof structuredClone === "function") {
    return structuredClone(report) as TemplateData;
  }
  return JSON.parse(JSON.stringify(report)) as TemplateData;
}

function buildTemplateData(report: ReportV1Json): TemplateData {
  const data = cloneReport(report);
  const context = (data.context ?? {}) as Record<string, unknown>;
  const rulesRaw = context.resolution_rules_raw;
  if (typeof rulesRaw === "string") {
    context.resolution_rules_raw = truncateResolutionRules(rulesRaw);
  }
  data.context = context;

  const risk = data.risk_attribution;
  if (Array.isArray(risk)) {
    data.risk_attribution = risk.map((item) => String(item)).join(" / ");
  }

  return data;
}

function renderTemplate(template: string, data: TemplateData): string {
  return template.replace(/\{([^}]+)\}/g, (_match, path) => {
    const value = getPathValue(data, path.trim());
    return formatValue(value);
  });
}

export function renderTelegramReport(report: ReportV1Json): string {
  const template = loadTemplate();
  const data = buildTemplateData(report);
  return renderTemplate(template, data);
}

const TEMPLATE_INLINE = `【{context.title}】
市场 Yes/No：{context.market_odds.yes}% / {context.market_odds.no}%
AI Yes(Beta)：{ai_vs_market.ai_yes_beta}%（Δ {ai_vs_market.delta}%）
剩余时间：{context.time_remaining}
市场链接：{context.url}

【0 结算条件（原文）】
{context.resolution_rules_raw}

【1 市场在赌什么】
- 核心判断：{market_framing.core_bet}
- 关键前提：{market_framing.key_assumption}

【2 主要分歧点】
支持（Pro）
- {disagreement_map.pro[0].claim}（{disagreement_map.pro[0].source_type}）{disagreement_map.pro[0].url}
- {disagreement_map.pro[1].claim}（{disagreement_map.pro[1].source_type}）{disagreement_map.pro[1].url}

反对（Con）
- {disagreement_map.con[0].claim}（{disagreement_map.con[0].source_type}）{disagreement_map.con[0].url}
- {disagreement_map.con[1].claim}（{disagreement_map.con[1].source_type}）{disagreement_map.con[1].url}

【3 已定价 vs 新增】
已定价：
- {priced_vs_new.priced_in[0].item}（{priced_vs_new.priced_in[0].source_type}）
- {priced_vs_new.priced_in[1].item}（{priced_vs_new.priced_in[1].source_type}）

新增/未充分反映：
- {priced_vs_new.new_info[0].item}（{priced_vs_new.new_info[0].source_type}）
- {priced_vs_new.new_info[1].item}（{priced_vs_new.new_info[1].source_type}）

【4 情绪 vs 赔率（抽样）】
- 情绪：{sentiment.bias}；关系：{sentiment.relation}
- 抽样来源：
  - {sentiment.samples[0].summary} {sentiment.samples[0].url}

【5 关键变量】
- 变量：{key_variables[0].name}
  - 影响：{key_variables[0].impact}
  - 观察信号：{key_variables[0].observable_signals}

【6 失败路径（最重要）】
- {failure_modes[0].mode}
  - 信号：{failure_modes[0].observable_signals}
- {failure_modes[1].mode}
  - 信号：{failure_modes[1].observable_signals}

【7 风险类型】
- {risk_attribution}

【8 局限性】
- 可能无法识别：{limitations.cannot_detect[0]}；{limitations.cannot_detect[1]}
- 不包含：下注方向建议 / 资金管理建议

【9 差值驱动（≤3 条）】
- {ai_vs_market.drivers[0]}
- {ai_vs_market.drivers[1]}

免责声明：AI 概率为基于当前证据集的估计，可能滞后或偏差；不构成任何投资/下注建议。
`;
