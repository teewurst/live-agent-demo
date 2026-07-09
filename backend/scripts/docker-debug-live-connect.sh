#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-3001}"
BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"

docker run --rm --network host \
  -v "${ROOT_DIR}/backend:/app" \
  -w /app \
  --env-file "${ROOT_DIR}/.env" \
  node:22-bookworm-slim \
  bash -lc "
    npm install @roamhq/wrtc --no-save >/dev/null
    npm run build
    node scripts/debug-live-connect.mjs --real-sdp --backend-url=${BACKEND_URL}
  "
