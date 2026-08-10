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

if [ "$rc" -ne 0 ]; then
  printf '[%s] rc=%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc" "$out" >> "$LOG"
fi

# 🔴 心跳行: **不管响没响都写一行到 .alive**, 每次覆盖。
#    没有它, "日志为空"就有两种读法(一直健康 / 根本没在跑), 而它们导出的动作相反。
#    这正是本哨兵守着刹车那台时用的同一招 —— 我差点没给守卫自己配一个。
printf '%s rc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$rc" > "$LOG.alive"
exit 0
