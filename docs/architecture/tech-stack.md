# tech-stack.md — AI 预测信号聚合器（MVP / Week 1）

> 依据：TDD v0.2（聚焦“运营触发 → 报告生成 → 校验 → 三表落地 → TG 推送（可选运营校验）”的闭环）  
> 目标：把 Week 1 **必须落地**的技术选型定死，同时为 Phase 2/3（多平台、多渠道、队列化、Web 端）保留扩展插槽。

---

## 1) 总览

### 1.1 运行形态（Week 1）
- **单进程服务**（Node.js + TypeScript）：
  - Admin Bot Adapter（运营命令触发）
  - Orchestrator（流水线编排）
  - Providers（Polymarket / Tavily / LLM / Telegram）
  - Storage（SQLite 主存储，可选 Sheet/Notion 导出器）

### 1.2 关键原则（影响选型）
- **LLM 只产出结构化 JSON**（Report v1 schema），渲染由代码完成
- **Validator 作为发布闸门**（schema + 内容规则 + 反“喊单”）
- Provider/Adapter 分层：所有外部系统依赖都可替换、可 Mock、可限流

---

## 2) 语言与运行时

- **语言**：TypeScript（严格模式）
- **运行时**：Node.js（建议 18+，生产可用 20 LTS）
- **模块制式**：ESM（统一 import/export）
- **代码规范**：
  - 核心路径避免 `any`（使用显式类型、`readonly`、DTO）
  - 所有 I/O（网络、DB、TG）都必须有超时与重试边界

---

## 3) 依赖与工程化

### 3.1 包管理 / 构建
- 包管理：`pnpm`（推荐）或 `npm`
- 构建：`tsup`（推荐）或 `tsc`（更朴素）
- Lint/Format：`eslint` + `prettier`
- Git hooks（可选）：`lint-staged` + `husky`

### 3.2 目录建议（与 TDD 对齐）
- `src/orchestrator/`：流水线编排、step 定义
- `src/providers/`：`polymarket/`, `tavily/`, `telegram/`, `llm/`
- `src/storage/`：sqlite + exporter（可选）
- `src/validator/`：schema 校验 + 内容闸门
- `src/renderer/`：TG 模板渲染
- `src/config/`：配置加载与校验

---

## 4) 外部系统依赖（Providers）

> Week 1 **强依赖**：Polymarket、Tavily、Telegram、LLM、SQLite  
> Week 1 **默认关闭**：社交情绪聚合器（但预留接口）

### 4.1 MarketProvider：Polymarket
- **Gamma API（事件/市场元数据）**
  - event/market 查询：标题、描述、结算条件原文、截止时间、赔率、关联 token ids
- **CLOB API（盘口/订单簿）**
  - book depth、spread、midpoint、墙（notable walls）识别
- 目的：支撑 Report v1 的【0】【1】【3】以及流动性/市场行为 proxy

**实现要求**
- Provider 内置：
  - 并发控制（provider-level concurrency）
  - 429/5xx 退避重试（指数退避 + jitter）
  - 结果缓存（同一 slug 同日复用，或按步骤缓存）

### 4.2 SearchProvider：Tavily（资讯上下文）
- 默认 **A/B/C 三车道**（Update / Primary / Counter）
- **D 条件触发**（赔率 24h 大幅波动/社交驱动/分歧不足），触发时执行 2–3 类不同类型 Query
- 新闻上下文可替换为 NewsData/Perigon 作为 News Provider，减少 Tavily 消耗
- 目的：给 Disagreement、Priced vs New、Failure modes 提供可追溯证据 URL

**实现要求**
- 全局限流（qps/burst）+ 单事件重生成限流（5min 1次 / 1h 5次）
- 缓存键：`slug + day + lane + query_hash`（TTL=1d）

### 4.3 Publisher：Telegram
- TG Bot 向 **指定 Channel** 推送（落地后/可审核，chat_id 配置化）
- parse_mode：Markdown（或 MarkdownV2/HTML 可配置）
- 默认关闭网页预览（避免刷屏）
- 运营触发入口：Admin Bot 命令（/publish /regen /status）

**实现要求**
- 发布队列（至少单进程内队列）+ 429 重试
- admin 白名单校验（`admin_user_ids`）

### 4.4 LLMProvider：报告生成
- 输出：**严格 Report v1 JSON**（由 schema 校验）
- 允许输出 AI 概率 Beta（0–100），但禁止下注建议与资金管理建议
- 推荐：对模型输出做 **两步安全**：
  1) JSON parse + schema 校验（硬失败）
  2) 内容闸门（喊单、缺双边、失败路径泛化、来源不足等）

> 具体模型与供应商不在 Week 1 强绑定；只要实现 `generateReportV1()` 接口即可。

### 4.5 Social/Sentiment Provider（Week 1 默认关闭）
- 预留 `SentimentProvider` 接口：
  - 输入：事件实体与 query plan
  - 输出：抽样观点列表 + 情绪倾向（带来源）
- Week 1 可先用 Tavily D 作为轻量 fallback；Phase 2 再评估引入专用聚合器。

---

## 5) 存储与数据层（Storage）

### 5.1 Week 1 主存储：SQLite
用途：
- Event/Evidence/Report 三表落地
- rate-limit 计数（per event）
- cache 索引（Tavily 结果缓存、Gamma/CLOB 缓存）
- 状态审计（published/blocked + validator reason）

实现建议：
- SQLite 文件持久化挂载（Docker volume）
- 表结构与索引以 migration 管理（可后续补 `migrations/`）

### 5.2 可选导出（非真相源）
- Notion/Sheet：作为运营可读视图（Exporter / Sink）
- 导出要异步化：不影响发布主链路

---

## 6) 缓存与限流

### 6.1 限流
- **重生成限流（per slug）**：5 分钟 1 次；1 小时最多 5 次（配置化）
- **Tavily 全局限流**：qps/burst（配置化）
- **Provider 并发**：Polymarket/Tavily/LLM/TG 各自独立控制并发

### 6.2 缓存
- 同日同事件同车道：缓存 Tavily 结果（TTL=1d）
- 同事件短期缓存：Gamma 事件元数据、CLOB 快照（TTL 可短一些，按需求）

---

## 7) 校验与安全护栏（Validator）

### 7.1 Schema 校验（硬门槛）
- JSON 可解析
- 严格匹配 Report v1 schema（建议使用 AJV）

### 7.2 内容闸门（发布前拦截）
- 结算条件原文不能为空
- pro/con 各 ≥ 2
- failure_modes ≥ 2 且必须包含 observable_signals（禁止空泛）
- 引用 URL ≥ 4 且域名多样性（可配置阈值）
- 反“喊单”黑名单（命中直接阻断）
- sentiment 无样本则 bias/relation=unknown

---

## 8) 可观测性（Week 1 最小可用）

- 结构化日志：建议 `pino`（或等价 JSON logger）
- 每次 publish 批次带 `request_id`，每条事件带 `slug`
- 关键指标（可先日志聚合，后续上 Prometheus）：
  - validator_pass_rate
  - publish_success_rate
  - tavily_calls_per_event / cache_hit_rate
  - latency_ms per step

---

## 9) 测试策略

- 单元测试：Provider 的响应解析、Query Strategy、Evidence 去重、Renderer
- 集成测试（最重要）：
  - 使用 recorded fixtures（Gamma/CLOB/Tavily）跑通全链路
  - Validator 的 fail/pass 用例（尤其“喊单”与“失败路径泛化”）
- E2E（可选）：
  - sandbox TG channel（测试环境 chat_id）

---

## 10) 部署与运维（Week 1）

- 部署形态：Docker（推荐）或 PM2/systemd
- 配置：`config.yaml` + 环境变量注入 secrets
- 数据：SQLite 文件持久化卷
- 备份：定时备份 SQLite（或导出 report_json 到对象存储）

---

## 11) 配置与密钥管理

- `config.yaml`（非敏感项）：
  - telegram：channel_chat_id、parse_mode、disable_preview、admin_user_ids
  - rate_limit：regen 限流、tavily qps/burst
  - cache：ttl、key_strategy
- secrets（敏感项）通过环境变量：
  - `TG_BOT_TOKEN`
  - `TAVILY_API_KEY`
  - `LLM_API_KEY`（若使用第三方模型）

---

## 12) 扩展路线（确保不推倒重来）

- 多平台：新增 `KalshiProvider implements MarketProvider`
- 多搜索源：新增 `ExaProvider implements SearchProvider`
- 多渠道：新增 `DiscordPublisher / WebPublisher`
- 队列化：引入 JobQueue（Redis/BullMQ）把 Orchestrator 拆 worker
- Web 端：复用同一套 Trigger API 与存储层，新增 Dashboard UI

---

## 13) 技术选型清单（Week 1 建议落地版本）

> 版本号可在仓库中以 `package.json` 锁定；以下为“推荐组合”。

- Runtime: Node.js 18+（建议 20 LTS）
- Language: TypeScript（strict）
- Schema validate: AJV
- HTTP: Node `fetch`（或 `undici`）+ 超时/重试封装
- Telegram Bot: `grammY`（或 `telegraf`）二选一（建议固定一个）
- SQLite: `better-sqlite3`（或 `sqlite3`）二选一（建议固定一个）
- Logging: `pino`
- Concurrency/Rate-limit: `bottleneck`（或自研 token bucket）
- Tests: `vitest`（或 `jest`）
