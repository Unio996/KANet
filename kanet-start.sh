#!/usr/bin/env bash
# ╔══════════════════════════════════════════╗
# ║        KANet  —  启动脚本 v1.3           ║
# ║  Console (manages all subprocesses)      ║
# ╚══════════════════════════════════════════╝
set -euo pipefail

# ── 路径 ────────────────────────────────────────────────────────────────────
# KANET_ROOT: 从 kanet.env 读取或使用默认值（部署时改此一处即可）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KANET_ROOT="${KANET_ROOT:-$SCRIPT_DIR}"
CONSOLE_DIR="$KANET_ROOT/kasia-console"
LOG_DIR="$KANET_ROOT/logs"
PID_DIR="$LOG_DIR/pids"
ENV_FILE="$KANET_ROOT/kanet.env"
CONSOLE_PORT=3200

mkdir -p "$LOG_DIR" "$PID_DIR"

# ── 颜色 ────────────────────────────────────────────────────────────────────
C_RESET='\033[0m'; C_BOLD='\033[1m'; C_DIM='\033[2m'
C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_CYAN='\033[36m'
C_RED='\033[31m';   C_BLUE='\033[34m'

log()  { echo -e "${C_DIM}[$(date '+%H:%M:%S')]${C_RESET} $*"; }
ok()   { echo -e "  ${C_GREEN}✓${C_RESET}  $*"; }
warn() { echo -e "  ${C_YELLOW}⚠${C_RESET}  $*"; }
err()  { echo -e "  ${C_RED}✗${C_RESET}  $*"; }
info() { echo -e "  ${C_CYAN}→${C_RESET}  $*"; }

# ── 标题 ────────────────────────────────────────────────────────────────────
clear
echo ""
echo -e "${C_BOLD}${C_BLUE}  ╔══════════════════════════════════════╗${C_RESET}"
echo -e "${C_BOLD}${C_BLUE}  ║${C_RESET}${C_BOLD}      K A N E T   C O N S O L E     ${C_BLUE}║${C_RESET}"
echo -e "${C_BOLD}${C_BLUE}  ║${C_RESET}${C_DIM}   Kaspa Agent Network Layer           ${C_BLUE}${C_BOLD}║${C_RESET}"
echo -e "${C_BOLD}${C_BLUE}  ╚══════════════════════════════════════╝${C_RESET}"
echo ""

# ── 停止旧进程 ───────────────────────────────────────────────────────────────
log "检查旧进程..."
STOPPED=0
for pidfile in "$PID_DIR"/*.pid; do
  [ -f "$pidfile" ] || continue
  pid=$(cat "$pidfile")
  name=$(basename "$pidfile" .pid)
  if kill -0 "$pid" 2>/dev/null; then
    powershell -Command "Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue" 2>/dev/null \
      || kill "$pid" 2>/dev/null
    log "  停止 $name (PID $pid)"
    STOPPED=$((STOPPED+1))
  fi
  rm -f "$pidfile"
done
# 强制释放端口
for PORT_CHECK in $CONSOLE_PORT; do
  PIDS=$(powershell -Command "
    (Get-NetTCPConnection -LocalPort $PORT_CHECK -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique
  " 2>/dev/null | tr -d '\r\n ' || true)
  if [ -n "$PIDS" ]; then
    powershell -Command "Stop-Process -Id $PIDS -Force -ErrorAction SilentlyContinue" 2>/dev/null || true
    log "  释放端口 $PORT_CHECK (PID $PIDS)"
    STOPPED=$((STOPPED+1))
  fi
done
[ "$STOPPED" -gt 0 ] && sleep 1

# ── 加载 / 创建 kanet.env ───────────────────────────────────────────────────
# 唯一必须的环境变量：加密密钥
# 其余配置（RPC 节点、交易所 API Key 等）均在 Console 面板管理，存 DB
CONSOLE_ENCRYPTION_KEY=""

if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^# ]] && continue
    [ -z "$k" ] && continue
    case "$k" in
      KANET_ROOT)              KANET_ROOT="$v" ;;
      CONSOLE_ENCRYPTION_KEY)  CONSOLE_ENCRYPTION_KEY="$v" ;;
      KASPA_RPC_URL)           KASPA_RPC_URL="$v" ;;
      KASPA_NETWORK)           KASPA_NETWORK="$v" ;;
    esac
  done < "$ENV_FILE"
  ok "已加载配置: $ENV_FILE"
fi

if [ -z "$CONSOLE_ENCRYPTION_KEY" ]; then
  CONSOLE_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "# KANet 配置文件 — 请勿泄露"   >> "$ENV_FILE"
  echo "CONSOLE_ENCRYPTION_KEY=$CONSOLE_ENCRYPTION_KEY" >> "$ENV_FILE"
  warn "生成新的 CONSOLE_ENCRYPTION_KEY → $ENV_FILE"
  warn "注意：DB 中用旧 key 加密的 mnemonic/token 需在控制面板重新输入"
fi

info "加密密钥: ${CONSOLE_ENCRYPTION_KEY:0:8}..."

# ── llama-server (本地推理引擎) ──────────────────────────────────────────────
LLAMA_SERVER="$KANET_ROOT/tools/llama-server/llama-server.exe"
LLAMA_MODEL="$KANET_ROOT/models/qwen3-30b-a3b-q4_k_m.gguf"
LLAMA_PORT=8000
LLAMA_LOG="$LOG_DIR/llama-server.log"

if [ -f "$LLAMA_SERVER" ] && [ -f "$LLAMA_MODEL" ]; then
  echo ""
  echo -e "${C_BOLD}[0/1] llama-server${C_RESET}  port $LLAMA_PORT"
  if netstat -an 2>/dev/null | grep -q ":${LLAMA_PORT}.*LISTEN"; then
    ok "llama-server 已在运行 (port $LLAMA_PORT)"
  else
    info "启动 llama-server (Qwen3-30B, RTX 5090)..."
    > "$LLAMA_LOG"
    (cd "$KANET_ROOT/tools/llama-server" && ./llama-server.exe \
      --model "$LLAMA_MODEL" \
      --host 0.0.0.0 --port $LLAMA_PORT \
      --n-gpu-layers 99 --ctx-size 32768 --threads 8 \
      --flash-attn on \
      >> "$LLAMA_LOG" 2>&1) &
    LLAMA_PID=$!
    echo "$LLAMA_PID" > "$PID_DIR/llama-server.pid"
    info "等待模型加载..."
    LLAMA_READY=0
    for i in $(seq 1 60); do
      if curl -sf http://localhost:$LLAMA_PORT/health 2>/dev/null | grep -q ok; then
        LLAMA_READY=1; break
      fi
      sleep 2
    done
    if [ "$LLAMA_READY" -eq 1 ]; then
      ok "llama-server 就绪  →  http://localhost:$LLAMA_PORT  (PID $LLAMA_PID)"
    else
      warn "llama-server 启动超时，Console 仍将启动（adapter 可回退到 Ollama）"
    fi
  fi
fi

# ── 启动 kasia-console ──────────────────────────────────────────────────────
# Console 启动后自动拉起: Adapter → UTXO 拆分 → Relay → Scanner
echo ""
echo -e "${C_BOLD}[1/1] kasia-console${C_RESET}  port $CONSOLE_PORT"

CONSOLE_LOG="$LOG_DIR/console.log"
> "$CONSOLE_LOG"

KANET_ROOT=$KANET_ROOT \
CONSOLE_ENCRYPTION_KEY=$CONSOLE_ENCRYPTION_KEY \
PORT=$CONSOLE_PORT \
CONSOLE_URL="http://localhost:$CONSOLE_PORT" \
DB_PATH="$CONSOLE_DIR/data/console.db" \
KASPA_RPC_URL="${KASPA_RPC_URL:-}" \
KASPA_NETWORK="${KASPA_NETWORK:-mainnet}" \
  node "$CONSOLE_DIR/src/index.js" >> "$CONSOLE_LOG" 2>&1 &
CONSOLE_PID=$!
echo "$CONSOLE_PID" > "$PID_DIR/console.pid"

# 等待就绪（最多 15 秒）
READY=0
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$CONSOLE_PORT/" > /dev/null 2>&1; then
    READY=1; break
  fi
  sleep 0.5
done

if [ "$READY" -eq 0 ]; then
  err "Console 启动失败！日志:"
  tail -20 "$CONSOLE_LOG"
  exit 1
fi

ok "Console 就绪  →  http://localhost:$CONSOLE_PORT  (PID $CONSOLE_PID)"

# ── IB Gateway ──────────────────────────────────────────────────────────────
# 不随 KANet 自动启动。需要时手动运行 IB Gateway。

# 从日志中提取 INGEST_SECRET（如有新生成）
NEW_SECRET=$(grep -oP 'INGEST_SECRET=\K[0-9a-f]+' "$CONSOLE_LOG" 2>/dev/null | head -1 || true)
if [ -n "$NEW_SECRET" ]; then
  if grep -q '^INGEST_SECRET=' "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^INGEST_SECRET=.*|INGEST_SECRET=$NEW_SECRET|" "$ENV_FILE"
  else
    echo "INGEST_SECRET=$NEW_SECRET" >> "$ENV_FILE"
  fi
  ok "INGEST_SECRET: ${NEW_SECRET:0:8}..."
fi

# ── 状态摘要 ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${C_BOLD}${C_GREEN}  ══════════════════════════════════════${C_RESET}"
echo -e "${C_BOLD}         KANet 已启动  ✓${C_RESET}"
echo -e "${C_BOLD}${C_GREEN}  ══════════════════════════════════════${C_RESET}"
echo ""
echo -e "  ${C_BOLD}控制面板${C_RESET}  →  ${C_CYAN}http://localhost:$CONSOLE_PORT${C_RESET}"
if [ -f "$LLAMA_SERVER" ] && [ -f "$LLAMA_MODEL" ]; then
  echo -e "  ${C_BOLD}推理引擎${C_RESET}  →  ${C_CYAN}http://localhost:$LLAMA_PORT${C_RESET}  (llama-server + RTX 5090)"
fi
echo -e "  ${C_DIM}Console 自动管理: Adapter + Relay + Scanner${C_RESET}"
echo ""
echo -e "  ${C_DIM}停止:  bash $KANET_ROOT/kanet-stop.sh${C_RESET}"
echo -e "  ${C_DIM}日志:  $LOG_DIR${C_RESET}"
echo ""
echo -e "${C_BOLD}  实时日志  (Ctrl+C 退出日志，进程继续运行)${C_RESET}"
echo -e "  ──────────────────────────────────────"
echo ""

if [ -f "$CONSOLE_LOG" ]; then
  tail -n 0 -f "$CONSOLE_LOG" 2>/dev/null
else
  echo "  (暂无日志文件)"
  wait
fi
