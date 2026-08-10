#!/bin/sh
# 哨兵响了之后, 把响声【送到人面前】—— 发一条到 dev-coord-testnet。
#
# 🔴 存在理由(Codex 2026-08-10 第 ③ 格, 一直 OPEN):
#    「evidence that stale/missing heartbeat causes a nonzero result to reach the actual
#      notification/escalation consumer」
#    在此之前响声只落在本机日志 + `.alive`。**没有人读的日志 = 没有告警。**
#    而唯一在读的消费方(我 session 里的 Monitor)**随会话消失**, 那正是这套东西要消灭的形状。
#
# 🔴 限流是【必需】不是优化: 故障通常持续数小时, 5 分钟一条会把频道刷爆,
#    而**被刷爆的频道 = 没人看的频道** —— 那就绕回"没有告警"了。默认 1 小时最多 1 条。
#
# 🔴 送不出去也要留痕: 若 console 本身挂了(告警链路与被告警系统共享依赖),
#    静默失败与"没有故障"读数相同。⇒ 发送结果一律写回日志。
#
# 用法(由 j1-watchdog-sentinel-cron.sh 在 rc!=0 时调用):
#   sh j1-watchdog-alert.sh "<哨兵输出>" "<rc>"
# 环境:
#   J1_ALERT_RELAY   relayId(默认见下)      J1_ALERT_BASE  console(默认 127.0.0.1:3200)
#   J1_ALERT_MIN_SEC 限流秒数(默认 3600)    J1_ALERT_DRYRUN=1 只打印不发(用例用)
BODY=$1
RC=$2
BASE=${J1_ALERT_BASE:-http://127.0.0.1:3200}
RELAY=${J1_ALERT_RELAY:-e7f51073-6b6c-41ea-b7fe-e82e98531a9a}
MIN=${J1_ALERT_MIN_SEC:-3600}
STATE=${J1_ALERT_STATE:-${TEMP:-/tmp}/kanet-j1-watchdog-alert.last}
STATE=$(printf '%s' "$STATE" | tr '\\' '/')
NOW=${J1_ALERT_NOW:-$(date -u +%s)}

[ -z "$BODY" ] && { echo "ALERT-SKIP 没有内容"; exit 2; }

# ── 限流 ──────────────────────────────────────────────────────────────────
last=$(cat "$STATE" 2>/dev/null)
case "$last" in ''|*[!0-9]*) last=0 ;; esac      # 读不懂的当没发过, 不当成"刚发过"
# 🔴 方向: 读不懂时【倾向于发】。反过来(当成刚发过)会让一个坏掉的状态文件永久静音告警。
age=$(( NOW - last ))
if [ "$last" -ne 0 ] && [ "$age" -lt "$MIN" ] && [ "$age" -ge 0 ]; then
  echo "ALERT-THROTTLED 距上次 ${age}s < ${MIN}s"
  exit 0
fi

TS=$(date -u +%FT%TZ)
PAYLOAD=${TEMP:-/tmp}/kanet-j1-watchdog-alert-payload.json
PAYLOAD=$(printf '%s' "$PAYLOAD" | tr '\\' '/')

# 🔴 消息文本【不经 shell 拼接】—— 用 node 构 JSON。
#    在册事故(2026-07-25): 频道消息里的反引号在 shell 里会被当命令替换真执行。
J1_A_TS="$TS" J1_A_RC="$RC" J1_A_BODY="$BODY" J1_A_OUT="$PAYLOAD" J1_A_RELAY="$RELAY" node -e '
const fs = require("fs");
const body = process.env.J1_A_BODY || "";
const msg = [
  "【🔴 自动告警 · 刹车那台 watchdog 哨兵】" + process.env.J1_A_TS,
  "",
  "rc=" + process.env.J1_A_RC,
  body,
  "",
  "■ 这条由计划任务自动发出(限流: 最多每小时一条), 不是人在敲。",
  "■ 它只说【哨兵读到了什么】, 不代表矿机一定停了 —— rc=2 是「读不到」, 与「它没了」不同。",
  "■ 复核: scripts/j1-watchdog-sentinel-task.ps1 -Verify",
].join("\n");
fs.writeFileSync(process.env.J1_A_OUT, JSON.stringify({
  relayId: process.env.J1_A_RELAY, channel: "dev-coord-testnet", message: msg,
}), "utf8");
' || { echo "ALERT-FAIL 构造 payload 失败"; exit 1; }

if [ "${J1_ALERT_DRYRUN:-}" = "1" ]; then
  echo "ALERT-DRYRUN 已构造 payload, 未发送: $PAYLOAD"
  printf '%s' "$NOW" > "$STATE"
  exit 0
fi

out=$(curl -s -m 30 -X POST "$BASE/api/chat/send" -H 'Content-Type: application/json' \
      --data-binary @"$PAYLOAD" 2>&1)
case "$out" in
  *'"success":true'*|*'"ok":true'*|*txId*|*tx_hash*)
    printf '%s' "$NOW" > "$STATE"
    echo "ALERT-SENT $(printf '%s' "$out" | cut -c1-120)" ;;
  *)
    # 🔴 不写 STATE: 没发出去就不该占用限流额度, 否则下一小时也不会再试。
    echo "ALERT-SEND-FAILED $(printf '%s' "$out" | cut -c1-160)" ;;
esac
exit 0
