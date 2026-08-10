#!/bin/sh
# j1-watchdog-alert.sh 的用例。全部跑 DRYRUN, 不发真消息。
#
# 🔴 限流是承重逻辑, 不是优化: 故障常持续数小时, 5 分钟一条会把频道刷爆,
#    而【被刷爆的频道 = 没人看的频道】—— 那就绕回"没有告警"。
# 🔴 两个方向都要测, 它们的失败后果相反:
#    · 该发不发(状态文件坏了→永久静音) 比 · 不该发也发(吵) 严重得多
#    ⇒ 读不懂的状态一律【倾向于发】。
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || SELF_DIR=.
S=${J1_ALERT_UNDER_TEST:-$SELF_DIR/j1-watchdog-alert.sh}
ST=$(mktemp -t j1alert.XXXXXX)
NOW=1786000000
pass=0; fail=0

run() { # name  state_content  now  expect_kw
  if [ "$2" = "__none__" ]; then rm -f "$ST"; else printf '%s' "$2" > "$ST"; fi
  out=$(J1_ALERT_DRYRUN=1 J1_ALERT_STATE="$ST" J1_ALERT_NOW="$3" \
        sh "$S" "🔴 测试用响声" 1 2>&1)
  case "$out" in *"$4"*) pass=$((pass+1)); printf '[PASS] %-34s %s\n' "$1" "$out" ;;
                 *) fail=$((fail+1)); printf '[FAIL] %-34s want[%s] got[%s]\n' "$1" "$4" "$out" ;;
  esac
}

echo "--- j1-watchdog-alert.sh ---"
run "从没发过 ⇒ 发"              "__none__"      "$NOW"              "ALERT-DRYRUN"
run "刚发过 60s ⇒ 限流"          "1785999940"    "$NOW"              "ALERT-THROTTLED"
run "3599s 前 ⇒ 仍限流"          "1785996401"    "$NOW"              "ALERT-THROTTLED"
run "3600s 前 ⇒ 放行(边界)"      "1785996400"    "$NOW"              "ALERT-DRYRUN"
run "3601s 前 ⇒ 放行"            "1785996399"    "$NOW"              "ALERT-DRYRUN"
# 🔴 状态文件坏掉的方向: 必须【倾向于发】, 否则一个坏文件永久静音告警
run "状态文件是乱码 ⇒ 发"        "hello"         "$NOW"              "ALERT-DRYRUN"
run "状态文件为空 ⇒ 发"          ""              "$NOW"              "ALERT-DRYRUN"
run "状态文件是负数 ⇒ 发"        "-5"            "$NOW"              "ALERT-DRYRUN"
# 时钟倒退: 上次时间在未来 ⇒ age 为负 ⇒ 不许因此静音
run "上次时间在未来 ⇒ 发"        "1786009999"    "$NOW"              "ALERT-DRYRUN"
# 没内容不发
out=$(J1_ALERT_DRYRUN=1 J1_ALERT_STATE="$ST" sh "$S" "" 1 2>&1)
case "$out" in *ALERT-SKIP*) pass=$((pass+1)); printf '[PASS] %-34s %s\n' "空内容 ⇒ 不发" "$out" ;;
               *) fail=$((fail+1)); printf '[FAIL] %-34s got[%s]\n' "空内容 ⇒ 不发" "$out" ;;
esac
# payload 里必须真的带上响声原文, 且是合法 JSON
rm -f "$ST"
J1_ALERT_DRYRUN=1 J1_ALERT_STATE="$ST" sh "$S" "🔴 心跳陈旧 999ms" 2 >/dev/null 2>&1
P="${TEMP:-/tmp}/kanet-j1-watchdog-alert-payload.json"; P=$(printf '%s' "$P" | tr '\\' '/')
# 🔴 断言用【整行相等】不是 includes —— 今晚第二次栽在"断言串在别处也出现":
#    正文里那句说明「rc=2 是「读不到」」本身就含 `rc=2`, 于是把 rc 字段整个删掉, 用例照样绿。
#    (第一次是 -Verify 那边的 `Disabled` 命中了兜底分支的输出。)
if node -e "
const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).message;
const lines=m.split('\n');
const hasRcLine   = lines.some(l => l.trim() === 'rc=2');
const hasBodyLine = lines.some(l => l.trim() === '🔴 心跳陈旧 999ms');
process.exit(hasRcLine && hasBodyLine && m.includes('自动告警') ? 0 : 1);
" "$P" 2>/dev/null; then
  pass=$((pass+1)); echo "[PASS] payload 合法 JSON 且含响声原文+rc"
else
  fail=$((fail+1)); echo "[FAIL] payload 缺响声原文/rc, 或不是合法 JSON"
fi

rm -f "$ST"
echo ""
echo "result: $pass PASS / $fail FAIL"
[ "$fail" = "0" ] || exit 1
