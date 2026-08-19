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
# 🔴🔴 退码必须分档, 而这一版是被 Codex 2026-08-10 判 RED 打出来的:
#    上一版**检测到发送失败、打印了 ALERT-SEND-FAILED, 然后照样 `exit 0`** ——
#    「A human who later reads the log can distinguish them, but the supervisory chain cannot.」
#    ⇒ 我在**同一个文件的头注释里**写着"送不出去与没有故障读数相同, 必须留痕",
#      然后把唯一能被机器读到的那个信号(退码)抹平了。
#    🔨 判据: **留痕给人看 ≠ 让机器可判。** 而这套东西存在的全部理由, 就是消灭"没人读日志"这个终态
#       —— 那就不能把终态又押回一行日志上。
#
# 退码:
#   0 = 已送出        3 = 被限流(此前已成功送过一条, 非致命)
#   1 = 送不出去(构造/传输/应答校验失败) —— **发现了故障却没能告诉任何人**
#   2 = 没有内容可发
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
  exit 3
fi

TS=$(date -u +%FT%TZ)
PAYLOAD=${TEMP:-/tmp}/kanet-j1-watchdog-alert-payload.json
PAYLOAD=$(printf '%s' "$PAYLOAD" | tr '\\' '/')

# 🔴 消息文本【不经 shell 拼接】—— 用 node 构 JSON。
#    在册事故(2026-07-25): 频道消息里的反引号在 shell 里会被当命令替换真执行。
J1_A_TS="$TS" J1_A_RC="$RC" J1_A_BODY="$BODY" J1_A_OUT="$PAYLOAD" J1_A_RELAY="$RELAY" node -e '
const fs = require("fs");
const body = process.env.J1_A_BODY || "";
// rc=0 = 基线心跳(非告警), 头与脚注都不该穿告警的衣服 —— 恒红的头会稀释真告警(同 (566) 那个病)。
const isAlert = process.env.J1_A_RC !== "0";
const head = isAlert
  ? "【🔴 自动告警 · 刹车那台 watchdog 哨兵】"
  : "【ℹ️ 哨兵心跳 · 刹车那台】";
const msg = [
  head + process.env.J1_A_TS,
  "",
  "rc=" + process.env.J1_A_RC,
  body,
  "",
  "■ 这条由计划任务自动发出(告警限流: 每小时最多一条; 心跳: 每日一条), 不是人在敲。",
  ...(isAlert ? ["■ 它只说【哨兵读到了什么】, 不代表矿机一定停了 —— rc=2 是「读不到」, 与「它没了」不同。"] : []),
  "■ 复核: scripts/j1-watchdog-sentinel-task.ps1 -Verify",
].join("\n");
fs.writeFileSync(process.env.J1_A_OUT, JSON.stringify({
  relayId: process.env.J1_A_RELAY, channel: "dev-coord-testnet", message: msg,
}), "utf8");
' || { echo "ALERT-BUILD-FAILED 构造 payload 失败"; exit 1; }

if [ "${J1_ALERT_DRYRUN:-}" = "1" ]; then
  echo "ALERT-DRYRUN 已构造 payload, 未发送: $PAYLOAD"
  printf '%s' "$NOW" > "$STATE"
  exit 0
fi
[ -z "$BASE" ] && { echo "ALERT-SEND-FAILED 没有 console 地址"; exit 1; }

out=$(curl -s -m 30 -X POST "$BASE/api/chat/send" -H 'Content-Type: application/json' \
      --data-binary @"$PAYLOAD" 2>&1)
crc=$?

# 🔴 应答校验按【定义】判成功, 不按"看起来像": 必须同时拿到成功标记【和】一个像样的 txid。
#    只认 `txId` 三个字母会把 `{"error":"...txId required"}` 判成成功 —— 错误文案里也会出现它。
# 🔴 这里【不再】先看 curl 退码。原先有一层 `if [ "$crc" -eq 0 ]`, 变异测试证明它是**冗余的**:
#    把它拆掉, 全部用例照样绿 —— 因为 curl 失败时 $out 是错误文本, 过不了下面的应答校验。
#    ⇒ **冗余 + 没有任何用例守得住它 = 负债**(它会让人以为多了一道防线)。curl_rc 仍打进日志当诊断。
ok=0
if true; then
  J1_A_RESP="$out" node -e '
    const s = process.env.J1_A_RESP || "";
    let j; try { j = JSON.parse(s) } catch { process.exit(1) }      // 不是合法 JSON ⇒ 不算成功
    const okFlag = j.ok === true || j.success === true;
    const tx = j.txId || j.tx_hash || j.txid;
    process.exit(okFlag && typeof tx === "string" && /^[0-9a-f]{64}$/.test(tx) ? 0 : 1);
  ' 2>/dev/null && ok=1
fi

if [ "$ok" -eq 1 ]; then
  printf '%s' "$NOW" > "$STATE"
  echo "ALERT-SENT $(printf '%s' "$out" | cut -c1-120)"
  exit 0
fi

# 🔴 不写 STATE: 没发出去就不该占用限流额度, 否则一次失败会顺带吃掉下一小时。
# 🔴 且必须【非零退出】: 这是"发现了故障却没能告诉任何人"——本链最危险的一个状态,
#    它不能只活在一行日志里(Codex 2026-08-10)。
echo "ALERT-SEND-FAILED curl_rc=${crc} $(printf '%s' "$out" | cut -c1-160)"
exit 1
