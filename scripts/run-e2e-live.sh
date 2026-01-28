#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Load .env if present
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

# Defaults for live E2E + live LLM
: "${RUN_E2E:=1}"
: "${TEST_LIVE:=1}"
: "${E2E_LLM_LIVE:=1}"
: "${E2E_TIMEOUT_MS:=120000}"

missing=()
if [[ -z "${TAVILY_API_KEY:-}" ]]; then
  missing+=("TAVILY_API_KEY")
fi
if [[ -z "${LLM_API_KEY:-}" ]]; then
  missing+=("LLM_API_KEY")
fi
if [[ -z "${LLM_BASE_URL:-}" ]]; then
  missing+=("LLM_BASE_URL")
fi

if (( ${#missing[@]} > 0 )); then
  echo "Missing required env: ${missing[*]}"
  echo "Tip: create ${ROOT_DIR}/.env with TAVILY_API_KEY, LLM_API_KEY, LLM_BASE_URL."
  exit 1
fi

cd "${ROOT_DIR}"
npm run test:e2e
