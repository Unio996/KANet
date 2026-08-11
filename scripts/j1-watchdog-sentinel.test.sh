#!/bin/sh
# j1-watchdog-sentinel-once.sh 的用例。Codex 2026-08-10 点名要覆盖的七格全在这里:
#   fresh · exact boundary · stale · future · missing · malformed · ssh-unreachable
#
# 🔴 它测的是【判读数】那一半, 通过 J1_WD_TEST_LINE 注入读数 —— 不需要真机器, 也【不需要为了测它
#    去制造一次真故障】。取读数那一半(probe)另有单发实测, 两半分开, 各自可证。
# 🔴 断言【退码 + 输出关键词】两样, 不只断言"有没有喊":
#    "取不到"(2) 与 "故障"(1) 在只看有没有输出时读数相同, 而它们导出的动作相反(修链路 vs 救矿机)。
# 路径从本文件位置推导, 不写死 —— @NWT 2026-08-10 实测: 她那台检出在 /d/kanet-tn12,
# 写死 /d/kanet/kanet/... 的版本在她机器上直接 "No such file or directory"。
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || SELF_DIR=.
S=${J1_SENTINEL_UNDER_TEST:-$SELF_DIR/j1-watchdog-sentinel-once.sh}
pass=0; fail=0

run() { # name  line  expect_rc  expect_kw
  out=$(J1_WD_TEST_LINE="$2" sh "$S" 2>&1); rc=$?
  ok=1
  [ "$rc" != "$3" ] && ok=0
  if [ -n "$4" ]; then case "$out" in *"$4"*) ;; *) ok=0 ;; esac
  else [ -n "$out" ] && ok=0
  fi
  if [ "$ok" = "1" ]; then pass=$((pass+1)); printf '[PASS] %-34s rc=%s\n' "$1" "$rc"
  else fail=$((fail+1)); printf '[FAIL] %-34s rc=%s (want %s) out=%s\n' "$1" "$rc" "$3" "$out"; fi
}

echo "--- j1-watchdog-sentinel-once.sh ---"
# fresh: 正常 ⇒ 静默 + rc 0
run "fresh (30s)"                 "WD=1 MINER=1 HB=30000"     0 ""
# exact boundary: 恰好等于上界 ⇒ 仍算新鲜(判据是 > 才故障, 边界要测在两侧)
run "exact ceiling (300000)"      "WD=1 MINER=1 HB=300000"    0 ""
run "one ms over ceiling"         "WD=1 MINER=1 HB=300001"    1 "心跳陈旧"
# stale: 明显超时
run "stale (1h)"                  "WD=1 MINER=1 HB=3600000"   1 "心跳陈旧"
# future: 负 age —— 只查上界的实现会把它读成健康
run "future (-120s)"              "WD=1 MINER=1 HB=-120000"   1 "未来"
run "future at floor (-60001)"    "WD=1 MINER=1 HB=-60001"    1 "未来"
run "slightly future, in window"  "WD=1 MINER=1 HB=-1000"     0 ""
# missing / malformed
run "missing heartbeat (none)"    "WD=1 MINER=1 HB=none"      1 "心跳不可用"
run "malformed heartbeat (bad)"   "WD=1 MINER=1 HB=bad"       1 "心跳不可用"
run "empty heartbeat"             "WD=1 MINER=1 HB="          1 "心跳不可用"
# 🔴 @KANet-UI 2026-08-10 实测打穿的那一族: 全由【数字和连字符】组成, 因此穿过旧字符类,
#    再让 `[ -gt ]` 报 integer expression expected ⇒ if 当假 ⇒ 两道阈值走空 ⇒ 静默 exit 0。
#    失败方向朝着"没事" = 最坏的一种。这几行就是那个缺陷本身。
run "KUI: dash inside (1-2)"      "WD=1 MINER=1 HB=1-2"       1 "心跳不可用"
run "KUI: double minus (--5)"     "WD=1 MINER=1 HB=--5"       1 "心跳不可用"
run "lone dash"                   "WD=1 MINER=1 HB=-"         1 "心跳不可用"
run "trailing dash (5-)"          "WD=1 MINER=1 HB=5-"        1 "心跳不可用"
run "minus in middle (30-000)"    "WD=1 MINER=1 HB=30-000"    1 "心跳不可用"
run "plus sign (+5)"              "WD=1 MINER=1 HB=+5"        1 "心跳不可用"
run "negative zero (-0)"          "WD=1 MINER=1 HB=-0"        0 ""
# 进程数
run "watchdog gone (WD=0)"        "WD=0 MINER=1 HB=30000"     1 "实例数=0"
run "two watchdogs (WD=2)"        "WD=2 MINER=1 HB=30000"     1 "实例数=2"
run "miner gone (MINER=0)"        "WD=1 MINER=0 HB=30000"     1 "矿机数=0"
# ── 刹车状态那一格(2026-08-10 23:51 第一次真响就是误报在这里) ──────────────
# 🔴 方向是承重的: 只有【明确在刹车】才静默; 读不到一律出声。
#    反过来会把一次真正的矿机死亡永久静音。
run "MINER=0 且在刹车(带年龄) ⇒ 静默" "WD=1 MINER=0 HB=30000 BRAKE=yes BRKAGE=20" 0 ""
run "MINER=0 且不在刹车 ⇒ 出声"    "WD=1 MINER=0 HB=30000 BRAKE=no"      1 "不在刹车中"
run "MINER=0 刹车状态 unknown ⇒ 出声" "WD=1 MINER=0 HB=30000 BRAKE=unknown" 1 "读不到"
run "MINER=0 完全没有 BRAKE 字段 ⇒ 出声" "WD=1 MINER=0 HB=30000"          1 "读不到"
run "MINER=1 带 BRAKE=yes 仍正常"  "WD=1 MINER=1 HB=30000 BRAKE=yes"     0 ""
run "刹车中但 WD=0 ⇒ 仍出声"       "WD=0 MINER=0 HB=30000 BRAKE=yes"     1 "实例数=0"
run "刹车中但心跳陈旧 ⇒ 仍出声"    "WD=1 MINER=0 HB=3600000 BRAKE=yes"   1 "心跳陈旧"
# 🔴 带 BRKAT 字段(BRAKE 之后还有别的字段)时, BRAKE 与 HB 都不能被解坏 ——
#    加 BRAKE 字段那次就把 HB 的贪婪正则弄坏过一次, 这几格钉住以后再加字段。
run "BRKAT+BRKAGE 在后: 刹车中静默" "WD=1 MINER=0 HB=30000 BRAKE=yes BRKAT=2026-08-11T10:38:19 BRKAGE=45" 0 ""
run "BRKAT 在后: 不在刹车仍出声" "WD=1 MINER=0 HB=30000 BRAKE=no BRKAT=2026-08-11T10:42:27"  1 "不在刹车中"
run "BRKAT 在后: 心跳仍解得出"   "WD=1 MINER=1 HB=3600000 BRAKE=no BRKAT=x"                 1 "心跳陈旧"
# ── 豁免的【授权时效】(Codex 2026-08-11 判 RED 的那格) ────────────────────
# 🔴 BRAKE=yes 不再自动等于静默 —— 授予它的那个 marker 自己也要够新。
#    上界 1800s = 20 脉冲 × ~70s × 1.3 余量(刹车是一整集, 不是一次 20 秒脉冲)。
run "刹车 20s 前 ⇒ 静默"          "WD=1 MINER=0 HB=30000 BRAKE=yes BRKAGE=20"     0 ""
run "刹车 1799s 前 ⇒ 仍静默(边界)" "WD=1 MINER=0 HB=30000 BRAKE=yes BRKAGE=1799"   0 ""
run "刹车 1800s 前 ⇒ 仍静默(边界)" "WD=1 MINER=0 HB=30000 BRAKE=yes BRKAGE=1800"   0 ""
run "🔴 陈旧 ENGAGED 1801s ⇒ 出声" "WD=1 MINER=0 HB=30000 BRAKE=yes BRKAGE=1801"   1 "陈旧"
run "🔴 陈旧 ENGAGED 6 小时 ⇒ 出声" "WD=1 MINER=0 HB=30000 BRAKE=yes BRKAGE=21600" 1 "陈旧"
run "标记来自未来 ⇒ 出声"          "WD=1 MINER=0 HB=30000 BRAKE=yes BRKAGE=-600"   1 "未来"
run "年龄读不出(readfail) ⇒ 出声"  "WD=1 MINER=0 HB=30000 BRAKE=yes BRKAGE=readfail" 1 "读不出"
run "年龄字段缺失 ⇒ 出声"          "WD=1 MINER=0 HB=30000 BRAKE=yes"               1 "读不出"
run "年龄非整数(1-2) ⇒ 出声"       "WD=1 MINER=0 HB=30000 BRAKE=yes BRKAGE=1-2"    1 "读不出"
run "矿机正常时年龄陈旧无所谓"     "WD=1 MINER=1 HB=30000 BRAKE=yes BRKAGE=99999"  0 ""
# ── 第三个终态: PULSE BUDGET EXHAUSTED(watchdog 源码 :983, 我先前没建模) ──────
# 🔴 它蕴含「还 braked 着」, 但结论与普通刹车【相反】: 永不豁免, 且与年龄无关 ——
#    watchdog 自己判定"打不出去了, 矿机停着等操作员"。这是最需要人的那个状态。
# 🔴 而它必须有【自己的措辞】: 落进"标记陈旧"那句会把人指向"刹车状态不可信",
#    而真相是"预算耗尽在等人"。归错因的告警让人去修错的东西。
run "预算耗尽 ⇒ 出声且措辞独有"     "WD=1 MINER=0 HB=30000 BRAKE=halted BRKAGE=30"    1 "脉冲预算耗尽"
run "预算耗尽 + 年龄很大仍出声"     "WD=1 MINER=0 HB=30000 BRAKE=halted BRKAGE=99999" 1 "脉冲预算耗尽"
run "预算耗尽 + 年龄读不出仍出声"   "WD=1 MINER=0 HB=30000 BRAKE=halted"              1 "脉冲预算耗尽"
run "预算耗尽不能被说成标记陈旧"    "WD=1 MINER=0 HB=30000 BRAKE=halted BRKAGE=99999" 1 "等操作员"
run "矿机在跑时 halted 不出声"      "WD=1 MINER=1 HB=30000 BRAKE=halted BRKAGE=30"    0 ""
# ssh 取不到 ⇒ rc 2, 与故障分开
run "ssh unreachable"             "UNREACHABLE:Command failed" 2 "取不到"
run "garbage line"                "hello"                      2 "取不到"

echo ""
echo "result: $pass PASS / $fail FAIL"
[ "$fail" = "0" ] || exit 1
