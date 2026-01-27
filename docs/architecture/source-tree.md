# source-tree.md — AI 预测信号聚合器（MVP / Week 1）

> 目标：用一张“可读的目录树”说明代码结构与职责边界（参考你截图风格：左侧 tree + 右侧注释）。  
> 约定：核心链路 **LLM 只输出 Report v1 JSON**；渲染、校验、发布都在代码侧完成。

---

## 1) 源码目录结构（AI Signal Bot）

```text
.
├─ src/
│  ├─ main.ts                              # 服务入口：加载配置 → init deps → 启动 Admin Bot + Trigger API
│  ├─ bot/                                 # Telegram Admin Bot Adapter（运营触发入口）
│  │  ├─ index.ts                          # bot 启动与路由注册（/publish /regen /status）
│  │  ├─ commands/
│  │  │  ├─ publish.ts                     # /publish <url...>：批处理触发生成+发布
│  │  │  ├─ regen.ts                       # /regen <slug>：重生成（受限流）
│  │  │  └─ status.ts                      # /status <slug>：查询最近一次状态（published/blocked）
│  │  └─ guard.ts                          # admin 白名单校验、命令参数校验、回执格式
│  │
│  ├─ orchestrator/                        # 流水线编排（Trigger API / Orchestrator）
│  │  ├─ index.ts                          # triggerPublish(triggerRegen/triggerStatus) 的统一入口
│  │  ├─ pipeline.ts                       # 单事件 pipeline：唯一的 step 顺序声明处（插入步骤只改这里）
│  │  ├─ batch.ts                          # 多链接批处理：并发控制、汇总回执
│  │  ├─ steps/                            # 每一步可插拔（文件名稳定；顺序由 pipeline.ts 声明）
│  │  │  ├─ url.parse.step.ts              # url → slug
│  │  │  ├─ market.fetch.step.ts           # Gamma 拉取 MarketContext（含 resolution_rules_raw）
│  │  │  ├─ market.orderbook.fetch.step.ts # CLOB 拉取 ClobSnapshot（spread/mid/depth/walls）
│  │  │  ├─ market.pricing.fetch.step.ts   # Pricing 拉取最新价/中位价/历史并生成价格信号
│  │  │  ├─ query.plan.build.step.ts       # QueryStrategy：A/B/C（必要时 D）生成 query plan
│  │  │  ├─ search.tavily.step.ts          # Tavily 多车道检索（含缓存、全局限流）
│  │  │  ├─ evidence.build.step.ts         # EvidenceBuilder：去重/打标/novelty/stance（简版）
│  │  │  ├─ report.generate.step.ts        # LLMProvider：生成 Report v1 JSON（仅 JSON）
│  │  │  ├─ report.validate.step.ts        # Validator：schema + 内容闸门 + 反“喊单”
│  │  │  ├─ telegram.render.step.ts        # Renderer：JSON → TG Markdown 文案（模板渲染）
│  │  │  ├─ telegram.publish.step.ts       # Publisher：TG Bot 推送到 Channel（队列化 + 429 重试）
│  │  │  └─ persist.step.ts                # Storage：Event/Evidence/Report 落 SQLite（可选导出）
│  │  ├─ types.ts                          # Orchestrator DTO：MarketContext/ClobSnapshot/Evidence/Report 等
│  │  └─ errors.ts                         # 统一错误码：INSUFFICIENT_EVIDENCE / CALL_TO_ACTION_DETECTED …
│  │
│  ├─ providers/                           # 外部系统依赖（全部可替换/可 mock）
│  │  ├─ polymarket/
│  │  │  ├─ gamma.ts                       # Gamma API client：events/markets 映射成 MarketContext
│  │  │  ├─ clob.ts                        # CLOB client：/book 等 → ClobSnapshot + 墙识别 proxy
│  │  │  ├─ pricing.ts                     # Pricing client：最新价/中位价/历史价格
│  │  │  ├─ mapper.ts                      # API 响应 → DTO（统一字段口径）
│  │  │  └─ index.ts                       # PolymarketProvider implements MarketProvider
│  │  │
│  │  ├─ tavily/
│  │  │  ├─ client.ts                      # Tavily HTTP client（超时/重试/headers）
│  │  │  ├─ lanes.ts                       # A/B/C/D 车道默认参数与策略（advanced 仅 C）
│  │  │  ├─ cache.ts                       # Tavily 结果缓存（key=slug+day+lane+hash）
│  │  │  └─ index.ts                       # TavilyProvider implements SearchProvider
│  │  │
│  │  ├─ telegram/
│  │  │  ├─ publisher.ts                   # publishToChannel：parse_mode/disable_preview/队列化
│  │  │  └─ index.ts                       # TelegramPublisher implements Publisher
│  │  │
│  │  └─ llm/
│  │     ├─ prompt.ts                      # prompt 加载与拼装（Report v1 / Query extract 可选）
│  │     ├─ client.ts                      # LLM SDK/HTTP client（adapter 共享基础封装）
│  │     ├─ postprocess.ts                 # JSON parse、轻量修复（禁止自由文本）
│  │     └─ index.ts                       # LLMProvider implements generateReportV1()
│  │     └─ adapters/                      # LLM 适配器（供应商可替换）
│  │        ├─ openai.ts                   # OpenAI 适配器
│  │        ├─ anthropic.ts                # Anthropic 适配器
│  │        └─ google.ts                   # Google/Gemini 适配器
│  │
│  ├─ validator/                           # 质量闸门（发布前必跑）
│  │  ├─ schema/
│  │  │  └─ report_v1.schema.json          # Report v1 JSON Schema（与 PRD 对齐）
│  │  ├─ ajv.ts                            # AJV 初始化与 schema 校验
│  │  ├─ gates.ts                          # 内容闸门：双边证据/失败路径/来源覆盖/喊单黑名单
│  │  └─ index.ts                          # validateReport(reportJson) → {ok, code, message, suggestion}
│  │
│  ├─ renderer/                            # 文案渲染（稳定输出 > 文风）
│  │  ├─ templates/
│  │  │  └─ telegram.md.txt                # TG 渲染模板（占位符：{context.title} 等）
│  │  ├─ format.ts                         # 数值格式化、截断 rules（resolution_rules_raw 过长处理）
│  │  └─ index.ts                          # renderTelegram(reportJson) → tg_text
│  │
│  ├─ storage/                             # 数据落地（SQLite 为真相源，Exporter 为可选）
│  │  ├─ sqlite/
│  │  │  ├─ db.ts                          # 连接与 pragma、事务封装
│  │  │  ├─ migrations.ts                  # migration runner（读取 /migrations）
│  │  │  ├─ event.repo.ts                  # Event 表 CRUD
│  │  │  ├─ evidence.repo.ts               # Evidence 表 CRUD
│  │  │  ├─ report.repo.ts                 # Report 表 CRUD（含 status/validator reason）
│  │  │  ├─ ratelimit.repo.ts              # per slug 计数与窗口
│  │  │  └─ cache.repo.ts                  # Tavily/Gamma/CLOB 缓存表（可选）
│  │  ├─ exporters/
│  │  │  ├─ sheet.exporter.ts              # （可选）导出到 Google Sheet/CSV（异步 sink）
│  │  │  └─ notion.exporter.ts             # （可选）导出到 Notion（异步 sink）
│  │  └─ index.ts                          # StorageAdapter：upsertEvent/appendEvidence/saveReport/…
│  │
│  ├─ rate_limit/                          # 限流与并发控制（全局/每 provider/每 slug）
│  │  ├─ token_bucket.ts                   # qps/burst
│  │  └─ regen_guard.ts                    # 5min/1h 的重生成限流（读取 config）
│  │
│  ├─ cache/                               # 缓存抽象（可替换 SQLite/内存/Redis）
│  │  ├─ interface.ts                      # CacheAdapter get/set/delete
│  │  └─ memory_cache.ts                   # 本地内存缓存（PoC 可用）
│  │
│  ├─ config/                              # 配置加载与校验（把错误提前到启动期）
│  │  ├─ config.schema.ts                  # zod / joi schema（建议）
│  │  ├─ load.ts                           # load(config.yaml + env)
│  │  └─ defaults.ts                       # 默认值（A/B/C lanes、parse_mode、阈值等）
│  │
│  └─ utils/                               # 纯工具：可复用、无业务逻辑
│     ├─ http.ts                           # fetch 封装：timeout、retry、backoff、headers
│     ├─ logger.ts                         # pino logger（request_id/slug/step）
│     ├─ time.ts                           # time_remaining 计算、UTC 处理
│     └─ text.ts                           # 去重相似度、截断、敏感词检测等
│
├─ prompts/                                # Prompt 包（文本文件，便于版本管理与审计）
│  ├─ report_v1_generate.prompt.txt        # 生成 Report v1 JSON（禁止输出非 JSON）
│  └─ query_extract.prompt.txt             # （可选）实体抽取生成 query plan
│
├─ schemas/                                # 机器可读 schema（也可与 src/validator/schema 复用）
│  └─ report_v1.schema.json
│
├─ migrations/                             # SQLite migrations（DDL + 索引 + 初始数据）
│  ├─ 001_init.sql                         # Event/Evidence/Report + ratelimit/cache 表
│  └─ 002_indexes.sql                      # 索引优化（slug/published_at/status）
│
├─ fixtures/                               # 录制的外部依赖响应（集成测试用）
│  ├─ polymarket_gamma_event.json
│  ├─ polymarket_clob_book.json
│  └─ tavily_lane_A.json
│
├─ docs/                                   # 文档（PRD/TDD/SOP/Runbook）
│  ├─ PRD_v0.2_BMAD_full.md
│  ├─ TDD_v0.2_AI_Prediction_MVP_Architecture.md
│  ├─ tech-stack.md
│  └─ source-tree.md                       # ← 就是本文件
│
├─ scripts/                                # 运维/本地脚本
│  ├─ dev_publish_sample.sh                # 本地一键跑通示例（带测试 url）
│  └─ backup_sqlite.sh                     # SQLite 备份
│
├─ config.example.yaml                     # 非敏感配置示例（chat_id/阈值/车道参数等）
├─ .env.example                            # 敏感项示例（TG_BOT_TOKEN / TAVILY_API_KEY / LLM_API_KEY）
├─ Dockerfile                              # 生产部署（单容器 + volume）
├─ package.json                            # 依赖锁定
├─ tsconfig.json                           # TS 编译选项（strict）
└─ README.md                               # 快速开始 + 运维说明
```

---

## 2) 目录约定（建议写进 README）

### 2.1 变更频率分层
- `src/orchestrator/steps/*`：业务链路核心（变更频率高，但输入输出必须稳定）
- `src/providers/*`：外部依赖（变更频率中，必须可替换/可 mock）
- `src/validator/*`：发布底线（变更频率低，但很“敏感”，每改必补测试）
- `src/utils/*`：纯工具（变更最谨慎，避免污染业务语义）

### 2.2 命名规则
- Step 顺序：不写在文件名里；在 `src/orchestrator/pipeline.ts` 中用数组/registry 统一编排

- Step 文件：`<domain>.<action>.step.ts`（文件名稳定；顺序在 `pipeline.ts` 声明，避免插入步骤导致全量重命名）
- Provider：`index.ts` 暴露统一实现；具体子 client 按 API 拆分
- DTO：集中在 `src/orchestrator/types.ts`，避免到处散落

---

## 3) Week 1 最小可跑版本（删减清单）
如果要极简落地，可以先只保留：
- `src/bot/`、`src/orchestrator/`、`src/providers/{polymarket,tavily,telegram,llm}`、`src/validator/`、`src/renderer/`、`src/storage/sqlite/`
其余（exporters、cache/、fixtures/）都可后补。
