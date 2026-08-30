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

# lib 模式(2026-08-30 J2, 只供离线向量测试 source 本文件取函数): KANET_SUPERVISOR_LIB_ONLY=1 时不 cd、
# 不进末尾 case(见文件尾 guard), KANET_ROOT 由调用方给(指向临时目录); 生产路径(无该 env)与此前逐字相同。
if [[ "${KANET_SUPERVISOR_LIB_ONLY:-0}" == "1" ]]; then
  KANET_ROOT="${KANET_ROOT:?KANET_ROOT required in lib mode}"
else
  cd "$(dirname "$0")/.."
  KANET_ROOT="$(pwd)"
fi
LOG="$KANET_ROOT/logs/console-supervisor.log"
PID_FILE="$KANET_ROOT/logs/pids/console-supervisor.pid"
RESTART_HISTORY="$KANET_ROOT/logs/console-supervisor-restarts.log"

CHECK_INTERVAL_SEC=${KANET_SUPERVISOR_CHECK_INTERVAL_SEC:-30}
HEALTH_FAIL_THRESHOLD=${KANET_SUPERVISOR_FAIL_THRESHOLD:-3}
RESTART_WINDOW_SEC=${KANET_SUPERVISOR_RESTART_WINDOW_SEC:-300}   # 5 min
RESTART_MAX_IN_WINDOW=${KANET_SUPERVISOR_RESTART_MAX:-5}
COOL_DOWN_SEC=${KANET_SUPERVISOR_COOL_DOWN_SEC:-1800}            # 30 min after burst
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

http_or_heartbeat_alive() {
  if curl -sf --max-time 5 "http://127.0.0.1:${CONSOLE_PORT}/" > /dev/null 2>&1; then
    return 0
  fi
  heartbeat_fresh
}

# ── GAP-1 毒化判活 (2026-08-30 J2 · docs/2026-08-30-j2-supervisor-restart-request-and-poison-liveness-design-v0.1.md §3 · NWT GREEN) ──
# 8/30 04:27Z 实录: console 撞 wasm 4 GiB 顶后进程活/HTTP 200/心跳 0–1 s, 链读层全坏, 本 supervisor 3.2 h 不判死。
# P1 = console.log 本实例 boot 行之后出现 wasm 毒化签名族(排除 settle-daemon 业务行 `unreachable=` 与 relay 转发行);
# P2 = 最新 heap-sample wasmBytes >= WASM_CAPPED_MB 且 WASM_FROZEN_WINDOW_SEC 内变化 < WASM_FROZEN_DELTA_MB(grow 失败后冻结)。
# 任一命中 ⇒ console_alive 返 1 ⇒ 走既有 3 次确认 + 风暴保护(NWT §7③: 不做即刻)。
# J1 05:56Z 三坑: ① wasmBytes 是 `3373.1MB` 浮点+后缀, 正则 `([0-9.]+)MB` 且解析失败 ≠ 安全(LOUD);
# ② 取样上限 N / 实取 M 都打出来, M>=N 打旗标, 冻结起点若为窗口第一条 ⇒ 起点被截; ③ "不变"只读行内 at=/wasmBytes=, 禁 mtime/size。
CONSOLE_LOG="$KANET_ROOT/logs/console.log"
THRESHOLDS_FILE="$KANET_ROOT/scripts/console-poison-thresholds.env"   # 单源(NWT §7①): 与 KANet-UI 盯守同一份数字
read_threshold() {  # read_threshold KEY DEFAULT — 只 grep 数字 key, 不 source; 非数字 ⇒ 默认值 + LOUD
  local key="$1" def="$2" v=""
  [[ -f "$THRESHOLDS_FILE" ]] && v="$(grep -E "^${key}=" "$THRESHOLDS_FILE" 2>/dev/null | tail -1 | cut -d= -f2 | tr -d '[:space:]\r' || true)"
  if [[ "$v" =~ ^[0-9]+(\.[0-9]+)?$ ]]; then echo "$v"; else log "[poison] threshold $key unreadable ('${v}') in $THRESHOLDS_FILE — using default $def"; echo "$def"; fi
}
WASM_CAPPED_MB="$(read_threshold WASM_CAPPED_MB 4000)"
WASM_FROZEN_WINDOW_SEC="$(read_threshold WASM_FROZEN_WINDOW_SEC 600)"
WASM_FROZEN_DELTA_MB="$(read_threshold WASM_FROZEN_DELTA_MB 1)"
POISON_SIG_RE='unreachable executed|RuntimeError|memory\.grow|RangeError.*(wasm|WebAssembly)|wasm panic|memory access out of bounds|could not allocate'   # 用 grep -i 匹配(V8 打 "WebAssembly.Memory.grow()")
POISON_EXCLUDE_RE='unreachable=|^\[relay:'
POISON_SAMPLE_N=15            # heap-sample 每 ≈60 s 一行; 窗口 600 s 需 ≥11 条, 15 留余量
POISON_EVIDENCE=""            # 命中时由 poison_p1/p2 写入(不走 $(..) 子壳, 否则状态丢)
_poison_boot_line=0           # 本实例 boot 行(console.log 最后一个 `[db] path=`)
_poison_last_line=0           # 已扫到的行号: 只数新行(NWT (a)), 命中后 latch 到本实例换代
_poison_p1_latched=""

poison_p1() {
  [[ -f "$CONSOLE_LOG" ]] || return 1
  local boot total
  boot="$(grep -a -n '^\[db\] path=' "$CONSOLE_LOG" 2>/dev/null | tail -1 | cut -d: -f1 || true)"; boot="${boot:-1}"
  total="$(wc -l < "$CONSOLE_LOG" 2>/dev/null || echo 0)"
  if (( boot != _poison_boot_line )) || (( total < _poison_last_line )); then   # 新实例 / 日志被截断 ⇒ 重置
    _poison_boot_line=$boot; _poison_last_line=$(( boot - 1 )); _poison_p1_latched=""
  fi
  if [[ -n "$_poison_p1_latched" ]]; then POISON_EVIDENCE="$_poison_p1_latched"; return 0; fi
  local start=$(( _poison_last_line + 1 )); (( start < boot )) && start=$boot
  local hit=""
  if (( total >= start )); then
    hit="$(sed -n "${start},${total}p" "$CONSOLE_LOG" | grep -a -i -E "$POISON_SIG_RE" | grep -a -v -E "$POISON_EXCLUDE_RE" | head -1 || true)"
  fi
  _poison_last_line=$total
  if [[ -n "$hit" ]]; then
    _poison_p1_latched="P1 line>${start} ${hit:0:120}"; POISON_EVIDENCE="$_poison_p1_latched"; return 0
  fi
  return 1
}

poison_p2() {
  [[ -f "$CONSOLE_LOG" ]] || return 1
  local out
  out="$(grep -a 'diag:heap-sample' "$CONSOLE_LOG" 2>/dev/null | tail -n "$POISON_SAMPLE_N" | awk -v N="$POISON_SAMPLE_N" -v CAP="$WASM_CAPPED_MB" -v WIN="$WASM_FROZEN_WINDOW_SEC" -v DELTA="$WASM_FROZEN_DELTA_MB" '
    function iso2epoch(s,   y,mo,d,h,mi,se) { y=substr(s,1,4); mo=substr(s,6,2); d=substr(s,9,2); h=substr(s,12,2); mi=substr(s,15,2); se=substr(s,18,2); return mktime(y" "mo" "d" "h" "mi" "se) }
    {
      if (match($0,/at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}/) == 0) next
      t=iso2epoch(substr($0,RSTART+3,19))
      if (match($0,/wasmBytes=[0-9]+(\.[0-9]+)?MB/) == 0) { bad++; next }      # 坑①: 浮点+后缀; 不匹配=解析失败, 不是 0
      w=substr($0,RSTART+10,RLENGTH-12)+0
      n++; T[n]=t; W[n]=w
    }
    END {
      if (bad>0) { printf "PARSEFAIL bad=%d\n", bad; exit }
      if (n==0) { print "NOSAMPLE"; exit }
      last=W[n]; tl=T[n]; ref=-1
      for (i=n-1;i>=1;i--) if (T[i] <= tl-WIN) { ref=i; break }
      flag=(n>=N)?" cap-reached(N="N")":""
      if (ref<0) { printf "INSUFFICIENT samples=%d/%d span=%ds wasm=%.1f%s\n", n, N, tl-T[1], last, flag; exit }
      d=W[n]-W[ref]; if (d<0) d=-d
      if (last>=CAP && d<DELTA) {
        # 坑②: 冻结起点 = 连续 >=CAP 段的首样本; 若它就是窗口第一条 ⇒ 起点被截(真实更久), 打旗不静默
        o=n; while (o>1 && W[o-1]>=CAP) o--
        origin=(o==1)?" origin-truncated":""
        printf "POISONED wasm=%.1fMB frozen_for>=%ds delta=%.2fMB samples=%d/%d%s%s\n", last, tl-T[o], d, n, N, flag, origin; exit }
      printf "OK wasm=%.1fMB delta=%.2fMB/%ds samples=%d/%d%s\n", last, d, tl-T[ref], n, N, flag
    }' 2>/dev/null || true)"
  case "$out" in
    POISONED*) POISON_EVIDENCE="P2 ${out#POISONED }"; return 0 ;;
    PARSEFAIL*) log "[poison] P2 heap-sample parse failure ($out) — NOT treated as safe; fix regex/instrument"; return 1 ;;
    *) return 1 ;;
  esac
}

console_alive() {
  if poison_p1; then log "POISON: $POISON_EVIDENCE"; return 1; fi
  if poison_p2; then log "POISON: $POISON_EVIDENCE"; return 1; fi
  http_or_heartbeat_alive
}

# ── GAP-2 请求重启入口 (设计稿 §2 · NWT: step-3-only / cooldown 内只 1 次 / nonce 防重放 / 先 rename 再 restart) ──
# 非提权会话只写 logs/console-restart-request 一行 `requester|nonce|utc|reason`(先写 .tmp 再 mv 原子);
# 文件语义 = "step-1/2(花钱面 CLEAN + 停守卫)已由请求方核过, 执行 step-3 kill" —— 本脚本不核 ①②, 也不能被借来跳序。
# 文件内容只读字段、不 source、不 eval、不拼进命令; 伪造后果上界 = 一次 headless 重启(有界、可审计)。
RESTART_REQUEST="$KANET_ROOT/logs/console-restart-request"
RESTART_REQUEST_MIN_GAP_SEC=${KANET_SUPERVISOR_REQUEST_MIN_GAP_SEC:-3600}   # cooldown 内只处理 1 个请求(NWT ①, §7②)
IN_COOL_DOWN_UNTIL=0   # 风暴保护 cool-down 截止(原 run_supervisor 局部变量, 请求路径也要看它, 故提全局)

record_request() {
  mkdir -p "$(dirname "$RESTART_HISTORY")"
  echo "$(date +%s) $(date -u '+%Y-%m-%dT%H:%M:%SZ') request" >> "$RESTART_HISTORY"
}
last_request_epoch() {
  [[ -f "$RESTART_HISTORY" ]] || { echo 0; return; }
  awk '$3=="request"{e=$1} END{print e+0}' "$RESTART_HISTORY"
}
_request_park() {  # _request_park <suffix> — 请求文件改名(先于任何动作: write-ahead)
  mv -f "$RESTART_REQUEST" "$RESTART_REQUEST.$1" 2>/dev/null || rm -f "$RESTART_REQUEST"
}

handle_restart_request() {  # 返 0 = 本 tick 执行了一次请求重启
  [[ -f "$RESTART_REQUEST" ]] || return 1
  local line requester nonce when reason utc safe_nonce now last recent
  line="$(head -c 512 "$RESTART_REQUEST" 2>/dev/null | head -1 | tr -d '\r' || true)"
  IFS='|' read -r requester nonce when reason <<< "$line"
  requester="$(printf '%s' "${requester:-?}" | tr -cd 'A-Za-z0-9_.-' | cut -c1-32)"
  safe_nonce="$(printf '%s' "${nonce:-none}" | tr -cd 'A-Za-z0-9_-' | cut -c1-32)"; safe_nonce="${safe_nonce:-none}"
  when="$(printf '%s' "${when:-?}" | tr -cd 'A-Za-z0-9:TZ.-' | cut -c1-32)"
  reason="$(printf '%s' "${reason:-?}" | tr -d '\n' | cut -c1-200)"
  utc="$(date -u +%Y%m%dT%H%M%SZ)"
  now=$(date +%s)
  if compgen -G "$RESTART_REQUEST.done-*-$safe_nonce" > /dev/null; then
    log "restart-request IGNORED (replay nonce=$safe_nonce) requester=$requester"; _request_park "ignored-$utc-$safe_nonce"; return 1
  fi
  last=$(last_request_epoch)
  if (( now - last < RESTART_REQUEST_MIN_GAP_SEC )); then
    log "restart-request IGNORED (rate-limit: 1 per ${RESTART_REQUEST_MIN_GAP_SEC}s, last=$(( now - last ))s ago) requester=$requester nonce=$safe_nonce"; _request_park "ignored-$utc-$safe_nonce"; return 1
  fi
  if (( now < IN_COOL_DOWN_UNTIL )); then
    log "restart-request IGNORED (storm cool-down, $(( IN_COOL_DOWN_UNTIL - now ))s remain) requester=$requester nonce=$safe_nonce"; _request_park "ignored-$utc-$safe_nonce"; return 1
  fi
  recent=$(count_recent_restarts)
  if (( recent >= RESTART_MAX_IN_WINDOW )); then
    log "restart-request IGNORED (${recent} restarts in last ${RESTART_WINDOW_SEC}s) requester=$requester nonce=$safe_nonce"; _request_park "ignored-$utc-$safe_nonce"; return 1
  fi
  log "restart-request ACCEPTED requester=$requester nonce=$safe_nonce requested_at=$when reason=$reason"
  _request_park "done-$utc-$safe_nonce"       # 先 rename(write-ahead), 再动作: 动作若带走本进程, 下次 tick 不重复触发
  record_request
  restart_console || true
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
  announce_restart
  bash "$KANET_ROOT/kanet-start-headless.sh" >> "$LOG" 2>&1 || log "kanet-start-headless fail"
  sleep 5
  if console_alive; then
    log "Console restarted OK"
    record_restart
    return 0
  fi
  log "Console restart fail (still not alive after 5s)"
  return 1
}

run_supervisor() {
  echo $$ > "$PID_FILE"
  log "supervisor start pid=$$ check_interval=${CHECK_INTERVAL_SEC}s fail_threshold=${HEALTH_FAIL_THRESHOLD} restart_window=${RESTART_WINDOW_SEC}s max_restarts=${RESTART_MAX_IN_WINDOW} cool_down=${COOL_DOWN_SEC}s"
  log "poison-liveness armed: cap=${WASM_CAPPED_MB}MB window=${WASM_FROZEN_WINDOW_SEC}s delta<${WASM_FROZEN_DELTA_MB}MB; restart-request file=${RESTART_REQUEST} min_gap=${RESTART_REQUEST_MIN_GAP_SEC}s"
  local consecutive_fail=0
  while true; do
    if handle_restart_request; then          # GAP-2: 请求重启优先于判活(请求方已做 step-1/2)
      consecutive_fail=0
    elif console_alive; then
      consecutive_fail=0
    else
      consecutive_fail=$(( consecutive_fail + 1 ))
      log "health fail #${consecutive_fail}/${HEALTH_FAIL_THRESHOLD}"
      if (( consecutive_fail >= HEALTH_FAIL_THRESHOLD )); then
        local now=$(date +%s)
        if (( now < IN_COOL_DOWN_UNTIL )); then
          local remain=$(( IN_COOL_DOWN_UNTIL - now ))
          log "in cool-down period (${remain}s remain), skip restart"
        else
          local recent=$(count_recent_restarts)
          if (( recent >= RESTART_MAX_IN_WINDOW )); then
            IN_COOL_DOWN_UNTIL=$(( now + COOL_DOWN_SEC ))
            log "RESTART STORM: ${recent} restarts in last ${RESTART_WINDOW_SEC}s — enter ${COOL_DOWN_SEC}s cool-down"
          else
            restart_console || true
          fi
          consecutive_fail=0
        fi
      fi
    fi
    sleep "$CHECK_INTERVAL_SEC"
  done
}

# lib 模式: 只定义函数, 不进 case(离线向量测试 source 本文件; 见文件头)
if [[ "${KANET_SUPERVISOR_LIB_ONLY:-0}" == "1" ]]; then return 0 2>/dev/null || exit 0; fi

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
    ;;
  *)
    echo "usage: $0 {start|stop|status}"
    exit 2
    ;;
esac
