#!/usr/bin/env bash
set -euo pipefail

LIVE=0
URLS=()
TOP_MARKETS="${E2E_TOP_MARKETS:-}"

for arg in "$@"; do
  if [[ "$arg" == "--live" ]]; then
    LIVE=1
  else
    URLS+=("$arg")
  fi
done

if [[ ${#URLS[@]} -eq 0 ]]; then
  URLS+=("https://polymarket.com/event/who-will-trump-nominate-as-fed-chair")
  URLS+=("https://polymarket.com/event/what-price-will-bitcoin-hit-before-2027")
fi

if [[ -z "${TOP_MARKETS}" ]]; then
  if [[ "${LIVE}" -eq 1 ]]; then
    TOP_MARKETS=1
  else
    TOP_MARKETS=3
  fi
fi

for url in "${URLS[@]}"; do
  echo "Running E2E for: ${url}"
  if [[ "${LIVE}" -eq 1 ]]; then
    TEST_LIVE=1 E2E_TOP_MARKETS="${TOP_MARKETS}" E2E_EVENT_URL="${url}" npm run test:e2e
  else
    E2E_TOP_MARKETS="${TOP_MARKETS}" E2E_EVENT_URL="${url}" npm run test:e2e
  fi
done
