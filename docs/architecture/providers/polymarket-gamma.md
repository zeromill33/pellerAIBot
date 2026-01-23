# 附录 A：PolymarketProvider（Gamma API）——事件/市场元数据与赔率

#### A.1 用途与职责边界

- **输入**：Polymarket event URL（含 slug）或 slug
- **输出**：标准化 `MarketContext`（事件描述/结算条件/剩余时间/当前赔率/关联 tokenIds 等）
- **不做**：交易下单（本 MVP 不涉及）

#### A.2 Base URL 与鉴权

- Base URL：`https://gamma-api.polymarket.com`
- 鉴权：**只读查询无需 API Key**（按官方文档的公开查询方式）

#### A.3 关键端点（本 MVP 会用到）

1) **Get Events**

- `GET /events`
- 常用 Query（按文档）：
  - `slug` / `id`（用来精确定位事件）
  - `active` / `closed` / `archived`（过滤）
  - `limit` / `offset`（分页）
- 说明：Week 1 只要 “按 slug 精确查 1 个事件”，因此可以默认 `limit=1`，并校验返回唯一性。

2) **Get Markets**

- `GET /markets`
- 常用 Query（按文档）：
  - `event_id`（通过事件拿关联 markets）
  - `slug` / `id`（直接定位某 market）
  - `token_id` / `clob_token_id`（根据 token 反查 market）
  - `active` / `closed`
  - `limit` / `offset`
- 说明：推荐主路径：`getEvent(slug)` → 拿到 `event_id` → `GET /markets?event_id=...` 获取所有 market，再选择你要分析的主 market。

#### A.4 领域模型映射（Gamma → 内部 DTO）

建议把 Gamma 的 JSON 映射为内部结构（字段示例，按你们实际返回补齐）：

- `MarketContext`
  - `event_id, slug, title, description`
  - `resolution_rules_raw`（结算条件原文：直接从事件/市场的规则字段拼接）
  - `end_time`（用于剩余时间）
  - `markets[]`：
    - `market_id, question, outcomes[]`
    - `outcomePrices[]`（可直接转为 `market_odds_yes/no`）
    - `clobTokenIds[]`（用于 CLOB /book）
    - `volume, liquidity`（Week 1 可当 “Liquidity & Inventory Proxy”）

> 备注：如果出现多个 market（例如多选项事件），Week 1 可以“运营指定 market”（通过 URL 里的 market 子 slug / token），或默认选交易量最高的。

#### A.5 限流与重试（必须实现）

Polymarket 文档给出了不同 API 的 10 秒窗口限流（Cloudflare throttling）。Week 1 至少实现：

- **全局**：统一并发上限（例如每个 provider 8 并发）
- **429/限流**：指数退避 + 抖动；必要时队列化
- **幂等**：同 event 当天重复生成 → 命中缓存，不重复打 API

Gamma（节选）示例：`/events`、`/markets` 以及 Gamma 通用限额在官方 Rate Limits 页有明确数值。

#### A.6 最小实现接口（TypeScript）

```ts
export interface MarketProvider {
  parseEventUrl(url: string): { slug: string };

  getEventBySlug(slug: string): Promise<MarketContext>;

  listMarketsByEvent(eventId: string): Promise<GammaMarket[]>;

  // 允许上层决定要取哪几个 tokenId（通常 Yes/No）
  getOrderBookSummary(tokenId: string): Promise<OrderBookSummary>;
}
```

#### A.7 建议的缓存 Key

- `pm:event:{slug}` TTL=6h（事件描述、规则、截止时间变化不频繁）
- `pm:markets:{event_id}` TTL=10m（赔率会变，但 Gamma 已能承受；也可 1–5m）
- `pm:book:{token_id}` TTL=15–60s（订单簿更“热”，但 MVP 不做实时交易，短 TTL 即可）

---
