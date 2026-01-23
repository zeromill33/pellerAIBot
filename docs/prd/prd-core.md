# AI 预测信号聚合器（MVP）PRD v0.2（BMAD）

**文档状态**：Draft（可评审/可开工）  
**日期**：2026-01-22（Asia/Tokyo）  
**范围**：Week 1 Content Ops + Telegram Channel 落地后推送闭环（运营触发）  
**首发平台**：Polymarket  
**外部资讯**：Tavily（已选定）  
**概率标准**：0–100（AI 概率 Beta + 市场概率一致口径）  

---

## B — Business（业务与价值）

### B1. 背景与痛点

预测市场用户在真实决策中面对的不是“有没有信息”，而是：

- 赔率在变，但不知道 **为什么变**
- 信息很多，但不知道 **哪些已被定价、哪些是新增**
- 社交媒体吵翻天，但难辨 **噪音 vs 关键变量**
- 直觉有倾向，但缺少 **结构化论据与失败路径**

### B2. MVP 核心价值主张

MVP 不替用户下注，而是让用户拥有“投研终端级”的信息处理能力：

- 把赔率 → 转译成“市场在赌什么”（判断对象与关键假设）
- 自动完成 80% 的脏活（市场数据 + 资讯检索 + 去重归纳 + 证据绑定）
- 把“感觉下注”升级为“结构化判断”（分歧点/定价 vs 新增/失败路径/风险类型）

### B3. MVP 目标（Week 1）

1) **运营可稳定产出**：运营输入任意数量 Polymarket 市场链接 → 系统生成对应报告 → 先落地 →（可选运营校验）→ 推送到 Telegram Channel  
2) **报告结构一致**：每个事件必须输出 Report v1 的完整强制结构（0–9 段）  
3) **证据可追溯**：关键判断必须绑定来源（URL + 来源类型 + 时间），可复盘、可校验  

### B4. 非目标（明确不做）

- 不接入第二平台（Kalshi 等暂不考虑）
- 不做自动交易/托管/策略执行
- 不接 X/Reddit 全量社交 API（Week 1 仅轻量抽样）
- 不扫链做 holder balance/全量持仓分布（Week 1 仅 Liquidity Proxy）
- 不做复杂发布频率/触发调度（运营主动触发即可）

### B5. 成功指标（Week 1 可观察）

**产出效率**

- 每日可发布 N 条（由运营决定，可 >5）
- 单条从输入→落地/推送的端到端耗时可控（目标：分钟级）

**质量（硬指标）**

- Validator 通过率 ≥ 80%
- 结算规则误读率 ≈ 0（出现即 P0）
- 引用来源覆盖：每条报告至少 4 个不同 URL，且不全来自同一域名
- 禁止“喊单”：报告不出现下注方向/仓位建议（命中黑名单即阻断）

---

## M — Market（市场与用户）

### M1. 目标用户（MVP）

- **普通预测市场参与者**：希望 3 分钟内理解“赌点、分歧、反转信号”
- **重度玩家/研究型用户**：需要更快识别变量与失败路径，并评估定价偏差

### M2. 首发范围

- 平台：**Polymarket**
- 领域：**加密 / 政治 / 体育**（不强制配比，运营按热点决定）

### M3. 产品形态（MVP）

- **Telegram Channel + Bot 推送（落地后/可审核）**
  - 运营在后台/工具中输入链接（数量不固定）
  - 系统生成并落地，按策略推送到 TG Channel（自动或运营确认）
  - 运营可触发“重复生成”（受限流）

---

## A — Architecture（系统与数据架构）

### A0. 工程原则（Week 1）

- 不写复杂爬虫；采用 **官方 API + Tavily 智能搜索**
- 先结构化、后渲染：**LLM 输出固定 JSON → 程序渲染 TG 文案**
- 有质量闸门：**Validator 不通过即阻断推送，但仍落地记录**
- 可复盘：Event/Evidence/Report 三表落地（先 Notion/Sheet，后续可迁移 DB）

### A1. 数据来源

#### A1.1 Polymarket 官方数据

- **Gamma API**：市场/事件元数据（标题、描述、结算条件原文、截止时间、赔率、clob token ids）
- **CLOB API**：订单簿深度、价差/中间价、价格相关数据（用于“盘口结构、流动性、市场行为”）

#### A1.2 外部资讯：Tavily（已选定）

- 采用 Tavily Search API 获取清洗后的网页正文上下文
- 新闻上下文默认走 Tavily；也可直接接 NewsData/Perigon 作为 News Provider，减少 Tavily 消耗
- 采用 **多车道检索（3+1）**：按目的拆分 query，保证分歧与失败路径材料充足  
  - A：最新进展（Update/Catalyst）  
  - B：一手来源（Primary/Official）  
  - C：反方论据/争议（Counter/Controversy）  
  - D：轻量社交抽样（Chatter Sample，条件触发；触发时执行 2–3 类 Query）  

#### A1.3 社交媒体情绪（Week 1 轻量）

- 不接社交 API
- 默认不跑社交抽样；仅在满足条件时启用 Tavily D（Chatter）
  - 赔率 24h 大幅波动
  - 事件为“社交驱动”（加密/政治争议）
  - Disagreement Map 证据不足
- D 启动时必须执行 2–3 类不同类型 Query，并在报告标注“抽样，不代表全量”

### A2. 核心模块（Week 1）

1) **Link Ingestor**
   - 输入：Polymarket event URL（/event/<slug>）
   - 输出：slug

2) **Market Context Builder**
   - Gamma 拉取：title/description/resolution_rules_raw/end_time/market_odds/clob_token_ids
   - CLOB 拉取：book_top_levels、spread、midpoint、价格变化（如 24h）

3) **Tavily Multi-lane Search**
   - 基于标题/描述/截止时间生成 A/B/C 三车道 query
   - D 为条件触发车道，触发时必须执行 2–3 类不同类型 Query
   - 拉取结果并保留 raw_content（用于 LLM 证据引用）

4) **Evidence Builder**
   - 合并去重（URL、同域同标题相似）
   - 标注来源类型（五选一：官方公告/主流媒体/社交讨论/链上数据/市场行为）
   - 标注 priced-in vs new（Week 1 规则即可）

5) **Report Generator（LLM）**
   - 输出 Report v1 严格 JSON（固定 schema，概率 0–100）
   - 强制双边证据、失败路径可观察信号、风险类型、局限性等

6) **Validator（质量闸门）**
   - Schema 校验 + 内容闸门（缺项/泛化/喊单 → 阻断）

7) **Renderer + Publisher**
   - JSON → TG Markdown 文案渲染
   - 落地后推送，支持运营确认后发布

### A3. 数据落地（Week 1：Notion/Sheet）

三张表（字段详见附录 H）：

- Event：市场级上下文 + 流动性代理
- Evidence：多车道证据归一化
- Report：完整 JSON + TG 文案 + 发布状态

### A4. Liquidity & Inventory Proxy（Week 1）

- 不扫链 holder balance
- 使用代理指标：
  - Gamma：liquidity / volume（整体规模）
  - CLOB：orderbook depth、spread、midpoint（真实可交易流动性）
- 对外统一称 **Liquidity Proxy**（避免误导）

### A5. 限流与重试（已确认）

- 支持运营不满意时重复生成，但受限流控制（来自配置文件）：
  - **同一事件 5 分钟内最多 1 次**
  - **同一事件 1 小时最多 5 次**
- Tavily 全局速率可配置（qps/burst）
- 同一天可缓存同事件同车道结果（减少额度消耗）

---

## D — Design / Delivery（交互、模板与交付）

### D1. 用户/运营交互（MVP）

#### 运营侧（触发）

- 输入：一组 Polymarket 链接（数量不固定）
- 动作：点击“生成并发布”
- 结果：
  - 若 Validator 通过 → 先落地 →（可选运营校验）→ 推送 TG Channel
  - 若失败 → 返回失败原因 + 可点击“重新生成”（受限流）

#### 用户侧（消费）

- 在 TG Channel 阅读报告
- 每条报告结构稳定，可快速定位：分歧点/新增信息/失败路径/风险类型

### D2. Report v1（强制输出结构）

每个事件必须输出完整结构（0–9）：

0) Context Header（含结算条件原文）  
1) Market Framing（市场在赌什么）  
2) Disagreement Map（双边至少 2 条）  
3) Priced vs New（来源类型标注）  
4) Sentiment vs Market（抽样即可）  
5) Key Variables（1–2 个变量 + 可观察信号）  
6) Failure Modes（至少 2 条，必须具体 + 信号）  
7) Risk Attribution（风险类型）  
8) Limitations（AI 自我约束）  
9) AI 概率（Beta）vs 市场概率（0–100，≤3 条差值驱动证据 + 免责声明）

> 注意：允许输出 AI 概率估计，但 **禁止下注方向/资金管理建议**。

### D3. Tavily 多车道检索策略（Week 1）

- 默认 A/B/C 三车道
- D（Chatter）仅在条件触发时启用，且必须执行 2–3 类不同类型 Query
  - 赔率 24h 大幅波动
  - 事件为“社交驱动”（加密/政治争议）
  - Disagreement Map 证据不足
- 参数默认值与 query 生成规则详见附录 D

### D4. 推送策略（落地后/可审核）

- TG Bot 推送到指定 Channel（落地后，支持自动或运营确认）
- 推送格式：Markdown（或 MarkdownV2/HTML 由配置指定）
- 默认关闭网页预览（避免刷屏）

---

## P0 交付范围（Week 1）

### P0 必交付

1) Polymarket 链接输入 → slug 解析 → Gamma/CLOB 拉取  
2) Tavily 多车道检索（A/B/C + D 条件触发，多类型查询）+ 结果归一化与去重  
3) LLM 输出 Report v1 JSON（0–100 概率）  
4) Validator 质量闸门（阻断机制）  
5) JSON 渲染为 TG 文案  
6) Event/Evidence/Report 三表落地（Notion/Sheet，发布前必须落地）  
7) TG Bot 推送到 Channel（可配置自动或运营确认）  
8) 限流/重试策略（5min/1h）配置化  

### P1（不在 Week 1 强制）

- TG 内交互式 bot 命令（/analyze、/top、/history）
- 报告存档页 / 检索
- 统计看板（通过率、来源覆盖、命中率等）

---

## 风险与对策（Week 1）

1) **结算规则误读（最高风险）**  

- 对策：强制保留原文；Validator 缺失直接阻断；运营抽查可点开市场页核对

2) **LLM 幻觉（杜撰来源/事实）**  

- 对策：关键段落必须绑定 URL；Validator 强制来源数量与域名多样性；若不足触发补搜

3) **单叙事/同质信息**  

- 对策：多车道检索；C 车道专挖反方论据；Disagreement Map 双边硬约束

4) **额度/速率限制**  

- 对策：限流 + 缓存；默认 A/B/C；D 条件触发且多类型查询；advanced 仅用于 C 车道（按需）

5) **合规/误导风险（喊单）**  

- 对策：禁止下注建议；自动黑名单；Report v1 固定免责声明

---

## Week 1 最终交付物清单

1) Report v1 JSON Schema（附录 B）  
2) TG 渲染模板（附录 C）  
3) Tavily 多车道（含 D 条件触发）query 生成规则 + 参数默认值（附录 D）  
4) Evidence Builder 归一化/去重/打标规则（附录 E）  
5) Validator 质量闸门规则（附录 F）  
6) LLM Prompt 包（结构化 JSON 生成；可选实体抽取）（附录 G）  
7) Notion/Sheet 三表字段字典（附录 H）  
8) 运营 SOP（落地后推送版）（附录 I）  
9) 配置文件规范（含限流、缓存、TG、Tavily）（附录 A）  

---
