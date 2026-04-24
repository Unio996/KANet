#!/usr/bin/env bash
# KANet — 停止所有服务
# 双重策略：先按 PID 文件杀，再按端口扫描兜底

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KANET_ROOT="${KANET_ROOT:-$SCRIPT_DIR}"
# Read KANET_ROOT from kanet.env if available
if [ -f "$KANET_ROOT/kanet.env" ]; then
  _kr=$(grep '^KANET_ROOT=' "$KANET_ROOT/kanet.env" 2>/dev/null | cut -d= -f2)
  [ -n "$_kr" ] && KANET_ROOT="$_kr"
fi
PID_DIR="$KANET_ROOT/logs/pids"
CONSOLE_DIR="$KANET_ROOT/kasia-console"
CONSOLE_PORT=3100

C_RESET='\033[0m'; C_GREEN='\033[32m'; C_DIM='\033[2m'; C_YELLOW='\033[33m'
ok()   { echo -e "  ${C_GREEN}✓${C_RESET}  $*"; }
skip() { echo -e "  ${C_DIM}-  $*${C_RESET}"; }
warn() { echo -e "  ${C_YELLOW}⚠${C_RESET}  $*"; }

kill_pid() {
  local pid=$1 name=$2
  if taskkill //PID "$pid" //F //T >/dev/null 2>&1; then
    ok "已停止 $name (PID $pid)"
  else
    skip "$name (PID $pid) 已不在运行"
  fi
}

echo ""
echo "停止 KANet 所有服务..."
echo ""
KILLED_PIDS=""

# ── 阶段 1：按 PID 文件停止 ────────────────────────────────────
for pidfile in "$PID_DIR"/*.pid; do
  [ -f "$pidfile" ] || continue
  pid=$(cat "$pidfile")
  name=$(basename "$pidfile" .pid)
  kill_pid "$pid" "$name"
  KILLED_PIDS="$KILLED_PIDS $pid"
  rm -f "$pidfile"
done

# ── 阶段 2：从 Console DB 读取所有已注册端口，按端口兜底清理 ──
PORTS="$CONSOLE_PORT"
if [ -f "$CONSOLE_DIR/data/console.db" ]; then
  DB_PORTS=$(node -e "
    try {
      const Database = require('$CONSOLE_DIR/node_modules/better-sqlite3');
      const db = new Database('$CONSOLE_DIR/data/console.db', {readonly:true});
      const rows = db.prepare('SELECT http_port FROM adapter_nodes').all();
      console.log(rows.map(r => r.http_port).join(' '));
    } catch {}
  " 2>/dev/null)
  PORTS="$PORTS $DB_PORTS"
fi

for PORT in $PORTS; do
  PID=$(powershell -Command "
    (Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique
  " 2>/dev/null | tr -d '\r\n ')
  [ -z "$PID" ] && continue
  # 跳过已经在阶段 1 杀过的
  echo "$KILLED_PIDS" | grep -qw "$PID" && continue
  kill_pid "$PID" "port:$PORT"
done

# ── 阶段 3：llama-server 不再无差别扫杀 ─────────────────────────────
# 旧逻辑会用 WMI 按进程名杀所有 llama-server.exe，导致 qclaude.bat 起的
# 实例被误杀，连带 litellm 断链、qclaude Claude Code 会话阵亡。
# 现在只相信阶段 1 的 pid 文件：kanet-start.sh 起的自己写 pid 会被停，
# qclaude.bat 起的不写 pid → 不被误杀。
#
# 如果你确实需要一键杀光 llama-server（含 qclaude 的），手工跑：
#   taskkill //F //IM llama-server.exe

# ── 阶段 4：清理残留 node 进程（relay、adapter、scout） ───────
CHILD_PIDS=$(powershell -Command "
  Get-CimInstance Win32_Process |
    Where-Object { \$_.Name -eq 'node.exe' -and (\$_.CommandLine -match 'relay' -or \$_.CommandLine -match 'index\.mjs' -or \$_.CommandLine -match 'scout' -or \$_.CommandLine -match 'cc-bridge' -or \$_.CommandLine -match 'qwen-bridge-worker' -or \$_.CommandLine -match 'channel-bridge' -or \$_.CommandLine -match 'kaspa-ws-proxy') } |
    Select-Object -ExpandProperty ProcessId
" 2>/dev/null | tr -d '\r')

for PID in $CHILD_PIDS; do
  [ -z "$PID" ] && continue
  echo "$KILLED_PIDS" | grep -qw "$PID" && continue
  # 排除当前 claude-code 等不相关进程
  kill_pid "$PID" "残留进程"
done

rm -f "$PID_DIR"/*.pid 2>/dev/null
echo ""
echo "完成。"
