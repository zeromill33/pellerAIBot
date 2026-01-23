# 附录 H：Notion/Sheet 字段字典（三表）

> Week 1 可先用 Notion/Sheet；后续再迁移数据库。字段保持稳定，方便回溯与统计。

## H1. Event 表字段

| 字段                 | 类型        | 说明                      |
| -------------------- | ----------- | ------------------------- |
| slug                 | string      | 从 Polymarket URL 解析    |
| url                  | string      | 市场链接                  |
| title                | string      | 标题/问题                 |
| description          | text        | 市场描述                  |
| resolution_rules_raw | text        | 结算条件原文（必须保留）  |
| end_time             | datetime    | 截止时间                  |
| time_remaining       | string      | 计算得到（如 2d 3h）      |
| market_yes           | number      | 0–100                     |
| market_no            | number      | 0–100                     |
| clob_token_ids       | string/list | 从 Gamma 获取             |
| gamma_liquidity      | number      | Liquidity Proxy（可为空） |
| book_depth_top10     | number      | Liquidity Proxy（可为空） |
| spread               | number      | Liquidity Proxy（可为空） |
| price_latest         | number      | 最新价（可为空）          |
| price_midpoint       | number      | 中位价（可为空）          |
| price_change_1h      | number      | 1h 价格变化（可为空）     |
| price_change_4h      | number      | 4h 价格变化（可为空）     |
| price_change_24h     | number      | 24h 价格变化（可为空）    |
| price_volatility_24h | number      | 24h 波动率（可为空）      |
| price_range_low_24h  | number      | 24h 低点（可为空）        |
| price_range_high_24h | number      | 24h 高点（可为空）        |
| price_trend_slope_24h| number      | 24h 趋势斜率（可为空）    |
| price_spike_flag     | bool        | 24h 异常波动标记          |
| price_history_24h_json | text      | 24h 历史价格序列（JSON，{ts,price}[]) |
| created_at           | datetime    | 记录创建时间              |

## H2. Evidence 表字段

| 字段         | 类型            | 说明                                         |
| ------------ | --------------- | -------------------------------------------- |
| evidence_id  | string          | 唯一 id                                      |
| slug         | string          | 关联 Event                                   |
| lane         | enum            | A/B/C/D                                      |
| source_type  | enum            | 官方公告/主流媒体/社交讨论/链上数据/市场行为 |
| url          | string          | 证据链接                                     |
| domain       | string          | 域名                                         |
| published_at | datetime/string | 来源时间                                     |
| claim        | text            | 1–2 句事实/观点                              |
| stance       | enum            | supports_yes / supports_no / neutral         |
| novelty      | enum            | priced_in / new                              |
| strength     | int             | 1–5                                          |
| repeated     | bool            | 是否重复转述                                 |

## H3. Report 表字段

| 字段                | 类型     | 说明                         |
| ------------------- | -------- | ---------------------------- |
| report_id           | string   | 唯一 id                      |
| slug                | string   | 关联 Event                   |
| generated_at        | datetime | 生成时间                     |
| report_json         | text     | 完整 JSON（Report v1）       |
| tg_post_text        | text     | 渲染后文案                   |
| status              | enum     | draft / published / blocked  |
| reviewer            | string   | 运营审核人（Week 1 可空）    |
| regenerate_count_1h | int      | 1 小时内重试次数（配合限流） |

---
