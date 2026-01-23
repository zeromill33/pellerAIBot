# 附录 F：Validator（质量闸门规则，发布前必跑）

Validator 分两层：Schema 校验 + 内容闸门。任一失败 → 阻断推送，并返回失败原因。

## F1. Schema 校验

- JSON 可解析
- 严格匹配 Report v1 schema（多 key、缺 key 都失败）
- 概率字段全部为 0–100：
  - `context.market_odds.yes/no`
  - `ai_vs_market.market_yes/ai_yes_beta`

## F2. 内容闸门（失败则阻断发布）

1) `context.resolution_rules_raw` 不能为空  
2) `disagreement_map.pro` 与 `disagreement_map.con` 各 ≥ 2  
3) `priced_vs_new` 每条必须有 `source_type` 且属于五选一  
4) `failure_modes` 必须 ≥ 2，且每条 `observable_signals` 非空、长度>阈值（建议 ≥ 20 字）  
5) 引用 URL 最低线：建议总计 ≥ 4 个不同 URL，且域名不要全相同  
6) 反“喊单”黑名单：出现明显下注建议措辞 → 阻断  
   - 例：`buy/long/short/all-in/建议下注/梭哈/重仓/满仓/跟单/直接买`  
7) 若 `sentiment.samples` 为空，则 `sentiment.bias` 与 `sentiment.relation` 必须为 `unknown`  
8) `ai_vs_market.drivers` 长度 1–3，且不得出现下注建议措辞  

## F3. 失败原因返回格式（建议）

- `code`：`MISSING_RULES` / `INSUFFICIENT_EVIDENCE` / `GENERIC_FAILURE_MODES` / `CALL_TO_ACTION_DETECTED` 等  
- `message`：人类可读  
- `suggestion`：建议补哪个车道（优先 C；必要时 D）  

---
