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

# 🔴 间隔/来源/认领用【位置参数】传, 不用前缀赋值 —— 前缀赋值加在【函数】调用前会留在 shell 里,
#    污染后面所有用例。而"污染了"和"没污染"在全绿时读数相同。
#    且一律用 ${N-默认} 而不是 ${N:-默认}: 后者对【显式传空】也套默认 ⇒ "来源未声明"那格根本测不到。
run() { # name state lastResult alive expect_rc expect_kw [interval] [src] [unsafe_ack]
  out=$(J1_HV_TASK_STATE="$2" J1_HV_LAST_RESULT="$3" J1_HV_ALIVE="$4" J1_HV_NOW="$NOW" \
    J1_HV_INTERVAL="${7-5}" J1_HV_INTERVAL_SRC="${8-trigger}" J1_HV_UNSAFE_TEST="${9-}" sh "$S" 2>&1); rc=$?
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
# 🔴 1 是包装层【故意】的信号(发现故障但告警送不出去), 不是崩溃 ——
#    旧规则"非零=崩了"会打出"闸根本没被执行到", 而闸明明跑了。归错因 ⇒ 引向错的修法。
run "LastTaskResult=1 是已定义值不是崩溃" "Ready" "1" "$FRESH rc=1 alert=1" 1 "没有任何人知道"
run "LastTaskResult=127 仍算包装层坏"     "Ready" "127" "$FRESH rc=0"        2 "包装层本身失败"
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


# ── `.alive` 里的 alert= 那一格(Codex 2026-08-10 第三轮 RED) ──────────────────
# 🔴 它要说的是一句 rc 说不出来的话: **发现了故障, 而【没能告诉任何人】**。
#    这是本链最危险的状态 —— 它必须机器可判, 不能只活在一行日志里。
run "alert=0 (已送出)"          "Ready" "0" "$FRESH rc=1 alert=0"  1 "功能不正常"
run "alert=3 (被限流·非致命)"   "Ready" "0" "$FRESH rc=1 alert=3"  1 "功能不正常"
run "🔴 alert=1 (告警送不出去)" "Ready" "0" "$FRESH rc=1 alert=1"  1 "没有任何人知道"
run "alert 非整数"              "Ready" "0" "$FRESH rc=0 alert=x"  1 "alert 不是整数"
run "健康 + alert=0"            "Ready" "0" "$FRESH rc=0 alert=0"  0 ""
run "旧格式(无 alert=)仍可读"   "Ready" "0" "$FRESH rc=0"          0 ""
# 🔴 优先级: 两个都非零时, 要说出的是【没人知道】那句, 不是【读不出东西】那句 ——
#    前者比后者严重, 而它们的处置不同(去修告警链 vs 去修哨兵)。
run "rc=2 且 alert=1 ⇒ 报没人知道" "Ready" "0" "$FRESH rc=2 alert=1" 1 "没有任何人知道"

# ── 新鲜度那把尺【自己的出处】(Codex 2026-08-10 判 RED 的那格) ────────────────
# 🔴 头一条就是他给的反例原样: 任务真装 5 分钟, 调用方要 1000 分钟, 记录已 1000 秒。
#    旧版会把它判健康(上界被撑到 120120 秒), 新版必须拒。
STALE1000="2026-08-06T06:50:00Z"   # = NOW - 1000s
# Codex 反例: 任务真装 5 分钟, 调用方想用 1000 分钟去判一条已 1000 秒的记录。
# 走 test 来源而不显式认领 ⇒ 拒。
run "Codex 反例: 要1000m判1000s旧记录" "Ready" "0" "$STALE1000 rc=0"  2 "没有显式认领"  1000 test
run "来源未声明"                       "Ready" "0" "$FRESH rc=0"      2 "来源未声明"    5    ""
run "来源不认识"                       "Ready" "0" "$FRESH rc=0"      2 "来源不认识"    5    bogus
run "test 来源 + 显式认领 ⇒ 放行但打横幅" "Ready" "0" "$FRESH rc=0"   0 "不是生产判词"  1000 test 1
# 🔴 这一格【故意断言放行】, 并且它不是洞 —— 把两层的职责说清楚:
#    本文件信任 SRC=trigger 这个声明; **"声明的间隔是否真等于已注册触发器"由 PS 侧强制**
#    (它从 $t.Triggers[].Repetition.Interval 读, 并忽略命令行传入的值)。
#    ⇒ 若间隔【真的】是 1000 分钟, 那 1000 秒本来就该算新鲜。绑定在装置层, 不在这里。
run "SRC=trigger 且间隔真为1000m ⇒ 1000s算新鲜(职责在PS侧)" "Ready" "0" "$STALE1000 rc=0" 0 "" 1000 trigger
# 间隔的域
run "间隔 0"             "Ready" "0" "$FRESH rc=0"  2 "越界"      0    trigger
run "间隔负数"           "Ready" "0" "$FRESH rc=0"  2 "越界"      -5   trigger
run "间隔 1441 (超上限)"  "Ready" "0" "$FRESH rc=0"  2 "越界"      1441 trigger
run "间隔 1440 (上限内)"  "Ready" "0" "$FRESH rc=0"  0 ""          1440 trigger
run "间隔非整数 (1-2)"   "Ready" "0" "$FRESH rc=0"  2 "不是整数"  1-2  trigger
run "间隔非整数 (abc)"   "Ready" "0" "$FRESH rc=0"  2 "不是整数"  abc  trigger
# 边界随【真实间隔】走, 不是写死 720
run "间隔1m ⇒ 上界240s · 239s 新鲜" "Ready" "0" "2026-08-06T07:02:41Z rc=0" 0 ""     1 trigger
run "间隔1m ⇒ 上界240s · 241s 陈旧" "Ready" "0" "2026-08-06T07:02:39Z rc=0" 1 "陈旧" 1 trigger

echo ""
echo "result: $pass PASS / $fail FAIL"
[ "$fail" = "0" ] || exit 1
