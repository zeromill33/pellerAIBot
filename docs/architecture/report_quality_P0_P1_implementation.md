# MVP 报告质量优化（P0/P1）实现方案 — 可执行清单

> 目标：针对样例报告暴露的问题（不相关引用、占位符输出、Δ 计算错误、引用不可审计、市场行为证据贫弱、规则未结构化），在现有架构（Orchestrator + Providers + Validator + Renderer + Storage）上做 **最小侵入**的 P0/P1 改造。  
> 适用版本：TDD v0.2（Week 1 Content Ops / TG 自动推送）。  
> 生成时间：2026-01-30T04:12:06.232832+00:00

---

## 0. 背景：问题 → 工程化根因

### 0.1 问题（来自样例报告）
- 引用与论点不匹配（检索命中但语义偏移）
- Section 3/4 出现 `N/A`、`unknown` 占位符，显得“模板没跑完”
- Δ（AI vs 市场差值）出现低级数学错误（符号/数值不一致）
- 正文直接贴 URL，阅读与审计困难
- “市场行为”证据偷懒：两边都贴 Polymarket 页面链接
- Resolution Rules 仅贴原文，未结构化为可检查项/争议点

### 0.2 工程化根因
- Search 构造泛化：缺少 resolver/判定词/截止时间锚定，导致结果不匹配
- LLM 输入未做相关性过滤，导致“命中但不相关”的证据进入生成
- 派生字段（尤其 Δ）由 LLM 输出，缺少一致性机器校验（time_remaining 已由代码计算，但 delta 未校验）
- Renderer 缺少引用编号系统（CitationManager）
- 市场指标已有采集，但报告未把指标转成可审计证据（只贴市场链接）
- 未抓取官方 resolver 页面，无法形成 authoritative evidence

### 0.3 现状校验要点（与当前实现对齐）
- QueryPlan 多车道搜索已实现（A/B/C + 条件 D），且支持补搜升级 C 为 advanced。
- `time_remaining` 已由代码计算并注入 LLM 输入；`delta` 仍由 LLM 输出且无一致性校验。
- EvidenceBuilder 已产出候选证据，但当前 LLM 仅使用 `tavily_results`，未消费候选证据。
- Prompt/Validator 已允许 `N/A/unknown` 在特定场景出现（如证据不足、情绪无样本）。

---

## 1. P0 必做（避免低级错、避免空洞输出）

### P0-1 Δ 一致性校验 + 代码侧派生收口
**目标：** Δ 不允许出错；time_remaining 已由代码计算但需保持一致。

**改动点**
- 方案 A（最小改动）：在 Validator 增加 `delta` 一致性校验
- 方案 B（中等改动）：新增 `metrics.compute.step.ts`，统一由代码填充 `delta/time_remaining` 并覆盖 LLM 输出

**输入**
- `market_yes_pct`, `market_no_pct`（来自 Polymarket）
- `ai_yes_pct`（来自 report json）
- `deadline_ts`, `now_ts`（用于 time_remaining，已在代码侧计算）

**输出（写入 ctx.report_meta 或 report_json.meta）**
- `delta_pct = ai_yes_pct - market_yes_pct`
- `time_left_ms`, `time_left_human`

**Validator 新增硬校验**
- `abs(delta_pct - (ai_yes_pct - market_yes_pct)) < 0.1` 否则 `VALIDATOR_METRICS_MISMATCH`

---

### P0-2 控制占位符范围（允许但必须可解释）
**目标：** “没有数据”要可解释，限制占位符滥用。

**现行允许范围（与 Prompt/Validator 一致）**
- `disagreement_map.*.time` 在证据不足时可为 `N/A`（且需绑定 market url）
- `sentiment.samples` 为空时 `bias/relation=unknown`

**实现**
- Validator：仅允许上述范围内出现 `N/A/unknown`；其他字段出现视为失败（`VALIDATOR_PLACEHOLDER_OUTPUT`）
- Renderer：对缺失字段避免直接渲染 `N/A`（可改为说明性文本或隐藏该行）

**补搜策略**
- 如果 failure 原因是 `insufficient_evidence` / `placeholder_output`：
  - Orchestrator 自动触发补搜（lane C advanced）再试一次
  - 仍失败才产出“blocked + 原因解释”结果（不推送 TG）

---

### P0-3 LLM 输入相关性过滤（先过滤再生成）
**目标：** 在 LLM 前清掉“不讨论该事件定义”的证据。

**新增 Step：** `tavily.verify.step.ts` 或 `evidence.filter.step.ts`（位于 `search.tavily` 之后、`report.generate` 之前）
> 关键点：必须输出 **过滤后的 `tavily_results`**，否则对 LLM 无效。

**过滤规则（先硬规则，后可选 embedding）**
- 必须命中关键词/实体（满足任一）：
  - `OPM` / `Office of Personnel Management`
  - `government shutdown` / `shutdown`
  - `lapse in appropriations` / `appropriations`
  - `Operating Status`（与 resolver 相关）
- 若 evidence 有 `published_at`，优先近 7–14 天
- 必须存在 `snippet/raw_content` 片段（没有则降权或丢弃）

**输出**
- `tavily_results_filtered`
- `dropped_evidence[]`（保留审计：url + reason）

---

## 2. P1 强烈建议（让报告可审计、可复盘、信息密度高）

### P1-1 引用编号/脚注系统（CitationManager）
**目标：** 正文不再贴 URL，引用可读、可审计。

**Evidence 最小可审计字段（强制）**
- `url`, `domain`, `source_type`
- `title?`, `published_at?`
- `snippet (<=280 chars)`
- `claim_summary`（一句话概括）

**Renderer 输出规范**
- 文中：`……（主流媒体【3】）`
- 文末 Sources：
  - `【3】domain — title — url`

**Validator 新增**
- `unique_domains >= 2~3`（配置化）
- `evidence_with_snippet_ratio >= 0.7`（配置化）

---

### P1-2 “市场行为”证据结构化：Market Metrics
**目标：** 不再把“市场链接”当证据；用可引用的数值指标替代。

**现状说明**
- 已有 `price_context.signals` 与 `clob_snapshot`（含 spread、notable_walls、change_24h 等），但报告未显式把指标写成可审计 evidence。

**新增 Step（可选强化）：** `market.metrics.step.ts`

**数据来源**
- Gamma：当前 Yes/No 价格、市场元数据
- CLOB：订单簿深度（bid/ask depth）
- Storage：前 24h 快照（需要落库历史）

**输出指标（示例）**
- `price_change_24h`（Yes price delta）
- `orderbook_imbalance`（bid_depth / ask_depth）
- `notable_walls[]`（某价位深度占比 > X%）

**作为 Evidence 输出**
- `source_type="market"`
- `claim_summary="过去24h Yes 从 58→61.5（+3.5）"`
- `snippet="snapshot: yes=0.615; 24h_ago=0.58; ..."`

---

### P1-3 Resolution Rules 结构化 + 官方 resolver 抓取
**目标：** 把“结算条件”从贴原文，升级为“可检查点 + 争议预警”。

**新增 Step 1：** `resolution.parse.step.ts`
- 从规则原文提取结构化字段：
  - `deadline_ts`（ET → UTC）
  - `resolver_url`（OPM Operating Status page）
  - `partial_shutdown_counts=true`
  - `exclusions=[holiday, inclement_weather]`

**新增 Step 2：** `official.fetch.step.ts`
- 抓取 resolver_url 页面关键片段，形成 `source_type="official"` evidence
- 在报告中用于：
  - 解释风险（interpretation risk）
  - 提醒用户“以 OPM 页面为最终判定”

**Validator 新增**
- “解释风险/判定标准”部分必须引用至少 1 条 official evidence 或 resolution 结构化字段，否则 fail（`VALIDATOR_MISSING_OFFICIAL_SOURCE`）

---

## 3. Search 构造问题（导致不匹配的核心原因 & 解决方案）

### 3.1 为什么会搜偏
- query 过泛：只搜 “government shutdown” 会命中任何政治新闻
- 没锚定 resolver：本市场以 OPM 页为 source，query 未包含 OPM/Operating Status
- 没锚定判定词：`lapse in appropriations`、`partial shutdown counts` 等是关键 discriminators
- 没拆分意图：新闻/官方/规则解释/反方证据混在一次搜索里，噪音变大

### 3.2 现状：QueryPlan 已实现；需要“更强约束”
**核心：** 已存在 `TavilyQueryPlan`（A/B/C + 条件 D），需要注入 resolver/判定词/截止时间。

```ts
type TavilyQueryLane = { lane: "A" | "B" | "C" | "D"; query: string };
type TavilyQueryPlan = { lanes: TavilyQueryLane[] };
```

**示例（对应政府关门市场）**
- Lane A (news)：  
  `US government shutdown lapse in appropriations Jan 31 2026 OPM announcement`
- Lane C (official)：  
  `Operating Status site:opm.gov shutdown appropriations` 或 `include_domains=["opm.gov"]`

### 3.3 QueryBuilder 的硬规则（工程化）
- 必须注入：
  - `resolver_domain`（如 opm.gov）
  - `deadline`（Jan 31 2026 / 11:59PM ET）
  - `resolution_keywords`（lapse in appropriations / partial shutdown counts）
- 必须限制：
  - query 长度 < 400
  - 每个 lane max_results 3–6（防噪）
- 必须开启：
  - `include_raw_content=true`（用于 snippet/相关性校验）
- Validator/Orchestrator 联动：
  - 若相关性丢弃率高 → 触发 lane C advanced 或提升 D lane

---

## 4. Pipeline 最小改动（侵入最小但提升显著）

在现有链路中插入/替换如下（已实现项保留，新增项标注）：
1. `query.plan.build.step.ts`（已实现：TavilyQueryPlan）
2. `search.tavily.step.ts`（已实现）
3. `tavily.verify.step.ts`（新增：过滤不相关结果，输出 filtered tavily_results）
4. `evidence.build.step.ts`（已实现）
5. `report.generate.step.ts`（已实现：time_remaining 由代码计算并注入）
6. `metrics.compute.step.ts`（新增：可选，用于 delta/time_remaining 收口）
7. `report.validate.step.ts`（新增：delta 一致性、占位符范围、official 证据等）
8. `telegram.render.step.ts`（可选：引入 CitationManager，条件渲染）
9. `telegram.publish.step.ts` / `persist.step.ts`（已实现）

---

## 5. 交付 TODO（按优先级）

### P0 TODO（Week 1 必须落地）
- [ ] Step: `metrics.compute.step.ts`（delta/time_left 收口；或改为 validator 一致性校验）
- [ ] Step: `tavily.verify.step.ts`（相关性过滤 + dropped evidence 审计）
- [ ] Validator：占位符范围校验、delta 一致性校验、补搜触发码
- [x] QueryStrategy：已实现 `TavilyQueryPlan`（多 lane 多子查询）
- [ ] Renderer：避免直接输出 `N/A`（改为说明或隐藏行）

### P1 TODO（Week 1.5/Week 2）
- [ ] CitationManager：正文引用编号 + 文末 sources
- [ ] Step: `market.metrics.step.ts`（补齐“市场行为”指标证据化）
- [ ] Step: `resolution.parse.step.ts` + `official.fetch.step.ts`
- [ ] Validator：official evidence 必须存在（或 resolution 结构化字段满足）

---

## 6. 验收标准（Definition of Done）

### P0 验收
- 任一报告不会出现：
  - 非允许字段出现 `N/A`、`unknown` 占位符
  - Δ 错误（delta 必与 ai-market 一致）
  - 明显不相关引用（被 tavily.verify 过滤）
- validator fail 时：
  - 自动触发补搜一次（lane C advanced）
  - 仍 fail 的报告不发布 TG，且有明确原因

### P1 验收
- 正文无裸 URL；引用以 `【n】` 标注，文末统一 sources
- 市场行为有结构化指标（24h 变化/订单簿倾斜/墙）
- resolution rules 有结构化字段，且至少 1 条 official evidence（resolver 页面）

---

## 7. 附：实现接口清单（便于开工）

### 7.1 StepDef（建议）
```ts
type StepDef = {
  id: string;
  run: (ctx: PipelineContext) => Promise<PipelineContext>;
};
```

### 7.2 Provider Interfaces（摘要）
```ts
interface MarketProvider {
  fetchMarketContext(slug: string): Promise<MarketContext>;
  fetchOrderbook(tokenId: string): Promise<ClobSnapshot>;
}

interface SearchProvider {
  search(task: SearchTask): Promise<SearchResult[]>;
}

interface LLMProvider {
  generateReportV1(input: ReportGenInput): Promise<ReportV1>;
}

interface Publisher {
  publishToChannel(text: string): Promise<void>;
}
```

---

如需我进一步把这些内容同步进你们的 TDD v0.3（含目录树、schema 修订、validator 规则表、QueryPlan 具体模板），我也可以直接基于这份文档扩展成完整的“实现规格书”。
