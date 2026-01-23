# 附录 J：Polymarket Pricing API —— token 价格数据

#### J.1 用途与职责边界

- **输入**：`token_id`
- **输出**：最新价、中位价、历史价格序列（建议 24h/小时级）
- **用途**：作为“市场行为/价格信号”的补充输入，用于 priced-in vs new 判断，不作为单独事实来源
- **不做**：价格原因归因（需要与证据 URL 绑定）

#### J.2 文档与鉴权

- 官方 Pricing API 文档：
  - https://docs.polymarket.com/api-reference/pricing/get-market-price
  - https://docs.polymarket.com/api-reference/pricing/get-midpoint-price
  - https://docs.polymarket.com/api-reference/pricing/get-price-history-for-a-traded-token
- 鉴权与 Base URL 以官方文档为准（本项目只读查询）

#### J.3 关键接口（本 MVP 会用到）

1) **Get market price（最新价）**
- 说明：按 `token_id` 获取最新成交/报价

2) **Get midpoint price（中位价）**
- 说明：按 `token_id` 获取 bid/ask 中位价

3) **Get price history for a traded token（历史价格）**
- 说明：按 `token_id` 获取历史价格序列（建议 24h/小时级）

#### J.4 领域模型映射（Pricing → 内部 DTO）

建议将 Pricing 响应映射为内部结构：

- `TokenPriceSeries`
  - `token_id`
  - `latest_price`
  - `midpoint_price`
  - `history_24h[]`: `{ts, price}`
- `PriceSignals`（由代码计算）
  - `change_1h`, `change_4h`, `change_24h`
  - `volatility_24h`
  - `range_high_24h`, `range_low_24h`
  - `trend_slope_24h`
  - `spike_flag`（是否出现显著单点波动）

#### J.4.1 PriceSignals 计算口径（必须）

设 `history_24h` 已按 `ts` 升序，最后一个点为 `p_t`，单位与 Pricing API 返回一致。

- `change_1h/4h/24h`：  
  - `change_xh = p_t - p_{t-xh}`  
  - 取 “t-xh 时刻或更早的最近点”；若不存在则置空。
- `volatility_24h`：  
  - 先计算相邻点差分：`delta_i = p_i - p_{i-1}`  
  - `volatility_24h = stddev(delta_i)`（样本数不足则置空）
- `range_high_24h` / `range_low_24h`：  
  - `max(p_i)` / `min(p_i)`
- `trend_slope_24h`：  
  - `trend_slope_24h = (p_t - p_0) / hours_diff`  
  - `p_0` 为 24h 窗口起点附近点；`hours_diff` 为时间差（小时）
- `spike_flag`（严格阈值）：  
  - `max_abs_delta = max(|delta_i|)`  
  - `spike_flag = max_abs_delta >= max(4 * stddev(delta_i), 3 * median_abs_delta)`  
  - 若样本不足，则为 `false` 或 `null`（需与实现约定）

> 说明：若价格为 0–1 区间，`change_xh` 以“概率点差”表示；LLM 仅将其作为“市场行为”补充信号。

#### J.5 缓存与重试（沿用 Provider 规范）

- latest/midpoint：短 TTL（15–60s）
- history_24h：中 TTL（5–15min）
- 仅对 429/5xx/网络错误重试（最多 3 次），指数退避 + jitter
