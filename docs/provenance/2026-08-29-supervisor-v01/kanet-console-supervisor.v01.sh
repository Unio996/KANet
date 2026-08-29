#!/bin/bash
# kanet-console-supervisor.sh — J2-tn r424 (Bettor r445 show-stopper, Owner 钦定).
#
# Console 反复 crash (KANet-UI r663 surface: ~5次/2hr) 是规模化 show-stopper.
# 外部 supervisor: 监 Console health, 死则自动 kanet-start-headless 拉起.
#
# 用法:
#   bash scripts/kanet-console-supervisor.sh start   # 后台启
#   bash scripts/kanet-console-supervisor.sh stop    # 停 supervisor (= 不停 Console)
#   bash scripts/kanet-console-supervisor.sh status  # 查 supervisor pid + 最近 N 次重启
#
# Restart storm 防护: 5min 窗口内 > 5 次重启 → 30min cool-down 拒重启 (= 防 perma-crash 死循环).
#
# 监 Console health:
#   curl -sf 127.0.0.1:3200/ 返 200/302 → alive
#   连续 N=3 次 curl fail → 视为死, 触发 kanet-start-headless.sh
#
# Log: logs/console-supervisor.log

set -euo pipefail

cd "$(dirname "$0")/.."
KANET_ROOT="$(pwd)"
LOG="$KANET_ROOT/logs/console-supervisor.log"
PID_FILE="$KANET_ROOT/logs/pids/console-supervisor.pid"
RESTART_HISTORY="$KANET_ROOT/logs/console-supervisor-restarts.log"

CHECK_INTERVAL_SEC=${KANET_SUPERVISOR_CHECK_INTERVAL_SEC:-30}
HEALTH_FAIL_THRESHOLD=${KANET_SUPERVISOR_FAIL_THRESHOLD:-3}
RESTART_WINDOW_SEC=${KANET_SUPERVISOR_RESTART_WINDOW_SEC:-300}   # 5 min
RESTART_MAX_IN_WINDOW=${KANET_SUPERVISOR_RESTART_MAX:-5}
COOL_DOWN_SEC=${KANET_SUPERVISOR_COOL_DOWN_SEC:-1800}            # 30 min after burst
# v0.1 (J2 2026-08-29, Bettor 裁 · docs/2026-08-29-j2-supervisor-lifetime-storm-guard-and-boot-grace-design.md):
BOOT_GRACE_SEC=${KANET_SUPERVISOR_BOOT_GRACE_SEC:-300}           # (b) PID 活+无心跳 ⇒ 等这么久才算 hung boot (2026-08-29 实测 boot>=157s 被杀非完成; Bettor 裁 300)
SHORT_LIFETIME_SEC=${KANET_SUPERVISOR_SHORT_LIFETIME_SEC:-300}   # (a) lifetime < 5 min = 短命
SHORT_STREAK_MAX=${KANET_SUPERVISOR_SHORT_STREAK_MAX:-3}          # (a) 连续 3 个短命 ⇒ cool-down
STATE_FILE="$KANET_ROOT/logs/console-supervisor-state.env"       # 持久化: headless :65-71 会 kill 本 supervisor, 内存状态活不过一次重启
BOOT_MARKER="$KANET_ROOT/logs/console-boot.txt"                  # console 启动即写 "<pid> <start_ms>" (index.js 顶部)
# r-portconverge (J1 DoD-E E3, 2026-06-12): Console 端口单一源 = kanet.env PORT
# (同 kanet-start.sh L105 case PORT) / headless L47 收敛). 原硬编码 3200 是 r473 port 收敛
# 漏掉的【第三个脚本】: Console 实绑 kanet.env PORT=3300, 但 supervisor 探 3200 → 永远误判
# 健康 Console 死 → 反复 kill+restart storm. headless 启 supervisor 时只 export PORT 不 export
# CONSOLE_PORT, supervisor 读 CONSOLE_PORT 故拿不到. 现从 kanet.env PORT 派生: 显式 CONSOLE_PORT
# env 仍优先 override, 次取 kanet.env PORT, 3200 仅二者皆无时 fallback.
ENV_FILE="$KANET_ROOT/kanet.env"
ENV_PORT=""
if [[ -f "$ENV_FILE" ]]; then
  ENV_PORT="$(grep -E '^PORT=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]' || true)"
fi
CONSOLE_PORT=${CONSOLE_PORT:-${ENV_PORT:-3200}}

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >> "$LOG"
}

# #21 health-check isolation (Bettor 2026-07-19 决赛夜, cause-agnostic freeze mitigation):
# 纯 curl 判活的问题——如果 console event loop 真被同步阻塞, curl 也会跟着卡到 max-time 超时,
# 健康信号本身走的是可能被堵住的同一条 HTTP 路径。加一条心跳文件 OR 逻辑: console 自己的
# setInterval(2s tick, 见 src/index.js)在事件循环转得动的情况下会按时写这个文件——只有真正
# 同步阻塞(连 setInterval 回调都排不上)才会让心跳也停摆。"HTTP 请求排队"(忙但活)不影响
# 这个 tick, curl 超时但心跳新鲜 = 判活不重启, 避免误杀。心跳也过期(>10s)才真正判死。
#
# NWT 红队 2026-07-19 抓到的已知 trade-off: curl 失败原因没区分——真进程崩溃(端口没监听)
# 时, 若心跳文件恰好是崩溃前几秒写的, heartbeat_fresh() 会误判"活着", 最多引入约 10s 的
# 判死延迟。Bettor 提议按 curl exit code 区分(7=connection refused 立即判死 / 28=timeout
# 才查心跳)——**实测这条在本机 Windows/Git-Bash 环境不成立**: 关闭的端口在这台机器上不会
# 立即返回 connection refused, curl 会一直等到 --max-time 超时才退出, exit code 恒为 28,
# 真进程崩溃场景在这里也只会看到 28, 跟"忙但活"的 28 无法用 exit code 区分(3 次重复测试
# 都验证了这一点, 不是偶发)。exit-code 精炼在此平台是空转、不生效, 退回 NWT 原先审过的
# 心跳 OR 简单方案(已知 trade-off 已评估影响有限、可接受, 不为了修一个平台上打不开的锁
# 加复杂度)。
HEARTBEAT_FILE="$KANET_ROOT/logs/console-heartbeat.txt"
heartbeat_fresh() {
  [[ -f "$HEARTBEAT_FILE" ]] || return 1
  local hb_age
  hb_age=$(( $(date +%s) - $(stat -c %Y "$HEARTBEAT_FILE" 2>/dev/null || stat -f %m "$HEARTBEAT_FILE" 2>/dev/null || echo 0) ))
  (( hb_age >= 0 && hb_age <= 10 ))
}

console_alive() {
  if curl -sf --max-time 5 "http://127.0.0.1:${CONSOLE_PORT}/" > /dev/null 2>&1; then
    return 0
  fi
  heartbeat_fresh
}

# ── v0.1 持久化状态 (write-ahead: 先写盘再调 headless) ──
# 2026-08-29 根因: restart_console() 调 headless, headless 遍历 pids/*.pid 连本 supervisor 一起 kill,
# 之后的 record_restart() 永远跑不到, 计数/cool-down 在内存随之归零 ⇒ 风暴保护从未真正存在过.
last_restart_ts=0; last_boot_ok_ts=0; short_streak=0; cool_down_until=0
load_state() {
  [[ -f "$STATE_FILE" ]] || return 0
  # 只认 KEY=数字 行, 防脏文件注入
  local k v
  while IFS='=' read -r k v; do
    [[ "$v" =~ ^[0-9]+$ ]] || continue
    case "$k" in
      last_restart_ts|last_boot_ok_ts|short_streak|cool_down_until) printf -v "$k" '%s' "$v" ;;
    esac
  done < "$STATE_FILE"
}
save_state() {
  mkdir -p "$(dirname "$STATE_FILE")"
  printf 'last_restart_ts=%s\nlast_boot_ok_ts=%s\nshort_streak=%s\ncool_down_until=%s\n' \
    "$last_restart_ts" "$last_boot_ok_ts" "$short_streak" "$cool_down_until" > "$STATE_FILE.tmp" && mv -f "$STATE_FILE.tmp" "$STATE_FILE"
}

# ── v0.1 boot-marker / PID 存在性 ──
marker_pid=""; marker_start_s=0
marker_start_ms=0
read_marker() {
  marker_pid=""; marker_start_s=0; marker_start_ms=0
  [[ -f "$BOOT_MARKER" ]] || return 1
  local marker_ms=""
  read -r marker_pid marker_ms < "$BOOT_MARKER" || true
  [[ "$marker_pid" =~ ^[0-9]+$ && "$marker_ms" =~ ^[0-9]+$ ]] || { marker_pid=""; return 1; }
  marker_start_ms=$marker_ms
  marker_start_s=$(( marker_ms / 1000 ))
  return 0
}
# 进程创建时刻 (epoch ms) —— v0.1.2 防 PID 复用. CIM CreationDate 对 SYSTEM 进程非提权可读 (NWT 实测; ≠ CommandLine).
# 读不到 ⇒ 输出空 (调用方放行 = fail-safe: 最坏多等 ≤ grace).
proc_creation_ms() {
  powershell -NoProfile -NonInteractive -Command \
    "\$p = Get-CimInstance Win32_Process -Filter 'ProcessId=$1' -ErrorAction SilentlyContinue; if (\$p -and \$p.CreationDate) { [DateTimeOffset]::new(\$p.CreationDate).ToUnixTimeMilliseconds() }" 2>/dev/null | tr -d '[:space:]'
}
# pid_alive <pid> [marker_ms]
# 0 = 活, 1 = 不在, 2 = 查不出 (tasklist 失败 ⇒ 调用方退回旧 3-fail 逻辑, fail-safe).
# 只查存在性, 不读 CommandLine —— 非提权读 SYSTEM 进程 CommandLine 为 null 是假空 (runbook v0.5.1 §检查③).
# v0.1.2: 给了 marker_ms 时再核 CreationDate ≤ marker_ms + 2s —— 复用的 PID 创建时刻必晚于旧进程死亡 ≥ marker 写入时刻 ⇒ 判 1 (不在).
# marker 由 index.js 顶部写, 但 ESM 静态 import 先于顶部代码执行 ⇒ marker_ms 可能晚于创建数秒, 所以只核 "创建不晚于 marker", 不核相等.
PID_REUSE_SKEW_MS=${KANET_SUPERVISOR_PID_REUSE_SKEW_MS:-2000}
pid_alive() {
  local out
  out="$(tasklist //FI "PID eq $1" //NH 2>/dev/null)" || return 2
  grep -q "node.exe" <<< "$out" || return 1
  if [[ -n "${2:-}" && "$2" =~ ^[0-9]+$ ]]; then
    local cms; cms="$(proc_creation_ms "$1")"
    if [[ "$cms" =~ ^[0-9]+$ ]] && (( cms > $2 + PID_REUSE_SKEW_MS )); then
      log "pid $1 exists but CreationDate(${cms}) > marker(${2})+${PID_REUSE_SKEW_MS}ms — PID reused, treat as gone"
      return 1
    fi
  fi
  return 0
}
# 打印 ALIVE|BOOTING|HUNG_BOOT|DEAD|UNKNOWN
console_state() {
  if console_alive; then echo ALIVE; return 0; fi
  read_marker || { echo DEAD; return 0; }
  local rc=0
  pid_alive "$marker_pid" "$marker_start_ms" || rc=$?
  if (( rc == 1 )); then echo DEAD; return 0; fi
  if (( rc == 2 )); then echo UNKNOWN; return 0; fi
  local age=$(( $(date +%s) - marker_start_s ))
  if (( age <= BOOT_GRACE_SEC )); then echo BOOTING; else echo HUNG_BOOT; fi
  return 0
}

# ── v0.1 (a) lifetime 风暴 guard: 返回 0 = 准重启, 1 = 拒 (已进 cool-down) ──
# set -e 注意: 不用 ((x++)) (x=0 时返回 1 会退出), 一律 x=$((x+1)).
lifetime_guard() {
  local now=$1 lifetime
  if (( last_boot_ok_ts > last_restart_ts )); then lifetime=$(( now - last_boot_ok_ts )); else lifetime=$(( now - last_restart_ts )); fi
  if (( last_restart_ts > 0 && lifetime < SHORT_LIFETIME_SEC )); then short_streak=$(( short_streak + 1 )); else short_streak=0; fi
  log "lifetime=${lifetime}s short_streak=${short_streak}/${SHORT_STREAK_MAX}"
  if (( short_streak >= SHORT_STREAK_MAX )); then
    cool_down_until=$(( now + COOL_DOWN_SEC )); save_state
    log "LIFETIME STORM: ${short_streak} consecutive lifetimes < ${SHORT_LIFETIME_SEC}s — enter ${COOL_DOWN_SEC}s cool-down"
    return 1
  fi
  return 0
}

count_recent_restarts() {
  local since=$(( $(date +%s) - RESTART_WINDOW_SEC ))
  if [[ ! -f "$RESTART_HISTORY" ]]; then echo 0; return; fi
  awk -v since="$since" '$1 >= since' "$RESTART_HISTORY" | wc -l
}

record_restart() {
  mkdir -p "$(dirname "$RESTART_HISTORY")"
  echo "$(date +%s) $(date -u '+%Y-%m-%dT%H:%M:%SZ') restart" >> "$RESTART_HISTORY"
}

announce_restart() {
  # fail-loud not fail-closed (KANet-UI, Bettor 派工③ 2026-08-04): 自愈本身零改动, 只在拉起前
  # 把"这次自愈装载的是什么状态的工作树"从静默变成有记录——供人事后判"那次重启是不是把未审
  # 代码带进了 live"。同族根因: 2026-08-04 早晨 supervisor 自愈过两次(00:51/05:34), 频道里
  # 没有任何人知道, 直到有人偶然核 PID 才发现。
  local status
  status="$(git -C "$KANET_ROOT" status --porcelain 2>&1)" || { log "[fail-loud] git status error (not blocking restart): $status"; return 0; }
  # 日志行(本地文件,可中文,不经 curl/JSON 编码链路)
  local log_line
  # 播报行(纯 ASCII——bash→curl 这条链路传中文实测会丢编码变问号乱码,2026-08-04 KANet-UI 实测
  # 复现:同一条消息本地 log() 正常、频道收到的是"[supervisor??] fail-loud????"。播报是给人看
  # 的可观测性信号,内容准确比语言统一更要紧,改英文避开整条编码坑,比修编码链路更简单可靠。)
  local bcast_line
  if [[ -z "$status" ]]; then
    log_line="[supervisor] 自愈重启 · 工作树 clean"
    bcast_line="[supervisor] auto-restart, worktree CLEAN"
  else
    local files
    files="$(echo "$status" | awk '{print $2}' | head -8 | tr '\n' ',' | sed 's/,$//')"
    local n
    n="$(echo "$status" | wc -l)"
    log_line="[supervisor] 自愈重启 · 工作树 dirty · ${n}个文件: ${files}$( [[ $n -gt 8 ]] && echo " 等${n}个")"
    bcast_line="[supervisor] auto-restart, worktree DIRTY (${n} files): ${files}"
  fi
  log "$log_line"
  # 播报走 KANet-UI relay(operator 域自动化脚本身份)。--max-time 3: 触发场景恰恰是 console
  # 可能 down/半死, 裸 curl 可能"连上但不回应"而非直接拒连, 必须有超时——这条新逻辑唯一的
  # 承诺就是"不阻塞不拖慢重启", 没超时的网络调用正好会做反面(NWT 红队抓到, 2026-08-04)。
  local payload
  payload="$(node -e 'process.stdout.write(JSON.stringify({relayId:"f5cf6d85-58f4-4991-9cd5-7c6779f6822b",channel:"dev-coord-testnet",message:require("fs").readFileSync(0,"utf8")}))' <<< "$bcast_line")"
  curl -sf --max-time 3 -X POST "http://127.0.0.1:${CONSOLE_PORT}/api/chat/send" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    >> "$LOG" 2>&1 || log "[fail-loud] 播报失败(不阻塞,不重试——console 本来就可能连不上,日志是保底证据)"
}

restart_console() {
  log "Console death detected — invoking kanet-start-headless.sh"
  # v0.1 write-ahead: headless 会 kill 本进程 (:65-71), 之后的记账可能永远跑不到 (2026-08-29 三次重启零记录的根因)
  last_restart_ts=$(date +%s); save_state; record_restart
  announce_restart
  bash "$KANET_ROOT/kanet-start-headless.sh" >> "$LOG" 2>&1 || log "kanet-start-headless fail"
  # 若本进程还活着 (headless 没杀到), 不再用 5s 判成败 —— 成败由主循环的 boot grace 状态机判
  return 0
}

run_supervisor() {
  echo $$ > "$PID_FILE"
  load_state
  log "supervisor start pid=$$ check_interval=${CHECK_INTERVAL_SEC}s fail_threshold=${HEALTH_FAIL_THRESHOLD} restart_window=${RESTART_WINDOW_SEC}s max_restarts=${RESTART_MAX_IN_WINDOW} cool_down=${COOL_DOWN_SEC}s boot_grace=${BOOT_GRACE_SEC}s short_lifetime=${SHORT_LIFETIME_SEC}s streak_max=${SHORT_STREAK_MAX} state:last_restart=${last_restart_ts} last_boot_ok=${last_boot_ok_ts} streak=${short_streak} cool_down_until=${cool_down_until}"
  local consecutive_fail=0
  local was_booting=0
  while true; do
    supervisor_tick
    sleep "$CHECK_INTERVAL_SEC"
  done
}

# v0.1 一次判活+决策 (拆出来可 offline 测; 依赖调用方作用域的 consecutive_fail / was_booting)
supervisor_tick() {
  local st now
  st="$(console_state)"
  now=$(date +%s)
  case "$st" in
    ALIVE)
      consecutive_fail=0
      if (( was_booting == 1 )) || (( last_boot_ok_ts < last_restart_ts )); then
        last_boot_ok_ts=$now; save_state; was_booting=0
        if read_marker; then log "boot OK: boot_ms=$(( (now - marker_start_s) * 1000 )) pid=${marker_pid}"; else log "boot OK (no marker)"; fi
      fi ;;
    BOOTING)
      was_booting=1; consecutive_fail=0
      read_marker || true
      log "booting: pid=${marker_pid} age=$(( now - marker_start_s ))s/${BOOT_GRACE_SEC}s — wait" ;;
    UNKNOWN)
      consecutive_fail=$(( consecutive_fail + 1 ))
      log "health fail #${consecutive_fail}/${HEALTH_FAIL_THRESHOLD} (pid check unavailable)" ;;
    DEAD|HUNG_BOOT)
      consecutive_fail=$HEALTH_FAIL_THRESHOLD
      log "console ${st} — immediate death verdict" ;;
  esac
  if (( consecutive_fail >= HEALTH_FAIL_THRESHOLD )); then
    if (( now < cool_down_until )); then
      local remain=$(( cool_down_until - now ))
      log "in cool-down period (${remain}s remain), skip restart"
    else
      local recent
      recent=$(count_recent_restarts)
      if (( recent >= RESTART_MAX_IN_WINDOW )); then
        cool_down_until=$(( now + COOL_DOWN_SEC )); save_state
        log "RESTART STORM: ${recent} restarts in last ${RESTART_WINDOW_SEC}s — enter ${COOL_DOWN_SEC}s cool-down"
      elif ! lifetime_guard "$now"; then
        :   # 已进 cool-down, 日志在 guard 里
      else
        restart_console || true
      fi
      consecutive_fail=0
    fi
  fi
  return 0
}

case "${1:-start}" in
  start)
    mkdir -p "$(dirname "$LOG")" "$(dirname "$PID_FILE")"
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "supervisor already running pid=$(cat "$PID_FILE")"
      exit 0
    fi
    nohup bash "$0" _run >> "$LOG" 2>&1 &
    sleep 1
    if [[ -f "$PID_FILE" ]]; then
      echo "supervisor started pid=$(cat "$PID_FILE") log=$LOG"
    else
      echo "supervisor start failed (no pid recorded)"
      exit 1
    fi
    ;;
  _run)
    run_supervisor
    ;;
  stop)
    if [[ -f "$PID_FILE" ]]; then
      pid=$(cat "$PID_FILE")
      if kill -0 "$pid" 2>/dev/null; then
        kill -TERM "$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
        echo "supervisor stopped pid=$pid"
        rm -f "$PID_FILE"
      else
        echo "supervisor pid file stale (pid=$pid not running)"
        rm -f "$PID_FILE"
      fi
    else
      echo "supervisor not running (no pid file)"
    fi
    ;;
  status)
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
      echo "supervisor alive pid=$(cat "$PID_FILE")"
    else
      echo "supervisor dead"
    fi
    if [[ -f "$RESTART_HISTORY" ]]; then
      echo "last 5 restarts:"
      tail -5 "$RESTART_HISTORY"
    fi
    if [[ -f "$STATE_FILE" ]]; then echo "state:"; cat "$STATE_FILE"; fi
    ;;
  _lib)
    # v0.1: 只定义函数不跑 (offline 测试 source 用): source <this> _lib
    return 0 2>/dev/null || exit 0
    ;;
  *)
    echo "usage: $0 {start|stop|status}"
    exit 2
    ;;
esac
