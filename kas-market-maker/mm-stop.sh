#!/usr/bin/env bash
# KAS Market Maker — Stop

MM_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$MM_DIR/logs/mm.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  if taskkill //PID "$PID" //F //T >/dev/null 2>&1; then
    echo "  Stopped Market Maker (PID $PID)"
  else
    echo "  Process $PID not running"
  fi
  rm -f "$PID_FILE"
else
  echo "  No PID file found"
fi
