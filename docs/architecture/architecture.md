# AI 预测信号聚合器（MVP）技术架构文档 TDD v0.2（聚焦 Week 1 交互闭环 + 可扩展性）

本 TDD 已拆分为主文档与 Provider 附录，便于维护与引用。

## 主文档
- `docs/architecture/architecture-core.md`：1–14 章与交互时序附录。

## Provider 附录
- 附录 A：PolymarketProvider（Gamma API）`docs/architecture/providers/polymarket-gamma.md`
- 附录 B：PolymarketProvider（CLOB API）`docs/architecture/providers/polymarket-clob.md`
- 附录 C：TavilyProvider `docs/architecture/providers/tavily.md`
- 附录 D：TelegramPublisher `docs/architecture/providers/telegram.md`
- 附录 E：LLMProvider `docs/architecture/providers/llm.md`
- 附录 F：StorageAdapter `docs/architecture/providers/storage.md`
- 附录 G：SentimentProvider（NewsData.io）`docs/architecture/providers/sentiment-newsdata.md`
- 附录 H：SentimentProvider（Perigon）`docs/architecture/providers/sentiment-perigon.md`
- 附录 I：Provider 通用实现规范 `docs/architecture/providers/provider-guidelines.md`
- 附录 J：Polymarket Pricing API `docs/architecture/providers/polymarket-pricing.md`

## 相关补充
- `docs/architecture/source-tree.md`
- `docs/architecture/coding-standards.md`
- `docs/architecture/tech-stack.md`
