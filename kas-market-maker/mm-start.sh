#!/usr/bin/env bash
# KAS Market Maker — Start
set -euo pipefail

MM_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$MM_DIR/logs"
mkdir -p "$LOG_DIR"

echo ""
echo "  KAS Market Maker"
echo "  ────────────────"

# Stop old process
if [ -f "$LOG_DIR/mm.pid" ]; then
  OLD_PID=$(cat "$LOG_DIR/mm.pid")
  kill "$OLD_PID" 2>/dev/null && echo "  Stopped old process (PID $OLD_PID)" || true
  rm -f "$LOG_DIR/mm.pid"
  sleep 1
fi

# Start
LOG_FILE="$LOG_DIR/mm.log"
> "$LOG_FILE"
node "$MM_DIR/src/index.mjs" >> "$LOG_FILE" 2>&1 &
MM_PID=$!
echo "$MM_PID" > "$LOG_DIR/mm.pid"

# Wait for UI ready
READY=0
for i in $(seq 1 20); do
  if curl -sf http://localhost:3200/ > /dev/null 2>&1; then
    READY=1; break
  fi
  sleep 0.5
done

if [ "$READY" -eq 1 ]; then
  echo "  Dashboard:  http://localhost:3200"
  echo "  KANet API:  $(node -e "console.log(JSON.parse(require('fs').readFileSync('$MM_DIR/config.json','utf8')).kanet.consoleUrl)")"
  echo "  PID:        $MM_PID"
  echo "  Log:        $LOG_DIR/mm.log"
  echo ""
  echo "  tail -f $LOG_DIR/mm.log"
else
  echo "  FAILED to start. Log:"
  tail -10 "$LOG_FILE"
  exit 1
fi
