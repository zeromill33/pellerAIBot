# 附录 E：LLMProvider ——结构化报告生成（Report v1）

#### E.1 输出强约束

- LLM 必须输出 **Report v1 JSON**（严格按 schema）
- Renderer 只吃 JSON，不让 LLM 直接产 TG 文本（避免“渲染幻觉”）

#### E.2 建议的实现形态

- `Prompt Template`（system + user）固定版本化：`report_v1@2026-01-23`
- `Schema Validation`：AJV（已在主文档提到）
- `Guardrails`：
  - 禁止投资建议措辞（即使你们显示 AI 概率，也要写“信息解释”）
  - 必填项缺失 → 直接 fail

#### E.3 最小接口

```ts
export interface LLMProvider {
  generateReportV1(input: {
    context: MarketContext;
    evidence: EvidenceDigest;
    clob?: OrderBookSummary[];
    config: { aiProbabilityScale: "0-100" };
  }): Promise<ReportV1Json>;
}
```

---
