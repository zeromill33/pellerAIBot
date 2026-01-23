# coding-standards.md — AI 预测信号聚合器（MVP / Week 1）编码规范（数据项目版）

> 目的：为本项目建立“可读、可审计、可复盘、可扩展”的工程约束。  
> 适用范围：Orchestrator/Pipeline、Providers（Polymarket/Tavily/Telegram/LLM）、Validator、Renderer、Storage（SQLite）、Bot 入口与运维脚本。  
> 关键词：**数据可追溯（Provenance）**、**幂等（Idempotency）**、**确定性输出（Determinism）**、**可回放（Replay）**、**边界清晰（Boundaries）**。

---

## 0. 总则（必须读完）

### 0.1 项目目标导向（为什么这些规范必要）
本项目是典型“数据 → 推理 → 结构化输出 → 发布”的链路，风险点集中在：
- 外部依赖不稳定（API 限流/字段变动/数据不一致）
- LLM 非确定性（输出漂移、幻觉、自由文本）
- 报告需要可追溯（证据来源、规则解析、为何被拦截/发布）
- 运营链路需要可复盘（同事件重生成、缓存命中、补搜、失败原因）

因此编码规范必须优先保障：
1) **每一次发布都能被复盘与审计**（谁触发、何时、用哪些证据、走了哪些步骤、为何通过/失败）  
2) **系统可控**（限流、缓存、重试边界、失败快速定位）  
3) **扩展不推倒重来**（新增平台/搜索源/发布渠道不改主流程）

---

## 1. 分层与依赖边界（最重要，违反即拒绝合并）

### 1.1 分层定义（本项目版）
- **Entry Layer**
  - `src/bot/*`（Admin Bot 命令入口）
  - （未来）`src/api/*`（HTTP Trigger API）
  - 只负责：参数解析、权限校验、调用 orchestrator、格式化回执

- **Orchestrator / Pipeline**
  - `src/orchestrator/*`
  - 只负责：链路编排、并发控制、补搜策略、错误封装、Step 注册
  - **不得直接写外部 HTTP 调用细节**（只能通过 Provider 接口）

- **Steps（可插拔）**
  - `src/orchestrator/steps/*`
  - 每一步是纯“业务 step”，只做一件事，输入输出 DTO 明确
  - **不得绕过 Orchestrator 写发布/落库**（由后置 steps 承担）

- **Providers（外部系统依赖）**
  - `src/providers/*`
  - Polymarket/Tavily/Telegram/LLM 等客户端与适配
  - 负责：网络调用、签名/鉴权、限流/重试、响应映射与最小缓存

- **Validator（质量闸门）**
  - `src/validator/*`
  - 负责：schema 校验 + 内容闸门（双边证据、失败路径、喊单拦截、来源覆盖）
  - **任何能发布到 TG 的输出必须先过 Validator**

- **Renderer（稳定渲染）**
  - `src/renderer/*`
  - 负责：Report JSON → TG 文案（模板渲染），禁止再调用 LLM 改写

- **Storage（真相源）**
  - `src/storage/*`（SQLite repo + migrations）
  - 负责：Event/Evidence/Report + rate_limit/cache/status 的一致落地与查询
  - **禁止把 Sheet/Notion 当真相源**（只能作为异步 sink/export）

- **Core / Utils / Obs / Config**
  - `src/utils/*`：纯函数
  - `src/obs/*`：logger/metrics/tracing/redaction
  - `src/config/*`：配置加载/校验
  - 不依赖任何业务层

### 1.2 依赖方向（必须遵守）
- entry(bot/api) → orchestrator → steps → (providers, validator, renderer, storage)  
- steps → 只能依赖：providers / validator / renderer / storage / obs / config / utils / core  
- providers → 只能依赖：obs / config / utils / core（**不依赖 orchestrator/steps/storage**）  
- validator/renderer/storage → 只能依赖：obs / config / utils / core  
- obs/config/utils/core 不依赖任何业务层

> **强制工具**：建议用 `eslint-plugin-boundaries` 或 `tsconfig project references` 强制边界。任何“偷偷 import”都必须被 CI 拦截。

---

## 2. Pipeline / Step 规范（数据链路的骨架）

### 2.1 Step 文件命名与顺序编排
- Step 文件命名：`<domain>.<action>.step.ts`（**文件名稳定**）
- Step 顺序：只在 `src/orchestrator/pipeline.ts` 声明（数组或 registry）
- 禁止：用 `NN_` 前缀把顺序写进文件名（插入步骤会引发全量重命名）

### 2.2 Step 统一接口（强约束）
每个 step 必须导出 `StepDef`（建议）：
- `id: string`（稳定且可追踪，如 `market.fetch`）
- `run(ctx): Promise<Ctx>`（只对 ctx 做“新增字段”，不应破坏已有字段）
- `requires?: string[]`（可选，用于启动时静态检查 ctx 依赖）
- `produces?: string[]`（可选，用于文档化与测试）

### 2.3 数据项目必须具备：幂等与可回放
- **幂等原则**：同一个 `event_slug + day + lane + query_hash` 的检索结果必须可缓存复用  
- **回放原则**：任何一次失败都能通过：
  - 固定输入（event slug + 当日快照/fixtures）
  - 固定配置（lane 参数、阈值）
  - 固定 prompt 版本（prompt hash）
  在本地复现

**落地要求：**
- 每次执行必须生成并贯穿：
  - `request_id`（批次级）
  - `run_id`（单事件级，建议=ULID）
  - `event_slug`
- 所有外部调用与关键 step 必须写入结构化日志（见第 9 节）

---

## 3. Provider 规范（外部依赖可控是成败关键）

### 3.1 Provider 的“三件套”
每个 Provider 必须包含：
1) **Client**：HTTP 调用封装（超时、重试、鉴权、header）
2) **Mapper**：响应 → DTO（禁止业务规则）
3) **Policy**：限流/缓存/退避策略（可配置）

文件结构建议：
- `src/providers/<name>/client.ts`
- `src/providers/<name>/mapper.ts`
- `src/providers/<name>/policy.ts`
- `src/providers/<name>/index.ts`

### 3.2 超时 / 重试 / 退避（硬性要求）
- 所有外部请求必须设置 timeout（读/写可不同）
- 重试只针对明确可重试错误：
  - 429（限流）→ respect `Retry-After`（若有）+ 指数退避
  - 5xx / 网络抖动 → 有上限的重试（默认 2~3 次）
- 禁止：无限重试、或对 4xx（非 429）盲目重试

### 3.3 限流：全局 + 分 Provider + 分事件（多层）
- 全局限流（例如 Tavily qps/burst）
- Provider 并发控制（Polymarket/Tavily/LLM/TG 各自独立）
- per-event 重生成限流（5min 1 次 / 1h 5 次，配置化）

> 限流必须可观测：日志里要有 `rate_limited=true`、等待时长、剩余额度（若可得）。

### 3.4 缓存：必须显式、可追踪、可失效
- 缓存键必须写成函数：`buildCacheKey(input) -> string`
- 缓存 TTL 配置化（默认 1d）
- 必须记录缓存命中：`cache_hit=true/false`

### 3.5 Provider 输出必须“最小化、稳定化”
- DTO 字段命名统一（见第 5 节）
- 严禁把 Provider 原始响应对象穿透到业务层（避免字段漂移污染上层）

---

## 4. LLM 使用规范（本项目的“风险核心”）

### 4.1 LLM 只输出结构化 JSON（硬性）
- `generateReportV1()` **只允许返回 JSON**
- 禁止：混入 markdown、解释文字、建议下注、资金管理建议
- 必须：`JSON.parse` + schema 校验（失败直接 block）

### 4.2 Prompt 版本化与可审计
- 所有 prompt 必须是仓库文件（`/prompts/*.txt`）
- 每次生成必须记录：
  - `prompt_name`
  - `prompt_sha256`
  - `model`
  - `temperature`（建议低）
- 任何 prompt 变更必须有 PR 记录与最小回归测试（fixtures + validator）

### 4.3 反幻觉策略（必须落地）
- 输入里强制提供：resolution_rules_raw、市场概率、证据列表（带 URL）
- 输出里强制：引用足够 URL、双边观点、失败路径具体可观测信号
- Validator 必须拦截：
  - 单边叙事
  - 失败路径空泛
  - 没有来源或来源单一
  - “喊单”语言（买/卖/强烈建议/稳赚等）

### 4.4 概率输出（Beta）规范
- 统一范围：0–100（整数或 1 位小数）
- 必须明确：不是投资建议；仅为模型估计
- 不允许：把概率直接映射成下注建议（如“概率高于市场→买”）

---

## 5. 数据模型与命名（让数据能跑十年）

### 5.1 通用字段命名约定
- ID：
  - `request_id`（批次）
  - `run_id`（单事件）
  - `event_slug`（业务主键）
  - `report_id`（报告）
- 时间：
  - 数据库字段用 `*_at`（UTC，ISO 8601）
  - 数值时长用 `*_ms` 或 `*_seconds`
- 数值：
  - 概率：`*_pct`（0–100）或明确 `probability_0_100`
  - 价格/赔率：显式说明单位/口径

### 5.2 证据（Evidence）必须带来源与归因
Evidence 最小字段（建议强制）：
- `source_type`（official/media/social/onchain/market）
- `url`、`domain`
- `published_at`（若不可得可为空，但要记录 `unknown`）
- `claim`（可复述的事实/观点）
- `stance`（pro/con/neutral）
- `novelty`（new/priced/unknown）
- `repeated`（是否重复被引用）
- `strength`（1–5 简化强度）

### 5.3 Schema 演进（向前兼容）
- schema 文件必须版本化：`report_v1.schema.json` → 未来 `report_v2...`
- 新增字段要：
  - 给默认值或 optional
  - 更新 renderer/validator 的兼容逻辑
  - 更新 fixtures 与回归测试

---

## 6. 错误模型（数据链路必须可归因）

### 6.1 统一 AppError
所有可预期错误必须标准化为 `AppError`：
- `code: string`（稳定错误码）
- `message: string`（人类可读）
- `details?: object`（可选）
- `retryable?: boolean`
- `category?: 'VALIDATION'|'PROVIDER'|'RATE_LIMIT'|'STORE'|'RENDER'|'PUBLISH'|'LLM'|'UNKNOWN'`
- `cause?: unknown`（保留 root cause）

### 6.2 错误码命名规范（便于聚合）
- `BOT_*`、`ORCH_*`、`STEP_*`
- `PROVIDER_PM_*`、`PROVIDER_TAVILY_*`、`PROVIDER_TG_*`、`PROVIDER_LLM_*`
- `VALIDATOR_*`、`RENDER_*`、`STORE_*`

### 6.3 只在入口层做最终输出
- bot/api 负责把 AppError 格式化回执
- 业务层只抛 AppError（或标准化后抛），避免多层重复包装 message

---

## 7. 配置与密钥（配置化是扩展性的前提）

### 7.1 配置加载与校验（启动期失败）
- 所有 config 必须在启动时通过 schema 校验（zod/joi）
- 禁止：运行中才发现缺字段

### 7.2 Secrets 管理
- 只允许通过环境变量注入（CI/部署系统）
- 禁止：写入 repo、写入日志、写入 DB 明文

---

## 8. 可读性与代码结构（“读起来像文档”）

### 8.1 文件大小与拆分
- 单文件建议 ≤ 250 行（例外：schema/fixtures/常量）
- `index.ts` 只 re-export
- 复杂逻辑拆成：`*.service.ts` / `*.repo.ts` / `*.engine.ts`

### 8.2 命名（英文为主，行业缩写有限制）
- 避免无意义词：`data1/tmp/handle/process`
- 函数动词开头：`buildQueryPlan() / fetchOrderbook() / validateReport()`
- 布尔：`is/has/can/should`
- Step id 使用点分层：`market.fetch`、`search.tavily`

### 8.3 控制流（可维护性优先）
- 少嵌套：优先 early return
- 复杂分支必须解释 **why**（不是 what）
- 状态变更集中：例如 `updateReportStatus()` 不允许散落在各处

---

## 9. 可观测性（数据项目的生命线）

### 9.1 结构化日志（必须）
每条关键日志必须包含：
- `service`、`step_id`、`request_id`、`run_id`、`event_slug`
- `provider`（若有）、`latency_ms`
- `cache_hit`、`rate_limited`
- `error_code`、`error_category`（失败时）

### 9.2 指标（可先日志聚合）
建议最小指标：
- `validator_pass_rate`
- `publish_success_rate`
- `tavily_calls_per_event` / `cache_hit_rate`
- `latency_ms`（per step）

---

## 10. 数据库与 Repo 规范（SQLite 真相源）

### 10.1 Repo 只做读写，不做业务决策
- repo 不做阈值判断、不做补搜策略、不做 validator 逻辑

### 10.2 SQL 与迁移
- 所有 DDL/DML 必须参数化
- migrations 必须带索引（slug/status/published_at）
- 大批量操作要分批，避免长事务

### 10.3 UTC 统一
- DB 所有时间字段统一 UTC（不要落本地时区）

---


## 11. 测试与质量门禁（必须更严格：build 通过 + 单测覆盖 + 外部依赖集成测试）

> 目标：把“数据链路 + LLM + 外部 API”这种易漂移系统，变成可持续迭代的工程资产。  
> 原则：**PR 必须绿**（build + typecheck + lint + unit + integration），任何退化必须在 CI 上被挡住，而不是线上发现。

### 11.1 CI 质量门禁（PR 必须通过）
PR（或 main 分支保护）至少包含以下 job（按速度从快到慢）：

1) **build / typecheck**
- `pnpm -s typecheck`（tsc strict）
- `pnpm -s build`（tsup/tsc，确保可打包）

2) **lint / format**
- `pnpm -s lint`
- （可选）`pnpm -s format:check`

3) **unit tests（必须）**
- `pnpm -s test`（单元测试，默认不触网）

4) **integration tests（必须）**
- `pnpm -s test:integration`（Provider/Storage/Orchestrator 集成测试，默认走 record/replay 或 mock server）

5) **e2e smoke（建议）**
- `pnpm -s test:e2e`（本地跑一个最小链路：/publish → 生成 → validate → render，不发真 TG）

> **禁止**：在 PR 里依赖“真实外网 API”才能通过测试（会导致 flaky）。

### 11.2 覆盖率要求（强制阈值 + 关键模块更高）
全局覆盖率最低阈值（示例，落到 CI）：
- lines ≥ 85%
- branches ≥ 75%
- functions ≥ 80%
- statements ≥ 85%

关键模块单独阈值（更高）：
- `src/validator/**`：lines ≥ 95%、branches ≥ 90%
- `src/orchestrator/**`：lines ≥ 90%
- `src/providers/**`：lines ≥ 85%（重点覆盖 mapper/policy）
- `src/storage/sqlite/**`：lines ≥ 90%

允许排除项（必须在配置里显式列出）：
- schema 文件、fixtures、纯常量、generated 文件（禁止“随便排除业务代码”）

### 11.3 单元测试范围（必须覆盖“各种情况”）
单元测试目标：**每个模块的所有分支、边界条件、错误路径都要覆盖**。建议按模块给出明确用例清单：

#### A) Validator（最重要，必须“白盒覆盖”）
必须覆盖：
- schema 失败（缺字段/类型错/概率不在 0–100）
- 内容闸门：
  - pro/con 任一侧 < 2
  - failure_modes < 2 或 observable_signals 为空/过短
  - url 数量不足、域名不多样
  - 命中“喊单/投资建议”黑名单
  - sentiment 空样本时必须回落到 unknown
- suggestion 输出（需要补搜 lane C / 启用 D 查询组）是否正确

> 推荐：对 validator 的核心规则做 **表驱动测试**（case table），每条规则至少 2 个用例：触发 & 不触发。

#### B) EvidenceBuilder（去重/归因/立场）
必须覆盖：
- URL 去重、domain 归一化
- claim 抽取空值/过长截断
- stance/novelty 标注默认值
- repeated 判定
- 多来源同一观点 → 聚合行为

#### C) QueryStrategy（多车道 query plan）
必须覆盖：
- A/B/C 默认生成
- 触发条件下启用 D 查询组（多类型 Query）
- query 过长、包含特殊字符的清洗
- 领域差异（crypto/politics/sports）模板分支（若存在）

#### D) Orchestrator（编排与错误传播）
必须覆盖：
- 单事件全链路 happy path（mock provider）
- 任一 step 失败 → 结束并返回标准 AppError（错误码/建议）
- 补搜触发逻辑（第一次 validator fail → 补搜 → 通过/仍失败）
- batch：
  - 多 URL 并发，部分成功部分失败
  - 并发度配置生效（可用 fake provider 统计并发峰值）
- 限流：
  - 5min/1h 重生成拦截

#### E) Renderer（确定性输出）
必须覆盖：
- 所有模板字段渲染（含缺失字段 fallback）
- 长文本截断（resolution_rules_raw）
- Markdown 转义（如果使用 MarkdownV2 必测）
- 输出稳定：同输入 hash → 文案完全一致（snapshot 测试）

#### F) Storage（Repo & Migration）
必须覆盖：
- migrations 可从空库跑到最新版本
- repo CRUD：upsertEvent/appendEvidence/saveReport/getLatestReport
- 索引相关查询路径（slug/status/published_at）
- 事务边界：persist step 内多表写入要么全成功要么全失败

### 11.4 Provider 集成测试（外部依赖：必须有“可回放”测试）
Provider 的测试必须分为两类：

#### A) Record/Replay（默认跑，CI 必须稳定）
- 用 mock server（推荐 `msw`/`undici MockAgent`/`nock`）拦截 HTTP
- 使用 `fixtures/` 保存 “原始响应” 与 “期望 DTO”
- 测试断言：
  - mapper 输出 DTO 字段完整、类型正确、默认值正确
  - policy 生效（timeout、retry、backoff、rate limit）
  - cache key 生成一致、命中行为正确

建议 fixtures 组织：
- `fixtures/providers/polymarket/gamma/event_*.json`
- `fixtures/providers/polymarket/clob/book_*.json`
- `fixtures/providers/tavily/lane_A_*.json`
- `fixtures/providers/telegram/publish_*.json`（可用 mock）

#### B) Live Contract（非默认，nightly 或手动触发）
- 只在：
  - `TEST_LIVE=1` 环境变量开启
  - 并且具备 secrets（API keys）
  时运行
- 只做“契约测试”（contract）：
  - 能否成功请求
  - 关键字段仍存在（不做内容断言）
  - 若字段缺失 → 立即报警（说明 API 变更）

> 这样可以同时获得：CI 稳定（replay）+ 真实变更预警（nightly live）。

### 11.5 Provider 必测的“故障注入”场景
每个 Provider 的集成测试必须覆盖以下故障注入：
- 429（含 Retry-After 与不含 Retry-After）
- 500/502/503（重试次数与退避是否符合 policy）
- timeout（必须触发超时错误码）
- 非法 JSON / 空 body（必须标准化错误）
- schema 漂移（关键字段缺失）→ mapper 必须给默认值或抛 AppError（取决于策略）

### 11.6 LLM 测试策略（禁止“靠模型随机性”）
LLM 的测试必须 **全部 mock**（CI 禁止真实调用），并覆盖：
- 返回非 JSON → 必须 block（AppError + validator_code）
- 返回 JSON 但不满足 schema → 必须 block
- 返回 JSON 满足 schema，但触发内容闸门（喊单、单边、来源不足）→ 必须 block
- prompt 版本化：prompt hash 变化会出现在 report 元信息（如你有记录）

建议提供：
- `fixtures/llm/report_valid.json`
- `fixtures/llm/report_invalid_schema.json`
- `fixtures/llm/report_call_to_action.json`

### 11.7 端到端 E2E（最小 smoke，保证“交互闭环”）
E2E 目标：验证“入口 → orchestrator → providers(mock) → validator → renderer → storage”的闭环。
- 使用 fake providers（不触网）
- TG 发布改成 `FakePublisher`（只记录 message）
- 断言：
  - status=published/blocked 正确
  - storage 中落地三表数据完整
  - 失败时回执包含 error_code 与 suggestion

> E2E 不需要覆盖所有分支，但必须覆盖“最关键闭环”。

### 11.8 可重复性（Determinism）要求
所有测试必须可重复：
- 固定时间：使用 fake timers 或注入 `now()`（避免 Date.now() 漂移）
- 固定随机：如有随机/uuid，使用可注入 generator（或固定 seed）
- 输出稳定：Renderer 需要 snapshot；Validator 需要 table-driven 断言

### 11.9 Flaky 控制（必须）
- 默认 CI 不跑 live tests
- 对异步与并发测试，使用明确等待与超时
- 对重试/退避逻辑测试，使用 fake timers（不要 sleep）

### 11.10 每次 bug 修复的 DoD（回归要求）
- 任一线上/灰度问题修复必须：
  1) 增加可复现的 fixture（输入/外部响应）
  2) 增加单测或集成测试覆盖该失败路径
  3) 在 PR 描述里附上：失败原因、测试用例链接、修复点

---

## 12. 文档与变更（工程化交付）

- 新增 Provider：必须补 `docs/providers/<name>.md`（接口、限流、缓存、错误码）
- 新增错误码：必须补 `docs/errors.md`
- 变更 schema/prompt：必须更新 fixtures 与回归用例
- Mermaid 图：避免智能引号与奇怪标点；建议 label 用引号包裹

---

## 13. 工具与强制约束（建议写进 CI）

### 13.1 tsconfig（推荐）
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noImplicitOverride": true
  }
}
```

### 13.2 eslint（推荐）
- 禁止 `any`：`@typescript-eslint/no-explicit-any: "error"`
- 禁止悬空 promise：`@typescript-eslint/no-floating-promises: "error"`
- 强制 import 顺序
- 强制边界：`eslint-plugin-boundaries`（推荐）

---

## 14. 本项目的“不可妥协清单”（Do Not Merge）
以下任一项出现，必须修改后才能合并：
1) Provider 直接被 step 以外代码绕过（或业务层直接 fetch 外部）
2) LLM 输出不是严格 JSON（或绕过 schema 校验）
3) 发布前未走 Validator（任何 TG 推送都必须被 validator 盖章）
4) 无 request_id/run_id/event_slug 的关键日志
5) 无 timeout 的外部请求
6) 把 Sheet/Notion 当真相源（主链路依赖其写入成功）
7) PR 未通过：typecheck/build/lint/unit/integration 任一失败
8) 覆盖率低于阈值或关键模块阈值不达标（validator/orchestrator/storage）
9) 引入依赖真实外网 API 才能稳定通过的测试（导致 flaky）

---

## 附：建议的目录边界（示例）
- `src/bot/**` 只能 import：`src/orchestrator/**`, `src/obs/**`, `src/config/**`, `src/utils/**`
- `src/orchestrator/**` 只能 import：`src/providers/**`, `src/validator/**`, `src/renderer/**`, `src/storage/**`, `src/obs/**`, `src/config/**`, `src/utils/**`
- `src/providers/**` 只能 import：`src/obs/**`, `src/config/**`, `src/utils/**`
- `src/validator/**`, `src/renderer/**`, `src/storage/**` 同理
