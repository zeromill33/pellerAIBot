# 附录 D：Tavily 多车道 Query 生成器（规则 + 默认参数）

## D1. 车道定义（Week 1 默认 A+B+C，D 条件触发）

- **A（Update/Catalyst）**：解释赔率变化、找新增催化剂（服务【1】【3】【5】）
- **B（Primary/Official）**：找一手来源/官方口径（服务【0】【6】【7】）
- **C（Counter/Controversy）**：补反方论据/争议/失败路径（服务【2】【6】）
- **D（Chatter Sample）**：轻量社交抽样（服务【4】，默认不跑；满足触发条件必须启用，且执行 2–3 类 Query）

## D2. 输入字段

- `title`：市场标题/问题
- `description`：市场描述
- `resolution_rules_raw`：结算条件原文（可用于提取关键定义/官方来源线索）
- `end_time`：截止时间（用于 time anchor）
- （可选）`category`：运营标签（加密/政治/体育）

## D3. 实体抽取（最小可行）

**目标**：生成短而准的 query（建议 < 400 chars）。

抽取字段：

- `subject_entities[]`：人/机构/球队/币种/项目
- `action`：nominate / win / approve / ban / launch / announce / settle...
- `object`：fed chair / championship / regulation / ETF / court ruling...
- `synonyms[]`：同义词（Fed Chair ↔ Federal Reserve Chair）
- `time_anchor`：`before {end_time_date}` + `this week / Jan 2026`

> Week 1 允许用轻量 LLM 抽取；也可用规则：大写词、币种符号、常见机构名词典。

## D4. Query 模板（按车道）

**A — 最新进展（Update）**

- `{subject_entities} {action} {object} latest update {time_anchor}`
- 体育可加：`injury update / lineup update / suspension`

**B — 一手来源（Primary）**

- `{org/person} official statement {object}`
- `{org} press release {topic}`
- `{topic} official announcement`

**C — 反方/争议（Counter）**

- `{topic} why unlikely`
- `{topic} controversy`
- `{topic} legal challenge OR lawsuit OR injunction`
- `{topic} fact check`

**D — 社交抽样（Chatter, 条件触发，必须 2–3 类）**

- Query A：`site:reddit.com {event_keywords} (thread OR discussion OR megathread)`
- Query B：`site:x.com {event_keywords} (rumor OR confirmed OR source)`（或“关键人名 + 关键词”）
- Query C：`{event_keywords} controversy resolution criteria`（打“结算争议点”）

## D5. Tavily 参数默认值（配置化）

全局默认（所有车道共用）：

- `include_raw_content=true`
- `include_answer=false`
- `auto_parameters=true`

车道默认：

- A：`search_depth=basic, max_results=5, time_range=7d`
- B：`search_depth=basic, max_results=5, time_range=30d, include_domains/exclude_domains 可选`
- C：`search_depth=advanced（仅此车道默认）, max_results=5, time_range=30d`
- D：`enabled=always, search_depth=basic, max_results=3, time_range=7d, query_types=["reddit","x","controversy"]`

## D6. 触发补搜（节省额度的控制策略）

默认启用 D 车道。若将 D 设置为 `conditional`，满足以下任一条件时必须启用 D（并执行全部 2–3 类 Query）：

- 赔率 24h 大幅波动（阈值配置化）
- 事件属于“社交驱动”（如加密/政治争议）
- `disagreement_map` 任一侧证据不足（<2）

补搜策略依旧以 C 车道优先，D 作为“社交抽样”的条件触发补充。

---
