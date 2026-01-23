# 附录 F：StorageAdapter ——Week 1 用 SQLite，预留 Notion/Sheet

#### F.1 Week 1 推荐：SQLite（本地）

- 优点：最少集成成本、可迁移到 Postgres
- 表结构建议（与 PRD 对齐）：`events`, `evidences`, `reports`
- 额外建议：
  - `rate_limit_log`（记录 regen 次数/时间窗口）
  - `cache_index`（用于去重）

#### F.2 预留：Google Sheets / Notion（可选）

- 这些属于 “运营可视化存储”，不是系统真数据库
- 建议做成异步 sink：
  - 主流程写 SQLite
  - 背景任务把当天报告 append 到 Sheet/Notion

---
