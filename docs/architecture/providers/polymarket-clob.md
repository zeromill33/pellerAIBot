# 附录 B：PolymarketProvider（CLOB API）——订单簿（Market Data）

#### B.1 用途

- 给 Report v1 的两块能力提供数据：
  1) **市场结构/流动性直觉**：spread、top-of-book 深度
  2) **“大鲸鱼动向 proxy”**：大额挂单墙、短时间深度变化（MVP 先做静态快照）

#### B.2 Base URL 与鉴权

- Base URL：`https://clob.polymarket.com`
- 本 MVP 只用 **Market Data（只读）**，不涉及交易鉴权。

#### B.3 关键端点：Get order book summary

- `GET /book?token_id=<token_id>`
- 必填参数：`token_id`（string）
- 关键返回字段（节选）：
  - `bids[]` / `asks[]`（price/size）
  - `min_order_size`, `tick_size`
  - `timestamp`
- MVP 处理建议：
  - 只取前 N 档（例如 10 档）用于渲染
  - 计算：
    - `best_bid`, `best_ask`, `spread`, `mid`
    - “墙”检测：size > 均值×k（k=5）标记为 notable wall

#### B.4 “大额挂单墙”与“鲸鱼动向”口径（Week 1 现实版）

- Week 1 不做地址级别 holder 扫链（按你们决策）
- 用订单簿做 proxy：
  - 识别顶层深度异常（集中挂单）
  - 识别盘口单边厚（bids/asks 失衡）
- 仅提示“结构信号”，不要推导“某鲸鱼地址”——避免过度解释。

---
