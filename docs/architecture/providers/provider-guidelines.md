# 附录 I：Provider 通用实现规范（强烈建议照做）

#### I.1 统一的 HTTP Client 封装

- 超时：连接 3s、总 15s（可配置）
- 重试：只对 `429/5xx/网络错误`，最多 3 次
- Backoff：`base=300ms`，指数退避 + jitter
- 观测：为每个请求打点（provider、endpoint、status、latency、cache_hit）

#### I.2 缓存与去重

- 缓存分三层：
  1) **短 TTL**（订单簿）
  2) **中 TTL**（markets 列表）
  3) **长 TTL**（事件元数据）
- Dedup：同一 Orchestrator 任务中，相同 query 只打一次 provider（promise memoization）

#### I.3 Mock 与集成测试

- 为每个 Provider 提供 `fixture`（静态 JSON）
- 用 `nock/msw` 做 HTTP mock（TS/Node）
- 最少 3 类测试：
  - 正常路径（200）
  - 限流（429）
  - 返回结构变化（字段缺失）→ Validator/Mapper 应该 fail fast

---
