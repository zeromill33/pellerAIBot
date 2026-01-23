# 附录 C：TavilyProvider ——资讯检索（结构化上下文）

#### C.1 Base URL 与鉴权

- Endpoint：`POST /search`（官方 API Reference）
- 鉴权：HTTP Header `Authorization: Bearer tvly-...`

#### C.2 核心参数（MVP 推荐值）

- `query`：string（必填）
- `search_depth`：`basic|advanced|fast|ultra-fast`
  - `basic`：默认，性价比高
  - `advanced`：更高相关性但更慢/更贵（只在“证据不足”时升级）
  - 说明与语义以官方文档为准。
- 其他建议（按 Tavily 文档与实践）：
  - `max_results=5`（控制成本）
  - `include_raw_content=false`（Week 1 默认不要全文，避免 token 暴涨）
  - `include_answer=false`（答案由你们 LLM 产出，避免重复付费）

#### C.3 多查询 vs 单查询：如何“既有效又省额度”

结论：**不是只能一次搜索**。Week 1 采用 A/B/C 三车道，D 为条件触发：

- **默认（A/B/C）**：
  1) `A Update`：事件标题 + 关键实体 + 截止时间
  2) `B Primary`：结算条件/官方来源（公告/机构网站）
  3) `C Counter`：反方叙事/争议/失败路径

- **D（Chatter，条件触发且必须执行 2–3 类）**：
  - Query A：`site:reddit.com {event_keywords} (thread OR discussion OR megathread)`
  - Query B：`site:x.com {event_keywords} (rumor OR confirmed OR source)`
  - Query C：`{event_keywords} controversy resolution criteria`

> D 触发条件（任一满足即启用）：
>
> - `market_odds_change_24h > threshold`
> - `category in [crypto, politics]`（社交驱动）
> - `disagreement_map` 任一侧证据不足

#### C.4 你们的“重生成限流”如何落地到 Tavily 调用

你们的产品约束是：

- 同一事件 5 分钟内最多生成一次
- 1 小时最多 5 次（可配置）

落地建议：

- 在 Orchestrator 层实现“regen policy”（不要让 provider 背锅）
- Provider 只做：
  - HTTP 429 处理
  - 自身并发限制
- `regen_dedupe_key = sha256(slug + date + report_version + query_plan_hash)`

---
