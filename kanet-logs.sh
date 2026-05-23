#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KANET_ROOT="${KANET_ROOT:-$SCRIPT_DIR}"
LOG_DIR="$KANET_ROOT/logs"

# ── 参数解析 ────────────────────────────────────────────────────────────────
SERVICE=""
TAIL_N=50

while [ $# -gt 0 ]; do
  case "$1" in
    --tail=*)
      TAIL_N="${1#--tail=}"
      ;;
    *)
      if [ -z "$SERVICE" ]; then
        SERVICE="$1"
      fi
      ;;
  esac
  shift
done

# ── 校验 ────────────────────────────────────────────────────────────────────
if [ -z "$SERVICE" ]; then
  echo "usage: bash kanet-logs.sh <service> [--tail=N]" >&2
  exit 2
fi

LOG_FILE="$LOG_DIR/${SERVICE}.log"

if [ ! -f "$LOG_FILE" ]; then
  echo "log file not found: $LOG_FILE" >&2
  exit 2
fi

if [ ! -s "$LOG_FILE" ]; then
  echo "empty log: $LOG_FILE" >&2
  exit 1
fi

# ── 输出 ────────────────────────────────────────────────────────────────────
tail -n "$TAIL_N" "$LOG_FILE"
exit 0
