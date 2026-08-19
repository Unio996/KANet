#!/bin/sh
# 计划任务调用的包装层: 跑一次哨兵, **只在响的时候**留痕。
#
# 🔴 为什么这是一个文件而不是塞进计划任务的 -lc 参数里(今天第三次栽在同一处):
#    ① Monitor 单行版多了一个 `fi` ⇒ 启动即失败, 而我先停了旧哨兵 ⇒ 有一段真空;
#    ② 探针路径写死 /d/... 交给 Windows 的 node ⇒ 解析成 D:\d\...;
#    ③ 本文件的前身: 内联命令里嵌套双引号, 把 -lc 的参数从中间截断 ⇒ bash 语法错误 rc=2。
#    🔴 而③最坏的地方不是它坏了, 是**它坏成了"看起来正常"**:
#       任务注册成功、state=Ready、而日志文件不存在 —— 按本设计"没日志 = 从没响过",
#       与"根本没跑通"在读数上**完全相同**。是 lastResult=2 把它露出来的, 不是日志。
#    🔨 判据: **一次性动作可以写成一行; 带分支的判定必须住进文件, 并且要有人跑过它。**
#
# 🔴 日志不是消费方: 没有人读的日志 = 没有告警。本文件只做到"产生并留痕"。
#    送达那一半(Codex: reach the actual notification/escalation consumer)仍然 OPEN。
SELF_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || SELF_DIR=.
LOG=${J1_WD_SENTINEL_LOG:-${TEMP:-/tmp}/kanet-j1-watchdog-sentinel.log}
LOG=$(printf '%s' "$LOG" | tr '\\' '/')

out=$(sh "$SELF_DIR/j1-watchdog-sentinel-once.sh" 2>&1)
rc=$?

arc=0        # 告警链的退码; 0 = 没出事所以没发, 也算正常
if [ "$rc" -ne 0 ]; then
  printf '[%s] rc=%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc" "$out" >> "$LOG"
  # 🔴 把响声【送到人面前】—— 日志没人读就等于没有告警(Codex 第 ③ 格)。
  a=$(sh "$SELF_DIR/j1-watchdog-alert.sh" "$out" "$rc" 2>&1)
  arc=$?
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$a" >> "$LOG"
fi

# ── 24h 基线心跳((566) 2026-08-19: 告警静默化的补偿)────────────────────────
# 基线告警静默后, 「哨兵死了」与「基线一切正常」在频道读数上相同 ⇒ 每 24h 发一条
# 频道可见的基线心跳, 证明【哨兵+告警链】整条活着。
# 🔴 用独立限流 state(J1_ALERT_STATE 覆盖) —— 不占真告警的小时限流槽, 两者互不压制。
# 🔴 只在 rc=0(基线正常)时发; rc!=0 时真告警本身就是活性证明。发送失败不推进 state=下轮重试, 不改任务退码。
if [ "$rc" -eq 0 ]; then
  HB24=${J1_WD_HB24_STATE:-$LOG.hb24}
  nowsec=$(date -u +%s)
  lasthb=$(cat "$HB24" 2>/dev/null)
  case "$lasthb" in ''|*[!0-9]*) lasthb=0 ;; esac
  if [ $((nowsec - lasthb)) -ge 86400 ]; then
    h=$(J1_ALERT_STATE="$LOG.hb24.limit" sh "$SELF_DIR/j1-watchdog-alert.sh" \
      "ℹ️ 哨兵基线心跳(每日一条): 刹车那台读数=已接受基线((555) watchdog=0·MINER=1), 24h 内无偏离。本条只证明哨兵+告警链活着; 偏离基线会立即单独告警。" "0" 2>&1)
    hrc=$?
    printf '[%s] hb24 rc=%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$hrc" "$h" >> "$LOG"
    if [ "$hrc" -eq 0 ]; then printf '%s' "$nowsec" > "$HB24"; fi
  fi
fi

# 🔴 心跳行: **不管响没响都写一行到 .alive**, 每次覆盖。
#    没有它, "日志为空"就有两种读法(一直健康 / 根本没在跑), 而它们导出的动作相反。
#    这正是本哨兵守着刹车那台时用的同一招 —— 我差点没给守卫自己配一个。
printf '%s rc=%s alert=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc" "$arc" > "$LOG.alive"

# 🔴 退码分两档, 而分界【不是】"有没有故障", 是"**有没有人被告知**":
#    · 故障 + 告警送出/被限流 ⇒ exit 0 —— 已经有人知道了, 不需要计划任务再喊一嗓子;
#    · 故障 + **告警送不出去** ⇒ exit 1 —— 这时 `LastTaskResult` 是**仅剩的那个机器可读信号**。
#    上一版无条件 exit 0, 于是"发现了故障却没能告诉任何人"这个最危险的状态只活在一行日志里
#    (Codex 2026-08-10 判 RED)。🔨 **留痕给人看 ≠ 让机器可判。**
if [ "$arc" -ne 0 ] && [ "$arc" -ne 3 ]; then
  exit 1
fi
exit 0
