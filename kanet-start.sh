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

# 自重定向 launcher 输出 (2026-07-04 事故 #52: 调用方手动把 stdout 重定向到 C 盘 Temp 的各种一次性
# 文件名, 反复重启一天攒了 43 个 2-3GB 文件把 C 盘写满 0 字节, 阻断全队。脚本自己接管顶层输出——
# 不管调用方有没有重定向/往哪重定向, 都固定写进项目自己的 LOG_DIR (不在 C 盘); 每次启动截断
# (> 非 >>) 只留最新一次, 不无限增长 (旧运行的错误已经靠今天新建的 events 表告警/频道通知捕获,
# 不需要在这个 launcher log 里累积长期历史)。
exec > >(tee "$LOG_DIR/kanet-start-launcher.log") 2>&1

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
# tg-bot: 额外按 cmdline 清 (= 可能 session/手动起无 pidfile) — 防双开 (Telegram 单 poller/token, 否则 409 conflict)
powershell -Command "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { \$_.CommandLine -like '*_launch_tg_bot*' -or \$_.CommandLine -like '*tg-bot*bot.mjs*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" 2>/dev/null || true
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
    # Bettor r551 durable 收口 (J1): full passthrough — export EVERY kanet.env key (= headless r472 同源),
    # 结构性消除 case-block 漏 export 漂移 (DAILY_SEND_LIMIT 等 scale env 漏过 = 本轮 root). case 块保留仅做
    # 变量名转换 (PORT→CONSOLE_PORT 等). 未来加 env 不再漏, 重启不 revert scale fix stack.
    export "$k=$v"
    case "$k" in
      KANET_ROOT)              KANET_ROOT="$v" ;;
      CONSOLE_ENCRYPTION_KEY)  CONSOLE_ENCRYPTION_KEY="$v" ;;
      OPENCLAW_TOKEN)          OPENCLAW_TOKEN="$v" ;;
      KASPA_NODE)              KASPA_NODE="$v" ;;
      KASPA_WS_PROXY_PORT)        KASPA_WS_PROXY_PORT="$v" ;;
      KASPA_WS_PROXY_TARGET_PORT) KASPA_WS_PROXY_TARGET_PORT="$v" ;;  # 5/13 Owner A 钦定 LISTEN/TARGET split (= restored after r43 git clean wipe)
      # 5/26 根治 RPC drift — env single source, 必 export 给 Console 子进程
      KASPA_RPC_URL)           export KASPA_RPC_URL="$v" ;;
      KASPA_NETWORK)           export KASPA_NETWORK="$v" ;;
      # 5/27 sub 12.x prediction agent dispatcher gate (= conversations.js L331)
      PREDICTION_AGENT_ENABLED) export PREDICTION_AGENT_ENABLED="$v" ;;
      # 5/28 Owner 钦定 testnet 0 limits
      KANET_TESTNET_NO_LIMITS) export KANET_TESTNET_NO_LIMITS="$v" ;;
      POOL_DEADLINE_MIN_OVERRIDE) export POOL_DEADLINE_MIN_OVERRIDE="$v" ;;
      POOL_DEADLINE_MAX_DAY) export POOL_DEADLINE_MAX_DAY="$v" ;;
      # 5/26 sediment — Console PORT 从 kanet.env 读, 不靠 env override OR default 3400
      PORT)                    CONSOLE_PORT="$v" ;;
      # NWT 8aef0b5e critical fix — kanet.env 写但 case 未 match key 静默被忽略
      # BROKER_V2_ENABLED + BROKER_V2_ENABLED_PEERS broker-v2 phase 1 cutover gating 必 export
      BROKER_V2_ENABLED)       export BROKER_V2_ENABLED="$v" ;;
      BROKER_V2_ENABLED_PEERS) export BROKER_V2_ENABLED_PEERS="$v" ;;
      # B2 v0.5 area-8 E7 — pool market deadline maximum cap (testnet 30day default, mainnet 365day)
      POOL_DEADLINE_MAX_DAY)   export POOL_DEADLINE_MAX_DAY="$v" ;;
      # 5/29 KANet-UI — dev-channel faucet relay (clean relay#2 d9a8fffb; 原 FaucetRelay-tn 撞 relay-instance BUG1 弃用). 必 export 否则 case 未 match 静默忽略 (= line 100 同坑).
      FAUCET_RELAY_ID)         export FAUCET_RELAY_ID="$v" ;;
      FAUCET_AMOUNT_KAS)       export FAUCET_AMOUNT_KAS="$v" ;;
      # Owner 派工 100 cases (2026-06-02): seed Polymarket hot markets via v0.7
      POOL_SEEDER_ENABLED)     export POOL_SEEDER_ENABLED="$v" ;;
      POOL_SEEDER_MAKER_RELAY) export POOL_SEEDER_MAKER_RELAY="$v" ;;
      POOL_SEED_TARGET)        export POOL_SEED_TARGET="$v" ;;
      POOL_SEED_STAKE_KAS)     export POOL_SEED_STAKE_KAS="$v" ;;
      POOL_SEED_INTERVAL_MIN)  export POOL_SEED_INTERVAL_MIN="$v" ;;
      POOL_SEED_MAX_DAY)       export POOL_SEED_MAX_DAY="$v" ;;
      # J2-tn r364 (Bettor 6/5 钦定 demo headroom): cross-node settler chain 25min, 30 太紧.
      ORACLE_SILENT_TIMEOUT_MIN) export ORACLE_SILENT_TIMEOUT_MIN="$v" ;;
      # J2-tn r382 (Bettor 6/5 16:29 钦定): demo 提速 cron 5min → 1min (5x). mainnet 不设默认 5min.
      POOL_SETTLER_TICK_SEC) export POOL_SETTLER_TICK_SEC="$v" ;;
      PREDICTION_VOTER_TICK_SEC) export PREDICTION_VOTER_TICK_SEC="$v" ;;
      # J1 #73 (scale-test 20档 collecting_sigs 瓶颈根因): relay 每日广播限默认 200 → oracle sig 广播撞限没落链 → maker ingest 不到 → 超时 refund. 必 export 否则 case 未 match 静默忽略 (= line 102 同坑). per-node 须各设 (J2 5f6200e5 watchdog 修的配对 primary 修).
      DAILY_SEND_LIMIT) export DAILY_SEND_LIMIT="$v" ;;
      # J2 watchdog env (默认 code 内 30min, 仅覆盖时设)
      COLLECTING_SIGS_WATCHDOG_MIN) export COLLECTING_SIGS_WATCHDOG_MIN="$v" ;;
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
    KASPA_NODE="$WS_PROXY_NODE" LISTEN_PORT="$WS_PROXY_PORT" TARGET_PORT="${KASPA_WS_PROXY_TARGET_PORT:-$WS_PROXY_PORT}" \
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
# LLAMA_SERVER_PATH: host-specific override (= 同 LLAMA_MODEL_PATH 既有先例, kanet.env 里配)。
# 2026-07-07 事故: 这台机器 llama-server.exe 实装在 C:/KANet/tools/llama-server/, 跟默认
# $KANET_ROOT/tools/... 不一致, 重启后 [ -f ] 判假静默跳过整个启动块, 无任何 WARN, 只有肉眼盯 UI 才发现。
LLAMA_SERVER="${LLAMA_SERVER_PATH:-$KANET_ROOT/tools/llama-server/llama-server.exe}"
LLAMA_MODEL="${LLAMA_MODEL_PATH:-$KANET_ROOT/models/Qwythos-9B-Claude-Mythos-5-1M-Q4_K_M.gguf}"
LLAMA_PORT=8000
LLAMA_LOG="$LOG_DIR/llama-server.log"

if [ ! -f "$LLAMA_SERVER" ] || [ ! -f "$LLAMA_MODEL" ]; then
  warn "llama-server 跳过: exe=$LLAMA_SERVER $([ -f "$LLAMA_SERVER" ] && echo 存在 || echo 缺失), model=$LLAMA_MODEL $([ -f "$LLAMA_MODEL" ] && echo 存在 || echo 缺失) — 本机若确实有 GPU 推理机, 检查 kanet.env 的 LLAMA_SERVER_PATH/LLAMA_MODEL_PATH"
fi

if [ -f "$LLAMA_SERVER" ] && [ -f "$LLAMA_MODEL" ]; then
  echo ""
  echo -e "${C_BOLD}[0/1] llama-server${C_RESET}  port $LLAMA_PORT"
  if netstat -an 2>/dev/null | grep -q ":${LLAMA_PORT}.*LISTEN"; then
    ok "llama-server 已在运行 (port $LLAMA_PORT)"
  else
    info "启动 llama-server (Qwythos-9B, RTX 5090)..."
    > "$LLAMA_LOG"
    # cd 目标必须跟 LLAMA_SERVER 本身一起走 override (2026-07-07 回归: 之前这行硬编码默认路径,
    # LLAMA_SERVER_PATH 覆盖后 exe 路径对了但 cd 还是走旧默认值, 目录不存在直接炸)。
    (cd "$(dirname "$LLAMA_SERVER")" && "./$(basename "$LLAMA_SERVER")" \
      --model "$LLAMA_MODEL" \
      --host 0.0.0.0 --port $LLAMA_PORT \
      --n-gpu-layers 99 --ctx-size 1048576 \
      --cache-type-k q8_0 --cache-type-v q8_0 \
      --threads 8 --flash-attn on \
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
KASPA_RPC_URL="$KASPA_RPC_URL" \
KASPA_NETWORK="$KASPA_NETWORK" \
PREDICTION_AGENT_ENABLED="$PREDICTION_AGENT_ENABLED" \
KANET_TESTNET_NO_LIMITS="$KANET_TESTNET_NO_LIMITS" \
POOL_DEADLINE_MIN_OVERRIDE="$POOL_DEADLINE_MIN_OVERRIDE" \
POOL_DEADLINE_MAX_DAY="$POOL_DEADLINE_MAX_DAY" \
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

# ── TG bot: NOT launched here anymore (KANet-UI 2026-06-13). ──
# The Console's tg-bot-manager (src/services/tg-bot-manager.js) is now the SOLE owner: index.js
# boot-start (enabled-gated, tg_bot_enabled flag) + Settings UI start/stop/status + crash respawn.
# The old start-script launch raced the manager → two pollers on one token → Telegram 409 Conflict.
# Single owner = no 409; the operator controls it from Settings → Telegram Bot.
echo "  - TG bot: 由 Console 管理 (Settings → Telegram Bot 启停; 启用后随 Console 自启)"

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

# owner-bot — Owner 专属 dev-coord 远程指挥 bot (跟押注用的 broker bot 分离, 独立 token)。
# 2026-07-07 事故: _launch_owner_bot.mjs 头部注释早就说"kanet-start.sh 能无条件拉起它", 但从未真接线,
# 今天几次重启都没人补起来导致 Owner 的 dev-coord bot 用不了。脚本自身 no-op-safe (OWNER_BOT_TOKEN 未
# 设时打日志退出, 不崩), 幂等检查跟 channel-bridge 同款。
if proc_running "_launch_owner_bot\.mjs"; then
  ok "owner-bot 已在运行"
elif [ -f "$CONSOLE_DIR/_launch_owner_bot.mjs" ]; then
  (cd "$CONSOLE_DIR" && node _launch_owner_bot.mjs > "$LOG_DIR/owner-bot.log" 2>&1) &
  OWNER_BOT_PID=$!
  echo "$OWNER_BOT_PID" > "$PID_DIR/owner-bot.pid"
  ok "owner-bot 就绪  (PID $OWNER_BOT_PID, no-op 若 OWNER_BOT_TOKEN 未配置)"
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
