#!/bin/bash
# offline 验收 (design §5): 在隔离 KANET_ROOT 下 source v01 脚本函数, 打桩 console_alive / pid_alive / headless.
# 用法: bash scratch/_j2_supervisor_v01/selftest.sh   (不碰 live logs/, 不碰进程)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$HERE/t"; rm -rf "$T"; mkdir -p "$T/sub" "$T/logs/pids"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "[PASS] $1"; }
bad()  { FAIL=$((FAIL+1)); echo "[FAIL] $1 :: $2"; }
expect() { # name actual expected
  if [[ "$2" == "$3" ]]; then ok "$1"; else bad "$1" "got '$2' want '$3'"; fi
}

# 位于 docs/provenance 时: index.v01.js 不入库(整份 index.js 副本太大), 用 diff 从仓内现役 index.js 重建
REPO="$(cd "$HERE/../../.." 2>/dev/null && git rev-parse --show-toplevel 2>/dev/null || echo "$HERE/../../..")"
if [[ ! -f "$HERE/index.v01.js" && -f "$HERE/index.v01.diff" ]]; then
  patch -s -o "$HERE/index.v01.js" "$REPO/kasia-console/src/index.js" "$HERE/index.v01.diff" && echo "[info] index.v01.js rebuilt from $REPO/kasia-console/src/index.js + index.v01.diff" || bad "rebuild index.v01.js via patch" "patch failed (index.js drifted? regenerate diff)"
fi

# ── 1. 语法 ──
bash -n "$HERE/kanet-console-supervisor.v01.sh" && ok "bash -n v01.sh" || bad "bash -n v01.sh" "syntax error"
node --check "$HERE/index.v01.js" 2>/dev/null && ok "node --check index.v01.js" || bad "node --check index.v01.js" "parse error"

# ── 2. source 函数: 脚本顶部 cd "$(dirname "$0")/.."; source 时 $0 = 本 harness 路径 ⇒ 用 BASH_ARGV0 (bash>=5) 把 $0 指到 t/scripts/x ⇒ cd .. 落在 t ⇒ KANET_ROOT=t ──
mkdir -p "$T/scripts"; cd "$T/sub"
BASH_ARGV0="$T/scripts/kanet-console-supervisor.sh"
CONSOLE_PORT=1 KANET_SUPERVISOR_CHECK_INTERVAL_SEC=0 source "$HERE/kanet-console-supervisor.v01.sh" _lib
expect "KANET_ROOT isolated" "$KANET_ROOT" "$T"
set -e   # §5-4: set -e 下跑 guard, 不得退出 (脚本自身也是 set -euo pipefail)

STUB_ALIVE=1; STUB_PID_RC=0
pid_alive_real=$(declare -f pid_alive)   # 真函数存起来, §7 恢复
console_alive() { (( STUB_ALIVE == 1 )); }
pid_alive() { return "$STUB_PID_RC"; }
RESTARTS=0
restart_console_real=$(declare -f restart_console)
restart_console() { RESTARTS=$((RESTARTS+1)); last_restart_ts=$(date +%s); save_state; record_restart; return 0; }
marker() { echo "$1 $(( ($(date +%s) - $2) * 1000 ))" > "$BOOT_MARKER"; }   # pid, age_s

# ── 3. 五态 ──
STUB_ALIVE=1; expect "state ALIVE (curl ok)" "$(console_state)" "ALIVE"
STUB_ALIVE=0; rm -f "$BOOT_MARKER"; expect "state DEAD (no marker)" "$(console_state)" "DEAD"
marker 4242 10;  STUB_PID_RC=0; expect "state BOOTING (pid alive, age 10s)" "$(console_state)" "BOOTING"
marker 4242 301; STUB_PID_RC=0; expect "state HUNG_BOOT (age 301s > 300)" "$(console_state)" "HUNG_BOOT"
marker 4242 300; STUB_PID_RC=0; expect "state BOOTING (age 300s == grace, 含边界)" "$(console_state)" "BOOTING"
marker 4242 10;  STUB_PID_RC=1; expect "state DEAD (pid gone)" "$(console_state)" "DEAD"
marker 4242 10;  STUB_PID_RC=2; expect "state UNKNOWN (tasklist fail)" "$(console_state)" "UNKNOWN"
echo "garbage" > "$BOOT_MARKER"; STUB_PID_RC=0; expect "state DEAD (garbage marker)" "$(console_state)" "DEAD"

# ── 4. tick 决策 (真 tasklist 阳性对照另测) ──
consecutive_fail=0; was_booting=0; last_restart_ts=0; last_boot_ok_ts=0; short_streak=0; cool_down_until=0; RESTARTS=0
STUB_ALIVE=0; marker 4242 10; STUB_PID_RC=0
supervisor_tick; supervisor_tick; supervisor_tick; supervisor_tick
expect "BOOTING x4 ⇒ 不重启" "$RESTARTS" "0"
expect "BOOTING ⇒ was_booting=1" "$was_booting" "1"
STUB_ALIVE=1; supervisor_tick
expect "BOOTING→ALIVE ⇒ last_boot_ok_ts 记录" "$(( last_boot_ok_ts > 0 ))" "1"
grep -q "boot OK: boot_ms=" "$LOG" && ok "boot_ms 日志行" || bad "boot_ms 日志行" "missing"
STUB_ALIVE=0; STUB_PID_RC=1; supervisor_tick
expect "DEAD ⇒ 立即重启 (1 tick, 不等 3 次)" "$RESTARTS" "1"
STUB_ALIVE=0; marker 4242 400; STUB_PID_RC=0; RESTARTS=0; last_restart_ts=0; last_boot_ok_ts=0; short_streak=0
supervisor_tick
expect "HUNG_BOOT ⇒ 立即重启" "$RESTARTS" "1"
STUB_ALIVE=0; marker 4242 10; STUB_PID_RC=2; RESTARTS=0; consecutive_fail=0; last_restart_ts=0; short_streak=0
supervisor_tick; supervisor_tick; expect "UNKNOWN x2 ⇒ 不重启 (退回 3-fail)" "$RESTARTS" "0"
supervisor_tick; expect "UNKNOWN x3 ⇒ 重启 (fail-safe 旧逻辑)" "$RESTARTS" "1"

# ── 5. lifetime guard (直接喂状态; 首次 last_restart_ts=0 不计) ──
now=$(date +%s)
last_restart_ts=0; last_boot_ok_ts=0; short_streak=0; cool_down_until=0
lifetime_guard "$now"; expect "首次 (last_restart_ts=0) streak=0" "$short_streak" "0"
last_restart_ts=$((now-100)); last_boot_ok_ts=0; short_streak=0
lifetime_guard "$now"; expect "lifetime 100 ⇒ streak 1" "$short_streak" "1"
lifetime_guard "$now"; expect "lifetime 100 ⇒ streak 2" "$short_streak" "2"
rc=0; lifetime_guard "$now" || rc=$?
expect "第 3 个短命 ⇒ guard 拒 (rc=1)" "$rc" "1"
expect "第 3 个短命 ⇒ cool_down_until = now+1800" "$cool_down_until" "$((now+1800))"
grep -q "cool_down_until=$((now+1800))" "$STATE_FILE" && ok "cool-down 已持久化到 state.env" || bad "cool-down 持久化" "missing"
last_restart_ts=$((now-100)); short_streak=1; cool_down_until=0
last_boot_ok_ts=$((now-400)); last_restart_ts=$((now-500))   # 上次 boot ok 距今 400 ⇒ 长命
lifetime_guard "$now"; expect "lifetime 400 ⇒ streak 归零" "$short_streak" "0"
last_boot_ok_ts=$((now-50)); last_restart_ts=$((now-500))    # boot ok 后 50s 死 ⇒ 短命 (用 boot_ok 而非 restart 时刻)
lifetime_guard "$now"; expect "lifetime 由 last_boot_ok_ts 算 (50) ⇒ streak 1" "$short_streak" "1"
# tick 层: cool-down 内 DEAD 不重启
STUB_ALIVE=0; STUB_PID_RC=1; RESTARTS=0; cool_down_until=$((now+1000)); consecutive_fail=0
supervisor_tick; expect "cool-down 内 DEAD ⇒ skip restart" "$RESTARTS" "0"
cool_down_until=0

# ── 6. write-ahead 回归 (§5-3): 真 restart_console + 假 headless kill 掉调用者 ──
eval "$restart_console_real"   # 恢复真函数
cat > "$KANET_ROOT/kanet-start-headless.sh" <<'EOF'
#!/bin/bash
kill -9 $PPID   # 模拟 headless :65-71 杀掉调用者 supervisor
sleep 1
EOF
announce_restart() { :; }
rm -f "$STATE_FILE" "$RESTART_HISTORY"
( last_restart_ts=0; restart_console ) 2>/dev/null || true
[[ -f "$STATE_FILE" ]] && grep -q "^last_restart_ts=[1-9]" "$STATE_FILE" && ok "write-ahead: 被杀前 state.env 已写 last_restart_ts" || bad "write-ahead state.env" "missing"
[[ -f "$RESTART_HISTORY" ]] && (( $(wc -l < "$RESTART_HISTORY") == 1 )) && ok "write-ahead: 被杀前 restarts.log 已记 1 行" || bad "write-ahead restarts.log" "missing"
# 新 supervisor 起来 load_state 继承
last_restart_ts=0; short_streak=0; cool_down_until=0
load_state; expect "新 supervisor load_state 继承 last_restart_ts" "$(( last_restart_ts > 0 ))" "1"
printf 'short_streak=abc\ncool_down_until=999999999999\nevil=1; rm -rf /\nlast_restart_ts=12 34\n' > "$STATE_FILE"   # 只含脏行 + 一条合法行
short_streak=7; last_restart_ts=5; load_state
expect "load_state 拒非数字值 (short_streak 保持 7)" "$short_streak" "7"
expect "load_state 拒带空格值 (last_restart_ts 保持 5)" "$last_restart_ts" "5"
expect "load_state 认数字值" "$cool_down_until" "999999999999"
[[ -d / ]] && ok "load_state 不 eval 脏行 (evil 行无副作用)"

# ── 7. 真 tasklist 阳性/阴性对照 (存在性, 非提权) ──
eval "$pid_alive_real"   # 恢复真 pid_alive (tasklist)
NODE_PID="$(powershell -NoProfile -Command '(Get-Process node -ErrorAction SilentlyContinue | Select-Object -First 1).Id' 2>/dev/null | tr -d '[:space:]')"
if [[ "$NODE_PID" =~ ^[0-9]+$ ]]; then
  rc=0; pid_alive "$NODE_PID" || rc=$?; expect "tasklist 阳性对照: 真 node.exe pid=$NODE_PID ⇒ 0" "$rc" "0"
else
  bad "tasklist 阳性对照" "no node.exe found to test against"
fi
rc=0; pid_alive 4000000 || rc=$?; expect "tasklist 阴性对照: pid 4000000 ⇒ 1" "$rc" "1"
tasklist() { return 1; }
rc=0; pid_alive 1 || rc=$?; expect "tasklist 失败 ⇒ 2 (UNKNOWN)" "$rc" "2"

set +e
echo "supervisor-v01 selftest: $PASS PASS / $FAIL FAIL"
(( FAIL == 0 ))
