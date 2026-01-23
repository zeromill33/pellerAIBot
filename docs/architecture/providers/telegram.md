# 附录 D：TelegramPublisher ——落地后推送 TG Channel

#### D.1 发布权限与目标 chat_id

- Bot 需要被添加为 Channel 管理员（至少有发消息权限）
- `chat_id` 可以是 `@channelusername` 或 `-100...` 的数字 id（按 Bot API 约定）
- 发布前需确保报告已落地；若启用运营审核，仅在确认后调用发布

#### D.2 速率限制（必须实现）

- 默认广播上限：**30 messages / second**（可付费提升）
- Week 1 你们是“少量精选发布”，通常不会碰到，但仍建议：
  - Publisher 队列化（每条消息间隔 50–100ms）
  - 统一处理 429：读取 `retry_after`（如果返回）并重试

#### D.3 Markdown 渲染策略

- 推荐 `parse_mode=MarkdownV2`（更强的实体能力）
- 必须实现 `escapeMarkdownV2(text)`，否则链接/下划线容易炸
- 长文拆分：
  - 单条消息长度限制（Telegram 有限制，建议实现自动 split）
  - 拆分策略：按模板 section 边界切分（0~8 段）

---
