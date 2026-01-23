# 附录 E：Evidence Builder（合并、去重、打标、priced-in vs new）

## E1. 输入与输出

输入：Tavily 多车道返回的 `results[]` + Polymarket 市场行为数据（赔率变化、盘口变化）  
输出：Evidence 表记录 + 给 LLM 的 `evidence_candidates[]`（可包含摘要与标签）

## E2. 去重规则（Week 1 简版）

1) **URL 完全相同** → 去重  
2) `domain + title` 高相似（>0.9） → 去重  
3) 同一事实被多篇转述：
   - 保留更权威/更早的一篇作为主证据  
   - 其余保留但标记 `repeated=true`（可用于“已定价”判断）

## E3. 来源类型映射（必须五选一）

- 车道 B 且域名为机构/官方站点 → **官方公告**
- 车道 A/C 且域名为主流媒体 → **主流媒体**
- 车道 D → **社交讨论**
- 来自 Gamma/CLOB 的赔率变化/盘口/成交 → **市场行为**
- Week 1 不扫链：链上数据通常为空；若引入明确链上数据源再标 **链上数据**

> 域名权威白名单/黑名单建议维护在配置文件或常量中，逐步迭代。

## E4. stance（支持/反对/中性）标注

Week 1 可采用 LLM/规则简化：

- 若内容包含明确支持某结果的论述 → `supports_yes` 或 `supports_no`
- 无法判断或仅描述事实 → `neutral`

## E5. priced-in vs new（Week 1 规则）

**new_info（新增/未充分反映）** 满足任一：

- `published_at` ≤ 48h
- 或内容中出现强时效线索：`today / just / breaking / minutes ago` 等
- 或市场 24h 变化显著（建议阈值：≥ 8% 由配置控制）

**priced_in（可能已充分定价）** 满足任一：

- 同事实 ≥ 3 个来源重复转述（repeated 聚合）
- 或 `published_at` > 72h 且赔率近 24h 相对稳定（变化 < 阈值）

---
