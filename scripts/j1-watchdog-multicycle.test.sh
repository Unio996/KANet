#!/bin/sh
# 多周期连续性: **持续故障**下, 第 2..N 个周期的行为。
#
# 🔴 存在理由(Codex 2026-08-10 明说的边界): 首跳送达已有证据, 但
#    「The evidence is intentionally narrower than proving every future repeated/throttled alert」
#    ⇒ 已证的只有**第一条**。而真实故障会持续数小时 —— **第 2..N 个周期才是常态, 第 1 个是特例。**
#
# 🔴 这里不等真实的一小时: 用 J1_ALERT_MIN_SEC 把限流窗压到 2 秒, 测的是**同一套判定逻辑**。
#    时间尺度可以缩, **状态机不能改** —— 缩的是窗口, 不是判据。
# 🔴 用假 console, 不打真频道: 演习不该占用别人的注意力(今晚已经占过一次, 在册)。
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || SELF_DIR=.
CRON=$SELF_DIR/j1-watchdog-sentinel-cron.sh
LOG=$(mktemp -t j1mc.XXXXXX)
ST=$(mktemp -t j1mcst.XXXXXX); rm -f "$ST"
PORT=59105
pass=0; fail=0

node "$SELF_DIR/j1-fake-console.mjs" "$PORT" \
  '{"ok":true,"txId":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}' \
  > /tmp/j1mc-console.out 2>&1 &
FPID=$!
cleanup() { kill "$FPID" 2>/dev/null; rm -f "$LOG" "$LOG.alive" "$ST" /tmp/j1mc-console.out; }
trap cleanup EXIT
i=0; while [ $i -lt 50 ]; do grep -q READY /tmp/j1mc-console.out 2>/dev/null && break; i=$((i+1)); sleep 0.2; done

# 🔴 时间【注入】, 不靠墙上时钟。第一版把限流窗设成 2 秒然后连着跑 —— 而一个周期本身就要
#    接近 1 秒(两次 node 启动 + curl), 周期 2 已经越过窗口 ⇒ **4 格失败, 而代码是对的, 是用例在赛跑**。
#    🔨 判据: **判据里有时间的用例, 时间必须是参数, 不能是"跑得够快就行"** ——
#       否则它在快机器上绿、慢机器上红, 而两种结果都不说明被测代码。
cycle() { # $1 = 注入的"现在"(epoch 秒); 回显 cron 退码
  J1_WD_TEST_LINE="WD=1 MINER=1 HB=3600000" \
  J1_WD_SENTINEL_LOG="$LOG" \
  J1_ALERT_BASE="http://127.0.0.1:$PORT" \
  J1_ALERT_STATE="$ST" \
  J1_ALERT_MIN_SEC=3600 \
  J1_ALERT_NOW="$1" \
  sh "$CRON" >/dev/null 2>&1
  echo $?
}
chk() { # name  actual  expect
  if [ "$2" = "$3" ]; then pass=$((pass+1)); printf '[PASS] %-40s %s\n' "$1" "$2"
  else fail=$((fail+1)); printf '[FAIL] %-40s got[%s] want[%s]\n' "$1" "$2" "$3"; fi
}
alive_alert() { sed -n 's/^.* alert=\(.*\)$/\1/p' "$LOG.alive"; }
sent_count() { grep -c 'ALERT-SENT' "$LOG" 2>/dev/null || echo 0; }

# 时间线(限流窗 3600s): T0 首发 → T0+300/+600/+3599 被限流 → T0+3600 重发
T0=1786000000
echo "--- 多周期(持续故障, 限流窗 3600s, 时间注入) ---"
chk "周期1 (T+0): cron 退码"        "$(cycle $T0)"          "0"
chk "周期1: .alive alert=0(已送出)" "$(alive_alert)"        "0"
chk "周期1: 累计发出 1 条"          "$(sent_count)"         "1"

chk "周期2 (T+300): cron 退码"      "$(cycle $((T0+300)))"  "0"
chk "周期2: .alive alert=3(被限流)" "$(alive_alert)"        "3"
chk "周期2: 仍是 1 条"              "$(sent_count)"         "1"

chk "周期3 (T+600): 仍被限流"       "$(cycle $((T0+600)))"  "0"
chk "周期3: .alive alert=3"         "$(alive_alert)"        "3"

chk "周期N (T+3599): 差 1 秒仍限流"  "$(cycle $((T0+3599)))" "0"
chk "周期N: .alive alert=3"         "$(alive_alert)"        "3"
chk "周期N: 仍是 1 条"              "$(sent_count)"         "1"

# 🔴 最关键的一格: 窗口过去之后**必须再喊一次** ——
#    "一直被限流"与"故障已经没了"在频道上读数完全相同, 而故障还在。
#    持续故障不能喊一次就永远闭嘴, 否则限流从"防刷屏"变成"自动静音"。
chk "窗口过后 (T+3600): 重新发出"   "$(cycle $((T0+3600)))" "0"
chk "窗口过后: .alive alert=0"      "$(alive_alert)"        "0"
chk "窗口过后: 累计 2 条"           "$(sent_count)"         "2"

# 🔴 持续故障中途 console 挂掉 ⇒ 必须从"被限流"翻成"没人知道", 而不是继续静默
kill "$FPID" 2>/dev/null; sleep 1
chk "console 挂掉 (T+7200): cron 退码" "$(cycle $((T0+7200)))" "1"
chk "console 挂掉: .alive alert=1"     "$(alive_alert)"        "1"
chk "console 挂掉: 没有新增送出"       "$(sent_count)"         "2"
# 🔴 而它【不许占用限流额度】—— 否则 console 恢复后还要再哑一小时
chk "console 恢复窗内 (T+7201): 立刻再试" "$(cycle $((T0+7201)))" "1"

echo ""
echo "result: $pass PASS / $fail FAIL"
[ "$fail" = "0" ] || exit 1
