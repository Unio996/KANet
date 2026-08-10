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
# 🔴 `grep -c` 无匹配时退码非零 ⇒ `|| echo 0` 会【再追加一个 0】, 得到两行 "0\n0"。
#    注入回归那次的失败输出 got[0\n0] 就是它 —— 计数为 0 恰恰是最需要读准的那种时候,
#    而它偏偏在那时坏掉。改成始终数行, 不靠 grep 的退码。
sent_count()   { grep 'ALERT-SENT' "$LOG" 2>/dev/null | wc -l | tr -d ' '; }
throttle_count() { grep 'ALERT-THROTTLED' "$LOG" 2>/dev/null | wc -l | tr -d ' '; }

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
chk "console 仍挂 (T+7201): 继续失败"  "$(cycle $((T0+7201)))" "1"

# 🔴🔴 这一格是 Codex 2026-08-10 打回来的, 而**打的是用例名字在说谎**:
#    上一版最后一格叫「console 恢复窗内…立刻再试」, 而我 kill 了假 console 之后**从没重启它** ——
#    它跑在一个死 console 上、期望 rc=1 ⇒ 它证的是"还在失败", 不是"恢复后立刻重试"。
#    🔴 他点出为什么这不只是措辞: **若有回归在发送失败时写了限流状态, 这一格照样绿**,
#       因为死 console 两种情况都失败。承重的那条性质(失败不占额度)**根本没被测到**。
#    🔨 在册判据: **用例名字必须是【红的那条】** —— 名字写着守什么, 删掉那个守卫时就得它自己红。
#    ⇒ 真把 console 起回来, 断言"立刻送出", 而**不是被限流**。
node "$SELF_DIR/j1-fake-console.mjs" "$PORT" \
  '{"ok":true,"txId":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}' \
  > /tmp/j1mc-console2.out 2>&1 &
FPID=$!
i=0; while [ $i -lt 50 ]; do grep -q READY /tmp/j1mc-console2.out 2>/dev/null && break; i=$((i+1)); sleep 0.2; done

# T+7202 距上次【成功】送出(T+3600)已 3602s > 3600s —— 但这一格要证的不是"窗口过了",
# 而是**失败那两次没有把额度吃掉**: 若失败时写了 STATE(T+7200/7201), 窗口就会被推到 T+10800,
# 这里就会变成 ALERT-THROTTLED 而不是送出 ⇒ 那个回归会在这里【红】。
chk "console 恢复 (T+7202): cron 退码"    "$(cycle $((T0+7202)))" "0"
chk "console 恢复: .alive alert=0(送出)"  "$(alive_alert)"        "0"
chk "console 恢复: 累计 3 条(立刻补喊)"   "$(sent_count)"         "3"
chk "console 恢复: 不是被限流(限流数不变)" "$(throttle_count)" "3"
rm -f /tmp/j1mc-console2.out

echo ""
echo "result: $pass PASS / $fail FAIL"
[ "$fail" = "0" ] || exit 1
