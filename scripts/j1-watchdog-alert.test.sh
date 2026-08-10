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

# ── 传输失败必须【非零退出】(Codex 2026-08-10 判 RED 的那格) ────────────────
# 🔴 上一版检测到失败、打印了 ALERT-SEND-FAILED, 然后照样 exit 0
#    ⇒ 人能从日志分辨, **而监督链分辨不了**。这几格守的就是那个退码。
# 🔴 这里【真的去连】不存在的端口/真的起一个假 console, 不注入返回值 ——
#    假体替被测代码准备好答案, 会挡掉整类真实失败(在册那条)。
tr_run() { # name  base  expect_rc  expect_kw
  rm -f "$ST"
  out=$(J1_ALERT_STATE="$ST" J1_ALERT_BASE="$2" sh "$S" "🔴 传输测试" 1 2>&1); rc=$?
  ok=1; [ "$rc" != "$3" ] && ok=0
  case "$out" in *"$4"*) ;; *) ok=0 ;; esac
  if [ "$ok" = "1" ]; then pass=$((pass+1)); printf '[PASS] %-34s rc=%s\n' "$1" "$rc"
  else fail=$((fail+1)); printf '[FAIL] %-34s rc=%s(want %s) out=%s\n' "$1" "$rc" "$3" "$out"; fi
  # 🔴 失败不许占用限流额度 —— 否则一次失败会顺带吃掉下一小时
  if [ "$3" != "0" ] && [ -s "$ST" ]; then
    fail=$((fail+1)); printf '[FAIL] %-34s 失败却写了限流状态\n' "$1(限流额度)"
  else
    pass=$((pass+1)); printf '[PASS] %-34s 失败未占用限流额度\n' "$1(限流额度)"
  fi
}

echo "--- 传输层(真连, 不注入) ---"
tr_run "连接被拒(没有服务在听)" "http://127.0.0.1:59999" 1 "ALERT-SEND-FAILED"
tr_run "地址不可路由(超时/拒绝)" "http://127.0.0.1:59998" 1 "ALERT-SEND-FAILED"

# 起假 console 回不同的坏应答。
# 🔴 不用 nc: 本机 Git Bash 没有它, 而当时那 4 格被 SKIP —— **"没测"当时长得跟"通过"很像**,
#    靠我在输出里写死那句"这不是通过, 是没测"才没混过去。现在改用 node, 无外部依赖。
FAKE_PIDS=''
fake() { # port  body
  node "$SELF_DIR/j1-fake-console.mjs" "$1" "$2" > /tmp/fakeconsole.$1.out 2>&1 &
  FAKE_PIDS="$FAKE_PIDS $!"
  # 等它自己说 READY, 不靠 sleep 猜 —— 猜短了会把"还没起来"测成"连接被拒"
  i=0; while [ $i -lt 50 ]; do
    grep -q READY /tmp/fakeconsole.$1.out 2>/dev/null && return 0
    i=$((i+1)); sleep 0.2
  done
  echo "[WARN] 假 console :$1 未就绪"
}
cleanup_fakes() { for p in $FAKE_PIDS; do kill "$p" 2>/dev/null; done; rm -f /tmp/fakeconsole.*.out; }
trap cleanup_fakes EXIT
if command -v node >/dev/null 2>&1; then
  fake 59001 '{"error":"missing txId"}'
  tr_run "HTTP 200 但正文是错误(含 txId 字样)" "http://127.0.0.1:59001" 1 "ALERT-SEND-FAILED"
  fake 59002 'not json at all'
  tr_run "应答不是合法 JSON"                    "http://127.0.0.1:59002" 1 "ALERT-SEND-FAILED"
  fake 59003 '{"ok":true,"txId":"短的不是64位"}'
  tr_run "ok=true 但 txid 不成形"               "http://127.0.0.1:59003" 1 "ALERT-SEND-FAILED"
  fake 59004 '{"ok":true,"txId":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}'
  rm -f "$ST"
  out=$(J1_ALERT_STATE="$ST" J1_ALERT_BASE="http://127.0.0.1:59004" sh "$S" "🔴 传输测试" 1 2>&1); rc=$?
  case "$out$rc" in *ALERT-SENT*0) pass=$((pass+1)); printf '[PASS] %-34s rc=0\n' "合法成功应答 ⇒ rc=0" ;;
                    *) fail=$((fail+1)); printf '[FAIL] %-34s rc=%s out=%s\n' "合法成功应答 ⇒ rc=0" "$rc" "$out" ;;
  esac
  if [ -s "$ST" ]; then pass=$((pass+1)); echo "[PASS] 成功后写了限流状态"
  else fail=$((fail+1)); echo "[FAIL] 成功后没写限流状态(下一条不会被限流)"; fi
  # 成功之后紧接着再来一条 ⇒ 必须被限流, 且退码 3(可分辨, 非致命)
  out=$(J1_ALERT_STATE="$ST" J1_ALERT_BASE="http://127.0.0.1:59004" sh "$S" "🔴 再来一条" 1 2>&1); rc=$?
  case "$out$rc" in *ALERT-THROTTLED*3) pass=$((pass+1)); echo "[PASS] 成功后再发 ⇒ 限流 rc=3(可分辨)" ;;
                    *) fail=$((fail+1)); printf '[FAIL] 成功后再发 ⇒ 限流 rc=3  rc=%s out=%s\n' "$rc" "$out" ;;
  esac
else
  echo "[SKIP] 无 node, 跳过假 console 那几格 —— 🔴 这不是通过, 是【没测】"
fi

# 🔴 构造 payload 失败也必须非零: 把输出目录指到一个不存在的地方, 让 node 真的写不下去。
rm -f "$ST"
out=$(J1_ALERT_STATE="$ST" TEMP="/nonexistent-dir-for-test" sh "$S" "🔴 构造测试" 1 2>&1); rc=$?
case "$out$rc" in *ALERT-BUILD-FAILED*1) pass=$((pass+1)); echo "[PASS] 构造 payload 失败 ⇒ rc=1" ;;
                  *) fail=$((fail+1)); printf "[FAIL] 构造失败应 rc=1  rc=%s out=%s
" "$rc" "$out" ;;
esac

rm -f "$ST"
echo ""
echo "result: $pass PASS / $fail FAIL"
[ "$fail" = "0" ] || exit 1
