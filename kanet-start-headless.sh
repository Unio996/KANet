#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KANET_ROOT="${KANET_ROOT:-$SCRIPT_DIR}"
ENV_FILE="$KANET_ROOT/kanet.env"
LOG_DIR="$KANET_ROOT/logs"
PID_DIR="$LOG_DIR/pids"
CONSOLE_DIR="$KANET_ROOT/kasia-console"
CONSOLE_PORT=3100
LLAMA_PORT=8000
TIMEOUT="${HEADLESS_TIMEOUT:-30}"
START_MS=$(date +%s%3N 2>/dev/null || echo 0)

mkdir -p "$LOG_DIR" "$PID_DIR"

# ── 加载 kanet.env ─────────────────────────────────────────────────────────
CONSOLE_ENCRYPTION_KEY=""
OPENCLAW_TOKEN=""

if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^# ]] && continue
    [ -z "$k" ] && continue
    case "$k" in
      KANET_ROOT)              KANET_ROOT="$v" ;;
      CONSOLE_ENCRYPTION_KEY)  CONSOLE_ENCRYPTION_KEY="$v" ;;
      OPENCLAW_TOKEN)          OPENCLAW_TOKEN="$v" ;;
    esac
  done < "$ENV_FILE"
fi

[ -n "$OPENCLAW_TOKEN" ] && export OPENCLAW_TOKEN

if [ -z "$CONSOLE_ENCRYPTION_KEY" ]; then
  CONSOLE_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  {
    echo "# KANet 配置文件 - 请勿泄露"
    echo "CONSOLE_ENCRYPTION_KEY=$CONSOLE_ENCRYPTION_KEY"
  } >> "$ENV_FILE"
fi

# ── 停旧进程 ────────────────────────────────────────────────────────────────
if [ "${HEADLESS_NO_KILL:-0}" != "1" ]; then
  for pidfile in "$PID_DIR"/*.pid; do
    [ -f "$pidfile" ] || continue
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  done

  for port in $CONSOLE_PORT; do
    PIDS=$(powershell -Command "
      (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique
    " 2>/dev/null | tr -d '\r\n ' || true)
    if [ -n "$PIDS" ]; then
      powershell -Command "Stop-Process -Id $PIDS -Force -ErrorAction SilentlyContinue" 2>/dev/null || true
    fi
  done
  sleep 1
fi

# ── llama-server (spawn 不等健康) ────────────────────────────────────────────
LLAMA_SERVER="$KANET_ROOT/tools/llama-server/llama-server.exe"
LLAMA_MODEL="${LLAMA_MODEL_PATH:-$KANET_ROOT/models/Qwen_Qwen3.5-35B-A3B-Q4_K_M.gguf}"
LLAMA_LOG="$LOG_DIR/llama-server.log"
LLAMA_PID=""
LLAMA_SKIPPED="false"
LLAMA_REASON=""

if [ -f "$LLAMA_SERVER" ] && [ -f "$LLAMA_MODEL" ]; then
  > "$LLAMA_LOG"
  (cd "$KANET_ROOT/tools/llama-server" && ./llama-server.exe \
    --model "$LLAMA_MODEL" \
    --host 0.0.0.0 --port $LLAMA_PORT \
    --n-gpu-layers 99 --ctx-size 262144 --threads 8 \
    --flash-attn on \
    >> "$LLAMA_LOG" 2>&1) &
  LLAMA_PID=$!
  echo "$LLAMA_PID" > "$PID_DIR/llama-server.pid"
else
  LLAMA_SKIPPED="true"
  LLAMA_REASON="model file not found"
fi

# ── kasia-console ────────────────────────────────────────────────────────────
CONSOLE_LOG="$LOG_DIR/console.log"
> "$CONSOLE_LOG"

KANET_ROOT="$KANET_ROOT" \
CONSOLE_ENCRYPTION_KEY="$CONSOLE_ENCRYPTION_KEY" \
PORT="$CONSOLE_PORT" \
DB_PATH="$CONSOLE_DIR/data/console.db" \
  node --max-old-space-size=4096 "$CONSOLE_DIR/src/index.js" >> "$CONSOLE_LOG" 2>&1 &
CONSOLE_PID=$!
echo "$CONSOLE_PID" > "$PID_DIR/console.pid"

# 轮询 console 就绪
READY=0
ELAPSED=0
for i in $(seq 1 "$TIMEOUT"); do
  if curl -sf "http://localhost:$CONSOLE_PORT/" > /dev/null 2>&1; then
    READY=1; break
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

# ── 写回 INGEST_SECRET ──────────────────────────────────────────────────────
NEW_SECRET=$(grep -oP 'INGEST_SECRET=\K[0-9a-f]+' "$CONSOLE_LOG" 2>/dev/null | head -1 || true)
if [ -n "$NEW_SECRET" ]; then
  if grep -q '^INGEST_SECRET=' "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^INGEST_SECRET=.*|INGEST_SECRET=$NEW_SECRET|" "$ENV_FILE"
  else
    echo "INGEST_SECRET=$NEW_SECRET" >> "$ENV_FILE"
  fi
fi

# ── 计算耗时 ─────────────────────────────────────────────────────────────────
END_MS=$(date +%s%3N 2>/dev/null || echo 0)
if [ "$START_MS" != "0" ] && [ "$END_MS" != "0" ]; then
  ELAPSED_MS=$((END_MS - START_MS))
else
  ELAPSED_MS=$((ELAPSED * 1000))
fi

# ── JSON 输出 ───────────────────────────────────────────────────────────────
EXIT_CODE=0
JSON_OK="true"
JSON_READY="true"
if [ "$READY" -eq 0 ]; then
  EXIT_CODE=1
  JSON_OK="false"
  JSON_READY="false"
fi

# Escape strings for JSON safety
console_url="http://localhost:$CONSOLE_PORT"

if [ "$LLAMA_PID" != "" ]; then
  printf '{"ok":%s,"elapsed_ms":%s,"services":{"console":{"pid":%s,"port":%s,"ready":%s,"url":"%s"},"llama":{"pid":%s,"port":%s,"ready":false,"note":"spawned, not waited"}}}\n' \
    "$JSON_OK" "$ELAPSED_MS" "$CONSOLE_PID" "$CONSOLE_PORT" "$JSON_READY" "$console_url" "$LLAMA_PID" "$LLAMA_PORT"
else
  printf '{"ok":%s,"elapsed_ms":%s,"services":{"console":{"pid":%s,"port":%s,"ready":%s,"url":"%s"},"llama":{"skipped":true,"reason":"%s"}}}\n' \
    "$JSON_OK" "$ELAPSED_MS" "$CONSOLE_PID" "$CONSOLE_PORT" "$JSON_READY" "$console_url" "$LLAMA_REASON"
fi

exit "$EXIT_CODE"
