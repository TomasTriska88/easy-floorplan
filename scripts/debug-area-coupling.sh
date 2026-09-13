#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT/.debug"
LOG_FILE="$LOG_DIR/area-coupling-debug.log"
mkdir -p "$LOG_DIR"
: > "$LOG_FILE"

echo "[easy-floorplan debug] logging to $LOG_FILE" | tee -a "$LOG_FILE"
echo "[easy-floorplan debug] node: $(node -v)" | tee -a "$LOG_FILE"
echo "[easy-floorplan debug] npm: $(npm -v)" | tee -a "$LOG_FILE"

env EASY_FLOORPLAN_DEBUG=1 npx vitest run --config vitest.browser.config.ts --run src/editor-drag.browser.test.ts 2>&1 | tee -a "$LOG_FILE"
STATUS=${PIPESTATUS[0]}

echo "[easy-floorplan debug] browser tests exit: $STATUS" | tee -a "$LOG_FILE"
if [ "$STATUS" -eq 0 ]; then
  env EASY_FLOORPLAN_DEBUG=1 npx vitest run --run src/editor-geometry.test.ts 2>&1 | tee -a "$LOG_FILE"
  STATUS=${PIPESTATUS[0]}
  echo "[easy-floorplan debug] geometry tests exit: $STATUS" | tee -a "$LOG_FILE"
fi

echo "[easy-floorplan debug] log file complete: $LOG_FILE" | tee -a "$LOG_FILE"
exit "$STATUS"
