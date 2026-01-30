# E2E 运行指南（含真实 LLM）

本项目的 E2E 测试默认走 fixtures + mock LLM。若要启用真实 provider + 真实 LLM，请使用以下环境变量。

## 必需环境变量

- `RUN_E2E=1`：启用 E2E 用例
- `TEST_LIVE=1`：启用真实 Polymarket/Tavily provider
- `E2E_LLM_LIVE=1`：启用真实 LLM（默认 mock）
- `TAVILY_API_KEY=...`
- `LLM_API_KEY=...`
- `LLM_BASE_URL=...`（OpenAI compatible 网关地址）

## 可选环境变量

- `E2E_EVENT_URL=...`：指定事件 URL（默认 US government shutdown by Jan 31 示例）
- `E2E_TOP_MARKETS=...`：market.signals 探测数量（默认 3）
- `E2E_FORCE_D=1`：强制启用 D 车道
- `E2E_TIMEOUT_MS=...`：覆盖单测超时（建议真实 LLM 60–120s）
- `E2E_STOP_STEP=...`：指定停止 step（默认到 telegram.publish）
- `E2E_TG_PREVIEW_PATH=...`：TG 预览内容输出路径（默认 tests/e2e/tmp/tg-preview.md）
- `E2E_TG_PREVIEW_PATH_D=...`：D 车道用例 TG 预览内容输出路径（默认 tests/e2e/tmp/tg-preview-dlane.md）
- `LLM_MODEL=...`、`LLM_TEMPERATURE=...`、`LLM_TIMEOUT_MS=...`

## 运行示例

```bash
RUN_E2E=1 TEST_LIVE=1 E2E_LLM_LIVE=1 E2E_TIMEOUT_MS=120000 \
TAVILY_API_KEY=... LLM_API_KEY=... LLM_BASE_URL=... \
npm run test:e2e
```

## 脚本模板

可参考：

- `scripts/run-e2e-live.sh`：支持自动读取项目根目录 `.env`
- `scripts/run-e2e-live.example.sh`：手动填写密钥的示例
