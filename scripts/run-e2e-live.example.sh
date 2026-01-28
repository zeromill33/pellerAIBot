#!/usr/bin/env bash
set -euo pipefail

# 真实 E2E + 真实 LLM 运行模板（填入你的密钥）
export RUN_E2E=1
export TEST_LIVE=1
export E2E_LLM_LIVE=1
export E2E_TIMEOUT_MS=120000

# 可选：指定事件 URL
# export E2E_EVENT_URL="https://polymarket.com/event/..."

# 必需密钥与网关
export TAVILY_API_KEY="..."
export LLM_API_KEY="..."
export LLM_BASE_URL="https://your-openai-compatible-host/v1"

# 可选：LLM 细节
# export LLM_MODEL="gpt-4o-mini"
# export LLM_TEMPERATURE="0"

npm run test:e2e
