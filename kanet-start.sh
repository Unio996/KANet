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
export KANET_ROOT  # Console 子进程 (scanner spawn scout 用 cwd=$KANET_ROOT/kaspa-scout) 需要继承
# R-NWT-2026-04-28 (d) B phase 4: KANET_TEST_MODE 开 /api/test/reset_peer endpoint (test framework cleanup_peer_broker_state).
# Production 部署不设此 env, endpoint 不注册. dev 机始终设. test framework 正常用.
export KANET_TEST_MODE="${KANET_TEST_MODE:-1}"
CONSOLE_DIR="$KANET_ROOT/kasia-console"
LOG_DIR="$KANET_ROOT/logs"
PID_DIR="$LOG_DIR/pids"
ENV_FILE="$KANET_ROOT/kanet.env"
CONSOLE_PORT=${CONSOLE_PORT:-3400}  # KANet-UI ops r38: env override default for :3400 multi-node oracle console (Carol host)

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
OPENCLAW_TOKEN=""

if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r k v; do
    [[ "$k" =~ ^# ]] && continue
    [ -z "$k" ] && continue
    case "$k" in
      KANET_ROOT)              KANET_ROOT="$v" ;;
      CONSOLE_ENCRYPTION_KEY)  CONSOLE_ENCRYPTION_KEY="$v" ;;
      OPENCLAW_TOKEN)          OPENCLAW_TOKEN="$v" ;;
      KASPA_NODE)              KASPA_NODE="$v" ;;
      KASPA_WS_PROXY_PORT)     KASPA_WS_PROXY_PORT="$v" ;;
      # NWT 8aef0b5e critical fix — kanet.env 写但 case 未 match key 静默被忽略
      # BROKER_V2_ENABLED + BROKER_V2_ENABLED_PEERS broker-v2 phase 1 cutover gating 必 export
      BROKER_V2_ENABLED)       export BROKER_V2_ENABLED="$v" ;;
      BROKER_V2_ENABLED_PEERS) export BROKER_V2_ENABLED_PEERS="$v" ;;
      # B2 v0.5 area-8 E7 — pool market deadline maximum cap (testnet 30day default, mainnet 365day)
      POOL_DEADLINE_MAX_DAY)   export POOL_DEADLINE_MAX_DAY="$v" ;;
    esac
  done < "$ENV_FILE"
  ok "已加载配置: $ENV_FILE"
fi

# 导出 OPENCLAW_TOKEN 给 Console → Adapter 子进程（可选，本地服务认证）
[ -n "$OPENCLAW_TOKEN" ] && export OPENCLAW_TOKEN

if [ -z "$CONSOLE_ENCRYPTION_KEY" ]; then
  CONSOLE_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "# KANet 配置文件 — 请勿泄露"   >> "$ENV_FILE"
  echo "CONSOLE_ENCRYPTION_KEY=$CONSOLE_ENCRYPTION_KEY" >> "$ENV_FILE"
  warn "生成新的 CONSOLE_ENCRYPTION_KEY → $ENV_FILE"
  warn "注意：DB 中用旧 key 加密的 mnemonic/token 需在控制面板重新输入"
fi

info "加密密钥: ${CONSOLE_ENCRYPTION_KEY:0:8}..."

# ── kaspa-ws-proxy (LAN 节点 → 127.0.0.1) ──────────────────────────────────
# 目的：让 https://kasia.fyi 这类 HTTPS 页面能连本机局域网内的 Kaspa 节点。
# 浏览器禁止 https:// 页面发起 ws:// 到非 loopback 地址，但对 127.0.0.1 豁免。
# 所以我们在 127.0.0.1 起一个 TCP 转发，指向真实节点。
# 不需要证书、不需要反向代理、不需要改浏览器设置。
#
# 配置 (kanet.env)：
#   KASPA_NODE=127.0.0.1               # kaspad 节点 host — host-specific, 必显式写 kanet.env
#                                      # 例: Bettor host kaspad 本机 = 127.0.0.1
#                                      # 例: J1 host kaspad 局域网 = 192.168.1.107 (DHCP, 重启可能变)
#   KASPA_WS_PROXY_PORT=17110          # 本机监听端口（默认 17110）
# kasia.fyi 那边填: ws://127.0.0.1:17110
WS_PROXY_SCRIPT="$KANET_ROOT/scripts/kaspa-ws-proxy.mjs"
WS_PROXY_NODE="${KASPA_NODE:-127.0.0.1}"
WS_PROXY_PORT="${KASPA_WS_PROXY_PORT:-17110}"
if [ -f "$WS_PROXY_SCRIPT" ]; then
  echo ""
  echo -e "${C_BOLD}[0/0] kaspa-ws-proxy${C_RESET}  127.0.0.1:$WS_PROXY_PORT → $WS_PROXY_NODE:$WS_PROXY_PORT"
  # TCP probe kaspad 上游 — host-specific config drift 侦测 (sediment: feedback-lan-ip-dhcp-drift)
  if timeout 3 bash -c "echo > /dev/tcp/$WS_PROXY_NODE/$WS_PROXY_PORT" 2>/dev/null; then
    ok "kaspad reachable $WS_PROXY_NODE:$WS_PROXY_PORT"
  else
    warn "kaspad $WS_PROXY_NODE:$WS_PROXY_PORT UNREACHABLE"
    warn "  → 第一步: 看 ipconfig 找 kaspad 主机当前 IP, 改 kanet.env KASPA_NODE=<IP>"
    warn "  → LAN 节点 DHCP 重启会变, host-local 节点用 127.0.0.1"
    warn "  → ws-proxy 仍启动, 但 relay 上行全堵直到 fix"
  fi
  if netstat -an 2>/dev/null | grep -q "127.0.0.1:${WS_PROXY_PORT}.*LISTEN"; then
    ok "ws-proxy 已在运行 (port $WS_PROXY_PORT)"
  else
    KASPA_NODE="$WS_PROXY_NODE" LISTEN_PORT="$WS_PROXY_PORT" TARGET_PORT="$WS_PROXY_PORT" \
      node "$WS_PROXY_SCRIPT" > "$LOG_DIR/kaspa-ws-proxy.log" 2>&1 &
    WS_PROXY_PID=$!
    echo "$WS_PROXY_PID" > "$PID_DIR/kaspa-ws-proxy.pid"
    sleep 0.5
    if kill -0 "$WS_PROXY_PID" 2>/dev/null; then
      ok "ws-proxy 就绪  →  ws://127.0.0.1:$WS_PROXY_PORT  (PID $WS_PROXY_PID)"
      info "kasia.fyi 节点 URL 填: ws://127.0.0.1:$WS_PROXY_PORT"
    else
      warn "ws-proxy 启动失败，日志: $LOG_DIR/kaspa-ws-proxy.log"
    fi
  fi
fi

# ── llama-server (本地推理引擎) ──────────────────────────────────────────────
LLAMA_SERVER="$KANET_ROOT/tools/llama-server/llama-server.exe"
LLAMA_MODEL="${LLAMA_MODEL_PATH:-$KANET_ROOT/models/Qwen_Qwen3.6-35B-A3B-Q4_K_M.gguf}"
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
      --n-gpu-layers 99 --ctx-size 262144 --threads 8 \
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
DB_PATH="$CONSOLE_DIR/data/console.db" \
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

# ── Bridge stack (cc-bridge + qwen-worker + channel-bridge) ────────────────
# 幂等：已监听端口的不重启；llama-server 不在时跳过 worker（避免 401 风暴）
BRIDGE_PORT=9100
echo ""
echo -e "${C_BOLD}[2/2] Bridge stack${C_RESET}  cc-bridge:$BRIDGE_PORT + qwen-worker + channel-bridge"

# cc-bridge（OpenAI 协议 queue，NWT-Brain 等通过它路由）
if netstat -an 2>/dev/null | grep -q ":${BRIDGE_PORT}.*LISTEN"; then
  ok "cc-bridge 已在运行 (port $BRIDGE_PORT)"
else
  node "$KANET_ROOT/scripts/cc-bridge.mjs" $BRIDGE_PORT > "$LOG_DIR/cc-bridge.log" 2>&1 &
  CC_BRIDGE_PID=$!
  echo "$CC_BRIDGE_PID" > "$PID_DIR/cc-bridge.pid"
  sleep 1
  if curl -sf "http://127.0.0.1:$BRIDGE_PORT/health" > /dev/null 2>&1; then
    ok "cc-bridge 就绪  (PID $CC_BRIDGE_PID)"
  else
    warn "cc-bridge 启动失败，日志: $LOG_DIR/cc-bridge.log"
  fi
fi

# 幂等检查：Git Bash 下 pgrep 不存在，改用 PowerShell
proc_running() {
  local match="$1"
  local n=$(powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -match '$match' }).Count" 2>/dev/null | tr -d '\r\n ')
  [ -n "$n" ] && [ "$n" -gt 0 ]
}

# qwen-bridge-worker — drain qclaude-nwt queue（channel-bridge 路由到这条）
# 需要 llama-server 在，否则 Qwen 请求全 fail
if curl -sf "http://127.0.0.1:$LLAMA_PORT/health" > /dev/null 2>&1; then
  if proc_running "qwen-bridge-worker\.js"; then
    ok "qwen-worker 已在运行"
  elif [ -f "$KANET_ROOT/scripts/qwen-bridge-worker.js" ]; then
    # queue 名来自 kanet.env 的 QWEN_WORKER_QUEUE，默认 qclaude-nwt（channel-bridge 路由目标）
    QWEN_QUEUE="${QWEN_WORKER_QUEUE:-qclaude-nwt}"
    node "$KANET_ROOT/scripts/qwen-bridge-worker.js" --queue=$QWEN_QUEUE > "$LOG_DIR/qwen-worker.log" 2>&1 &
    QWEN_WORKER_PID=$!
    echo "$QWEN_WORKER_PID" > "$PID_DIR/qwen-worker.pid"
    ok "qwen-worker 就绪  (PID $QWEN_WORKER_PID, queue=$QWEN_QUEUE)"
  else
    info "qwen-bridge-worker.js 不存在，跳过（host-specific，非 llama host 无需）"
  fi
else
  info "llama-server 不在，跳过 qwen-worker（Mind 会用 legacy 路径）"
fi

# channel-bridge — 订阅 7 频道，dispatch [→ TARGET] 消息到 Bridge queue
if proc_running "channel-bridge\.mjs"; then
  ok "channel-bridge 已在运行"
elif [ -f "$KANET_ROOT/scripts/channel-bridge.mjs" ]; then
  node "$KANET_ROOT/scripts/channel-bridge.mjs" > "$LOG_DIR/channel-bridge.log" 2>&1 &
  CH_BRIDGE_PID=$!
  echo "$CH_BRIDGE_PID" > "$PID_DIR/channel-bridge.pid"
  ok "channel-bridge 就绪  (PID $CH_BRIDGE_PID, 7 channels)"
fi

# test-cron — 定时跑 test-framework, 失败 broadcast dev-coord (Owner 钦定 4 台阶 #4)
# 默认 6h 周期, 启动时立即跑一次. 配置通过 env: KANET_TEST_CRON_INTERVAL_MS / KANET_TEST_CRON_NO_BOOT_RUN=1
if proc_running "test-cron\.mjs"; then
  ok "test-cron 已在运行"
elif [ -f "$CONSOLE_DIR/scripts/test-cron.mjs" ]; then
  (cd "$CONSOLE_DIR" && node scripts/test-cron.mjs > "$LOG_DIR/test-cron.log" 2>&1) &
  TEST_CRON_PID=$!
  echo "$TEST_CRON_PID" > "$PID_DIR/test-cron.pid"
  ok "test-cron 就绪  (PID $TEST_CRON_PID, 6h 周期, boot 跑一次)"
fi

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
