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
# Bettor r472 (P0 incident 2026-06-10): health-check the SAME port the Console actually binds.
# kanet-start-headless.sh launches Console with PORT=$CONSOLE_PORT (default 3100). The old hardcoded
# :3200 here NEVER matched → every health check failed → supervisor killed + restarted a perfectly
# healthy Console every ~90s (fail#1/2/3 → 'death detected'), one half of last night's restart
# cascade. Default 3100 to match headless; override via CONSOLE_PORT if the operator changes it.
CONSOLE_PORT=${CONSOLE_PORT:-3100}

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" >> "$LOG"
}

console_alive() {
  curl -sf --max-time 5 "http://127.0.0.1:${CONSOLE_PORT}/" > /dev/null 2>&1
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

restart_console() {
  log "Console death detected — invoking kanet-start-headless.sh"
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
  local consecutive_fail=0
  local in_cool_down_until=0
  while true; do
    if console_alive; then
      consecutive_fail=0
    else
      consecutive_fail=$(( consecutive_fail + 1 ))
      log "health fail #${consecutive_fail}/${HEALTH_FAIL_THRESHOLD}"
      if (( consecutive_fail >= HEALTH_FAIL_THRESHOLD )); then
        local now=$(date +%s)
        if (( now < in_cool_down_until )); then
          local remain=$(( in_cool_down_until - now ))
          log "in cool-down period (${remain}s remain), skip restart"
        else
          local recent=$(count_recent_restarts)
          if (( recent >= RESTART_MAX_IN_WINDOW )); then
            in_cool_down_until=$(( now + COOL_DOWN_SEC ))
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
