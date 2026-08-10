#!/bin/sh
# 哨兵【常驻健康】的判定层。判的不是"任务注册了没有", 是"它最近一次【真的跑成了没有】"。
#
# 🔴 存在理由(Codex 2026-08-10 复审, 判 -Verify RED/MUST-FIX):
#    「a task that is repeatedly executing but whose sentinel is continuously rc=2 UNREACHABLE
#      can still make -Verify succeed. LastTaskResult=0 is expected in that case because the
#      wrapper intentionally swallows the sentinel rc.」
#    ⇒ 原 -Verify 验的是**注册态**, 不是**功能态**。而包装层故意 `exit 0`(免得任务被标失败),
#      于是 `LastTaskResult=0` 什么也不证明。
#    🔴🔴 **最难看的一格**: `.alive` 戳是我【专门为了"日志为空有两种读法"】加的,
#      然后我**没有把它接进闸**。装了仪器、没接线 —— 仪器只有被判据读到才算数。
#
# 🔴 判据两端都断言(同哨兵那条): 陈旧要拦, **未来时间戳同样要拦** ——
#    时钟跳变/文件被搬动都会产出它, 而"太新"不会大于上界。
#
# 取读数与判读数分离(同 j1-watchdog-sentinel-once.sh): 本文件只判, 输入由调用方喂。
#   J1_HV_TASK_STATE  absent | Ready | Running | Disabled
#   J1_HV_LAST_RESULT 计划任务上次退码(整数; 空 = 未知/从未运行)
#   J1_HV_ALIVE       .alive 记录原文(空 = 文件不存在)
#   J1_HV_NOW         epoch 秒(仅用例注入; 缺省取当前)
#   J1_HV_INTERVAL    调度间隔分钟(缺省 5) ⇒ 新鲜度上界 = 2*间隔 + 120s
#
# 退码: 0 = 在岗且功能正常 · 1 = 在岗但功能不正常 · 2 = 没在岗/装置态不对
# 🔴🔴 新鲜度窗口的【出处】必须验, 不只验它的值(Codex 2026-08-10 判 RED, fail-open 权限错位):
#    原先 `INTERVAL=${J1_HV_INTERVAL:-5}` —— 这把尺由【调用方】给。他给的反例:
#      任务真实装在 5 分钟档 · .alive 已 1000 秒(按 720 秒上界必须判陈旧)
#      · 运维跑 `-Verify -IntervalMinutes 1000` ⇒ 上界变 120120 秒 ⇒ **同一条陈旧记录被放行**。
#    🔨 判据: **判「活没活」的那把尺, 必须绑在【被验的那个调度】上, 不能谁调它谁给。**
#       否则这个闸可以被"调用它的人"独立放宽, 而放宽不留痕。
#    ⇒ 生产路径要求 J1_HV_INTERVAL_SRC=trigger(由安装单元从【已注册的触发器】读出);
#      测试要用别的值, 必须**显式声明这是测试**并且**结论不算生产判词**。
INTERVAL=${J1_HV_INTERVAL:-5}
SRC=${J1_HV_INTERVAL_SRC:-}
BANNER=''

case "$SRC" in
  trigger) ;;
  test)
    if [ "${J1_HV_UNSAFE_TEST:-}" != "1" ]; then
      echo "🔴 间隔来源标为 test 但没有显式认领: 需 J1_HV_UNSAFE_TEST=1 — 测试值不许悄悄放宽生产新鲜度"
      exit 2
    fi
    BANNER='⚠ 本次用的是【测试间隔】, 不是从已注册触发器读出的 —— 本结论不是生产判词。' ;;
  '')
    echo "🔴 间隔来源未声明(J1_HV_INTERVAL_SRC) — 拒绝用来源不明的尺去判新鲜度"
    exit 2 ;;
  *)
    echo "🔴 间隔来源不认识: ${SRC} — 不认识的来源一律不放行"
    exit 2 ;;
esac

# 间隔本身也要验域: 非整数 / 0 / 负 / 超大 都不许进算式(超大 = 把上界撑到永不陈旧)。
n=$INTERVAL
case "$n" in -*) n=${n#-} ;; esac
case "$n" in
  ''|*[!0-9]*)
    echo "🔴 间隔不是整数: [${INTERVAL}] — 读不懂的值不当成好消息"
    exit 2 ;;
esac
if [ "$INTERVAL" -lt 1 ] || [ "$INTERVAL" -gt 1440 ]; then
  echo "🔴 间隔越界: ${INTERVAL} 分钟 (允许 1..1440) — 越界值会把新鲜度上界撑成永不陈旧"
  exit 2
fi
[ -n "$BANNER" ] && echo "$BANNER"

MAX_AGE=$(( INTERVAL * 60 * 2 + 120 ))
MIN_AGE=-60
NOW=${J1_HV_NOW:-$(date -u +%s)}

case "${J1_HV_TASK_STATE:-absent}" in
  absent)
    echo "🔴 ARMED=no — 计划任务不存在, 没有任何东西会去调那道闸"
    exit 2 ;;
  Disabled)
    echo "🔴 ARMED=no — 计划任务存在但被 Disabled; 【存在】与【在跑】是两件事"
    exit 2 ;;
  Ready|Running) ;;
  *)
    echo "🔴 计划任务状态无法识别: ${J1_HV_TASK_STATE} — 不认识的状态一律不放行"
    exit 2 ;;
esac

# 🔴 包装层自己失败(语法错/找不到 bash)时, 这个数是唯一露馅处 —— 它对计划任务可见, 对日志不可见。
if [ -n "$J1_HV_LAST_RESULT" ]; then
  n=$J1_HV_LAST_RESULT
  case "$n" in -*) n=${n#-} ;; esac
  case "$n" in
    ''|*[!0-9]*)
      echo "🔴 LastTaskResult 不是整数: ${J1_HV_LAST_RESULT} — 读不懂的值不当成好消息"
      exit 2 ;;
  esac
  # 🔴 契约必须【封闭】: 2026-08-10 我给包装层加了一个**故意的**非零退码(1 = 发现故障但告警送不出去),
  #    而这里旧规则是"非零 = 包装层崩了" ⇒ 它把那个故意的信号读成了崩溃,
  #    并打出"闸根本没被执行到" —— **闸明明跑了**。归错因的告警会把人引向错的修法。
  #    ⇒ 1 是【已定义值】, 交给下面的 alert= 那一支去说清楚; 其余非零才是包装层自己坏了
  #      (历史实例: 2 = 内联 shell 被嵌套双引号截断的语法错误)。
  if [ "$J1_HV_LAST_RESULT" -ne 0 ] && [ "$J1_HV_LAST_RESULT" -ne 1 ]; then
    echo "🔴 包装层本身失败: LastTaskResult=${J1_HV_LAST_RESULT} — 闸根本没被执行到"
    exit 2
  fi
fi

if [ -z "$J1_HV_ALIVE" ]; then
  echo "🔴 注册了但【从未跑成过】: 没有 .alive 记录 — 注册成功不等于跑得通"
  exit 1
fi

# 记录格式钉死: `<ISO8601Z> rc=<整数>[ alert=<整数>]`。用【定义】判, 不用"它通常长什么样"。
# `alert=` 是 2026-08-10 加的一格(Codex 判 RED): 光有 rc 说不出
# **"发现了故障, 但没能告诉任何人"** —— 那是本链最危险的状态, 必须机器可判。
ts=$(printf '%s' "$J1_HV_ALIVE"    | sed -n 's/^\([0-9TZ:-]\{20\}\) rc=.*$/\1/p')
rc=$(printf '%s' "$J1_HV_ALIVE"    | sed -n 's/^[0-9TZ:-]\{20\} rc=\([^ ]*\).*$/\1/p')
arc=$(printf '%s' "$J1_HV_ALIVE"   | sed -n 's/^.* alert=\(.*\)$/\1/p')
if [ -z "$ts" ] || [ -z "$rc" ]; then
  echo "🔴 .alive 记录读不懂: [${J1_HV_ALIVE}] — 格式应为 '<ISO8601Z> rc=<整数>'"
  exit 1
fi
n=$rc
case "$n" in -*) n=${n#-} ;; esac
case "$n" in
  ''|*[!0-9]*)
    echo "🔴 .alive 里的 rc 不是整数: [${rc}] — 读不懂的值不当成好消息"
    exit 1 ;;
esac

epoch=$(date -u -d "$ts" +%s 2>/dev/null)
case "$epoch" in
  ''|*[!0-9]*)
    echo "🔴 .alive 时间戳解析不了: [${ts}]"
    exit 1 ;;
esac
age=$(( NOW - epoch ))

if [ "$age" -gt "$MAX_AGE" ]; then
  echo "🔴 .alive 陈旧: ${age}s > ${MAX_AGE}s — 任务在册, 但它最近【没有真的跑】"
  exit 1
fi
if [ "$age" -lt "$MIN_AGE" ]; then
  echo "🔴 .alive 来自【未来】: ${age}s — 时钟跳变/文件被搬动, 这个读数不可信"
  exit 1
fi
# 🔴 告警链先判, 且【比哨兵 rc 更要紧】: 哨兵报故障还有人能看见, 而告警送不出去
#    意味着**这个故障没有任何人知道** —— 两者都非零时, 要说出的是后面这句。
if [ -n "$arc" ]; then
  n=$arc
  case "$n" in -*) n=${n#-} ;; esac
  case "$n" in
    ''|*[!0-9]*)
      echo "🔴 .alive 里的 alert 不是整数: [${arc}] — 读不懂的值不当成好消息"
      exit 1 ;;
  esac
  if [ "$arc" -ne 0 ] && [ "$arc" -ne 3 ]; then
    echo "🔴🔴 发现了故障, 而【告警没能送出去】(alert=${arc}, 哨兵 rc=${rc}, ${age}s 前) — 这个故障目前【没有任何人知道】"
    exit 1
  fi
fi

if [ "$rc" -ne 0 ]; then
  echo "🔴 在岗但【功能不正常】: 最近一次哨兵 rc=${rc} (${age}s 前) — 它在跑, 而它读不出东西"
  exit 1
fi
exit 0
