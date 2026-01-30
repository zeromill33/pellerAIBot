# Week 1 Epic 规划（基于 PRD v0.2）

## 范围与原则
本规划以 `docs/prd/prd-core.md` 的 Week 1 范围为准，目标是跑通“运营触发 → 生成 → 校验 → 落地 →（可选运营校验）→ 推送”的闭环。以下 Epic 以可交付为导向，覆盖 P0 必交付内容与关键质量闸门。

## Epic 1：运营触发与流程编排
目标：让运营可批量触发并获取可读回执。

### Stories
- E1-S1 多链接输入解析与 slug 提取（含非法链接识别）
- E1-S2 单次触发的批处理编排与逐条结果汇总
- E1-S3 失败原因结构化回执（含可重试提示）
- E1-S4 触发入口与最小权限控制（Bot/CLI/HTTP 任选其一）

## Epic 2：市场数据采集与流动性代理
目标：从 Polymarket 获取可用于报告的市场上下文。

### Stories
- E2-S1 Gamma 拉取事件与市场元数据并映射为 MarketContext
- E2-S2 CLOB 拉取订单簿摘要并映射为 ClobSnapshot
- E2-S3 获取 tokenId 价格信息（最新价/中位价/历史价格）
- E2-S4 计算 Liquidity Proxy 并合并到上下文

## Epic 3：Tavily 多车道检索
目标：产出可追溯且足量的外部证据候选。

### Stories
- E3-S1 A/B/C 查询生成规则与参数默认值落地
- E3-S2 Tavily 检索与 raw_content 采集
- E3-S3 D 车道条件触发（赔率波动/社交驱动/分歧不足）且执行 2–3 类查询

## Epic 4：Evidence Builder
目标：把检索结果归一化为可用于报告的证据集。

### Stories
- E4-S1 证据合并去重（URL/同域同标题/相似度）
- E4-S2 来源类型标注（官方/媒体/社交/链上/市场）
- E4-S3 stance 标注（支持/反对/中立）
- E4-S4 priced-in vs new 标注规则落地

## Epic 5：Report v1 生成
目标：产出结构稳定、严格 JSON 的报告。

### Stories
- E5-S1 LLM 输入组装（MarketContext + Evidence + Liquidity Proxy）
- E5-S2 输出 Report v1 JSON（0–9 段齐全）
- E5-S3 AI 概率与市场概率输出，显式免责声明与禁喊单

## Epic 6：Validator 与补搜闭环
目标：确保报告在发布前通过质量闸门。

### Stories
- E6-S1 JSON Schema 校验与错误码返回
- E6-S2 内容闸门（双边证据、失败路径、URL 多样性、反喊单）
- E6-S3 失败触发补搜并重跑验证

## Epic 7：数据落地与运营校验
目标：先落地再发布，确保可追溯与可审核。

### Stories
- E7-S1 Event/Evidence/Report 三表落地（Notion/Sheet）
- E7-S2 保存 report_json 与渲染文案草稿并记录状态
- E7-S3 支持按 slug 查询最新状态（供运营回查）
- E7-S4 发布策略开关（自动发布或运营确认后发布）

## Epic 8：渲染与 Telegram 发布
目标：落地与校验完成后稳定推送到 TG Channel。

### Stories
- E8-S1 按模板渲染 TG Markdown（parse_mode 配置化）
- E8-S2 TG Bot 发布并默认关闭预览（落地后/审核通过后）
- E8-S3 记录发布状态与 message_id 回执

## Epic 9：配置、限流与运营文档
目标：把关键参数与运营流程固化为可执行规范。

### Stories
- E9-S1 配置文件与环境变量加载校验（TG/Tavily/LLM/限流）
- E9-S2 重生成限流（5 分钟 1 次、1 小时 5 次）
- E9-S3 Tavily 全局速率与同日缓存
- E9-S4 配置示例与运营 SOP 文档落地
- E9-S5 端到端 E2E 流水线回归测试（阶段性补齐）

## Epic 10：报告质量优化（P0/P1）
目标：提升报告可审计性与一致性，修复低级错误与证据相关性问题。

### Stories
- E10-S1 P0 质量闸门补强（Δ一致性/占位符范围/补搜触发）
- E10-S2 P0 LLM 前置相关性过滤（Tavily 结果过滤）
- E10-S3 P1 引用与渲染规范化（CitationManager）
- E10-S4 P1 市场行为证据化（Market Metrics）
- E10-S5 P1 结算规则结构化 + 官方抓取（Official Evidence）

## 建议执行顺序
Epic 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9（配置与限流可并行推进）。
