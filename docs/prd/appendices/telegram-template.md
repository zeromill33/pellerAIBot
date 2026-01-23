# 附录 C：TG 渲染模板（从 JSON → 文案）

> Week 1 采用：**代码渲染**（推荐），避免 LLM 二次“自由发挥”。  
> 输出建议：Telegram `parse_mode=Markdown`；默认 `disable_web_page_preview=true`。

## C1. 渲染规则

- 标题行尽量短：`【事件标题】市场Yes/AIYes/Δ`
- 证据条目：`一句 claim + (来源类型) + url`
- 结算规则原文：如果过长可截断（例如前 800–1200 字），并提示“以市场页原文为准”
- 风险与局限性必须保留（用于避免用户把它当投资建议）

## C2. Markdown 模板（占位符说明）

- `{...}` 表示从 JSON 字段替换
- 数组访问示例：`{disagreement_map.pro[0].claim}`

```text
【{context.title}】
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
```

---
