#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KANET_ROOT="${KANET_ROOT:-$SCRIPT_DIR}"
ENV_FILE="$KANET_ROOT/kanet.env"
LOG_DIR="$KANET_ROOT/logs"
PID_DIR="$LOG_DIR/pids"
CONSOLE_DIR="$KANET_ROOT/kasia-console"
CONSOLE_PORT=3200   # fallback ONLY (kanet.env 无 PORT key 时). 真相源 = kanet.env PORT, 下方 env-load 后派生覆盖. 3100 = 主网 Console (C:/kanet, 独立). Bettor r473 纠: 原硬编码 3100 是从主网脚本拷来的错值, 把 tn12 起到了主网端口.
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
    # Bettor r472 (P0 incident 2026-06-10): EXPORT EVERY key from kanet.env, not a hand-maintained
    # allowlist. The old 3-key allowlist silently dropped KASPA_RPC_URL (+ KASPA_NETWORK, pool/voter
    # tick vars, seeder config …) → Console child crashed on startup (rpc-health.js throws
    # 'KASPA_RPC_URL not set'). Because the r432 supervisor auto-restarts via THIS headless script,
    # every auto-recovery silently failed → restart-loop → fork exhaustion. kanet-start.sh already
    # exports the full set via a giant case block (L84+) — the two drifted, which is exactly the
    # 'case 未 match key 静默忽略' anti-pattern this codebase has hit repeatedly. Full passthrough
    # makes drift structurally impossible. kanet.env IS the canonical config; exporting all of it is
    # the intent.
    export "$k=$v"
    case "$k" in
      KANET_ROOT)              KANET_ROOT="$v" ;;
      CONSOLE_ENCRYPTION_KEY)  CONSOLE_ENCRYPTION_KEY="$v" ;;
      OPENCLAW_TOKEN)          OPENCLAW_TOKEN="$v" ;;
    esac
  done < "$ENV_FILE"
fi

# KANet-UI r-portconverge: Console 端口单一源 = kanet.env PORT (上方 export "$k=$v" 已导入 PORT).
# 派生 CONSOLE_PORT 跟随 kanet.env, 硬编码 3200 退为无 PORT key 时 fallback.
# 修 latent drift: 原 headless 行104 PORT="$CONSOLE_PORT" 用硬编码值, 无视 kanet.env PORT,
# 与 kanet-start.sh (case PORT) CONSOLE_PORT="$v") 漂移. 现两脚本同源.
CONSOLE_PORT="${PORT:-$CONSOLE_PORT}"

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
# KANet-UI r-llamafix (Bettor r481 指派): tn12 树 (D:\kanet-tn12) 本身无 llama-server.exe / models/,
# llama 是 C:\KANet 树的单实例共享服务 (mainnet+testnet 共用一个 GPU/模型, serving :8000).
# 旧默认 $KANET_ROOT/tools|models 在 D: 全是死路 + 版本写错 Qwen3.5 (实际 3.6) → headless 永报
# 'model file not found'、Console 重启不带 llama. 修: 默认指 C:\KANet 实际路径 (env 可覆盖) + 版本 3.6.
LLAMA_SERVER="${LLAMA_SERVER_PATH:-C:/KANet/tools/llama-server/llama-server.exe}"
LLAMA_MODEL="${LLAMA_MODEL_PATH:-C:/KANet/models/Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf}"
LLAMA_DIR="$(dirname "$LLAMA_SERVER")"
LLAMA_LOG="$LOG_DIR/llama-server.log"
LLAMA_PID=""
LLAMA_SKIPPED="false"
LLAMA_REASON=""

# :8000 健康守卫: llama 是共享单实例. 若已有人 serving :8000 (= C:\KANet 起的) 则复用、绝不重起,
# 否则会在已占端口上 spawn 第二个 llama → bind 冲突 + 21GB 重复加载 GPU OOM. (headless 只 kill :3200
# 不 kill :8000, 故必须此守卫.) 只在 :8000 死 且 模型/exe 在位时, 才作 fallback 自愈拉起.
if curl -sf "http://127.0.0.1:$LLAMA_PORT/v1/models" >/dev/null 2>&1; then
  LLAMA_SKIPPED="true"
  LLAMA_REASON="already serving :$LLAMA_PORT (shared llama, reused)"
elif [ -f "$LLAMA_SERVER" ] && [ -f "$LLAMA_MODEL" ]; then
  > "$LLAMA_LOG"
  (cd "$LLAMA_DIR" && ./llama-server.exe \
    --model "$LLAMA_MODEL" \
    --host 0.0.0.0 --port $LLAMA_PORT \
    --n-gpu-layers 99 --ctx-size 262144 --threads 8 \
    --flash-attn on \
    >> "$LLAMA_LOG" 2>&1) &
  LLAMA_PID=$!
  echo "$LLAMA_PID" > "$PID_DIR/llama-server.pid"
else
  LLAMA_SKIPPED="true"
  LLAMA_REASON="model/exe not found ($LLAMA_MODEL)"
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

# J2-tn r432 (Bettor r469 wire 持久化): supervisor 自动启 — Console 死自愈不需手动.
# 防 supervisor pid 残留: 仅当不活才拉.
SUPERVISOR_SCRIPT="$KANET_ROOT/scripts/kanet-console-supervisor.sh"
if [ -f "$SUPERVISOR_SCRIPT" ]; then
  if [ -f "$KANET_ROOT/logs/pids/console-supervisor.pid" ] && \
     kill -0 "$(cat "$KANET_ROOT/logs/pids/console-supervisor.pid" 2>/dev/null)" 2>/dev/null; then
    echo "[supervisor] already running pid=$(cat "$KANET_ROOT/logs/pids/console-supervisor.pid")"
  else
    bash "$SUPERVISOR_SCRIPT" start >/dev/null 2>&1
    echo "[supervisor] auto-started (r432 wire)"
  fi
fi

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
