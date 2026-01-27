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

#### E.4 推荐落地路径（可扩展但不复杂）

目标：用**最小适配层**对接多家 LLM（OpenAI / Anthropic / Google），保持可替换性，避免引入重型框架。

**推荐结构**
- `src/providers/llm/`
  - `prompt.ts`：拼装 system/user prompt（版本化）
  - `postprocess.ts`：JSON parse + 轻量修复（禁止自由文本）
  - `index.ts`：`LLMProvider` 实现与适配器选择
  - `adapters/`
    - `openai.ts`
    - `anthropic.ts`
    - `google.ts`

**最小适配器接口（建议）**
```ts
export interface LLMAdapter {
  generateJson(prompt: { system: string; user: string }, opts: {
    model: string;
    temperature?: number;
  }): Promise<{ text: string; raw?: unknown }>;
}
```

**实现要点**
- `index.ts` 根据 `config.llm.provider` 选择适配器（`openai | anthropic | google`），并传入 `config.llm.model/temperature`。
- 适配器只负责“把 prompt 送到模型并返回原始文本”，**不做业务逻辑**；业务逻辑统一在 `postprocess.ts` 与 Validator。
- 保持“结构化 JSON 输出 + schema 校验”的主流程不变；失败直接阻断。
- 新增模型/供应商时，只需新增一个 adapter 文件并注册即可。

**配置建议（最小集）**
- `llm.provider`: `openai | anthropic | google`
- `llm.model`: 具体模型名（配置化）
- `llm.temperature`: 默认低温（如 0~0.2）
- `LLM_API_KEY_*`: 按供应商区分环境变量（仅注入，不落库）

---
