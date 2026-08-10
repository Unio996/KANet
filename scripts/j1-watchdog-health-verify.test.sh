#!/bin/sh
# j1-watchdog-health-verify.sh 的用例。Codex 2026-08-10 点名要覆盖的八格全在这里:
#   registered-but-never-ran · fresh rc=0 · fresh rc=1 · fresh rc=2 ·
#   stale alive · malformed alive · Disabled task · wrapper-level nonzero LastTaskResult
#
# 🔴 时间用 J1_HV_NOW 注入, 不靠真实时钟 —— 否则"陈旧"这一格要么等两小时, 要么根本测不了。
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || SELF_DIR=.
S=${J1_HEALTH_UNDER_TEST:-$SELF_DIR/j1-watchdog-health-verify.sh}
pass=0; fail=0
NOW=1786000000            # 固定"现在"
FRESH="2026-08-06T07:06:20Z"      # = NOW - 20s
OLD="2026-08-06T06:40:00Z"        # = NOW - 1600s (> 上界 720s)
FUTURE="2026-08-06T07:36:40Z"     # = NOW + 1800s

run() { # name  state  lastResult  alive  expect_rc  expect_kw
  out=$(J1_HV_TASK_STATE="$2" J1_HV_LAST_RESULT="$3" J1_HV_ALIVE="$4" J1_HV_NOW="$NOW" sh "$S" 2>&1); rc=$?
  ok=1
  [ "$rc" != "$5" ] && ok=0
  if [ -n "$6" ]; then case "$out" in *"$6"*) ;; *) ok=0 ;; esac
  else [ -n "$out" ] && ok=0
  fi
  if [ "$ok" = "1" ]; then pass=$((pass+1)); printf '[PASS] %-36s rc=%s\n' "$1" "$rc"
  else fail=$((fail+1)); printf '[FAIL] %-36s rc=%s (want %s) out=%s\n' "$1" "$rc" "$5" "$out"; fi
}

echo "--- j1-watchdog-health-verify.sh ---"
# 装置态
run "task absent"                    "absent"   ""  ""                     2 "ARMED=no"
run "task Disabled"                  "Disabled" ""  "$FRESH rc=0"          2 "【存在】与【在跑】是两件事"
run "unknown task state"             "Weird"    ""  "$FRESH rc=0"          2 "无法识别"
# 包装层自身失败(这一格对计划任务可见, 对日志不可见)
run "wrapper failed LastTaskResult=2" "Ready"   "2" "$FRESH rc=0"          2 "包装层本身失败"
run "LastTaskResult non-integer"      "Ready"   "x" "$FRESH rc=0"          2 "不是整数"
# registered-but-never-ran
run "registered but never ran"       "Ready"    "0" ""                     1 "从未跑成过"
# 🔴 三个 rc 档 —— 这就是 Codex 点的那个洞: 旧 -Verify 三格全放行
run "fresh rc=0 (healthy)"           "Ready"    "0" "$FRESH rc=0"          0 ""
run "fresh rc=1 (sentinel fault)"    "Ready"    "0" "$FRESH rc=1"          1 "功能不正常"
run "fresh rc=2 (blind sentinel)"    "Ready"    "0" "$FRESH rc=2"          1 "功能不正常"
run "Running state, fresh rc=0"      "Running"  "0" "$FRESH rc=0"          0 ""
# 新鲜度两端
run "stale alive (1600s)"            "Ready"    "0" "$OLD rc=0"            1 "陈旧"
run "future alive (+1800s)"          "Ready"    "0" "$FUTURE rc=0"         1 "未来"
run "boundary: exactly 720s old"     "Ready"    "0" "2026-08-06T06:54:40Z rc=0" 0 ""
run "boundary: 721s old"             "Ready"    "0" "2026-08-06T06:54:39Z rc=0" 1 "陈旧"
# 格式
run "malformed alive (no rc)"        "Ready"    "0" "$FRESH"               1 "读不懂"
run "malformed alive (garbage)"      "Ready"    "0" "hello world"          1 "读不懂"
run "malformed rc (1-2)"             "Ready"    "0" "$FRESH rc=1-2"        1 "不是整数"
run "malformed rc (--5)"             "Ready"    "0" "$FRESH rc=--5"        1 "不是整数"
run "unparseable timestamp"          "Ready"    "0" "2026-13-45T99:99:99Z rc=0" 1 "解析不了"

echo ""
echo "result: $pass PASS / $fail FAIL"
[ "$fail" = "0" ] || exit 1
