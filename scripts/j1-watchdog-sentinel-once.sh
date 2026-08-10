#!/bin/sh
# 刹车那台 watchdog 的一次【判定】。正常静默; 异常出声并以非零退码收场。
#
# 🔴 它与 j1-watchdog-alive-probe.mjs 的分工必须说死(Codex 2026-08-10 打中的就是这一格):
#      probe    = 取读数, 只报 WD=/MINER=/HB=, 【不做】任何安全判定
#      本文件   = 判读数, 是【执行层】—— 判据在这里, 退码也在这里
#    他当时的原话: 那个 reporter 的注释描述了一个它自己不执行的安全决定, 而仓库里【没有】
#    任何消费它、执行该判据的东西。他没看错: 当时这支脚本还没入库, 判定逻辑只活在一条
#    Monitor 单行里(仓外) ⇒ 从仓库看就是一个报数器配一段吹牛的注释。
#    🔨 判据: **执行层不入库, 等于没有执行层** —— 说明书不是闸。
#
# 🔴 为什么是脚本文件而不是 Monitor 单行: 同一天我把它写成单行, 多了一个 fi, Monitor 启动即失败,
#    而我【先停了旧哨兵】⇒ 有一段时间根本没有哨兵在岗。
#    🔨 换岗顺序也记一条: **先起新的、确认在跑、再停旧的。**
#
# 退码(供非 Monitor 的调用方用; Monitor 靠 stdout):
#   0 = 正常  ·  1 = 故障(实例数/矿机数/心跳)  ·  2 = 取不到(链路)
#
# 阈值推导(不是拍的): 最坏一轮 ≈ poll 30s + Get-Health ~9.5s + 刹车时(脉冲 20s + 结算 1.5s
#   + Get-DaaNow ~9.5s) ≈ 70s ⇒ 上界 300s 约 4 倍余量。
# 🔴 两端都断言: 未来时间戳同样不新鲜 —— age 为负【不】大于上界, 只查上界会把时钟跳变读成健康。
HB_MAX=300000
HB_MIN=-60000

# J1_WD_TEST_LINE: 【仅供用例】直接注入一行读数, 跳过真实探针。
# 这样"判读数"这一半可以被穷尽测试, 而不需要一台真机器 —— 也不需要为了测它去制造真故障。
if [ -n "$J1_WD_TEST_LINE" ]; then
  OUT="$J1_WD_TEST_LINE"
else
  OUT=$(node /d/kanet/kanet/scripts/j1-watchdog-alive-probe.mjs 2>/dev/null)
fi

case "$OUT" in
  WD=*) ;;
  *)
    echo "⚠ watchdog 存活检查取不到: ${OUT:-空输出} — 这【不等于】它没了, 也不等于它在, 去人工看一眼"
    exit 2
    ;;
esac

WD=$(echo "$OUT" | sed -n 's/.*WD=\([0-9]*\).*/\1/p')
MN=$(echo "$OUT" | sed -n 's/.*MINER=\([0-9]*\).*/\1/p')
HB=$(echo "$OUT" | sed -n 's/.*HB=\(.*\)$/\1/p')

if [ "$WD" != "1" ]; then
  echo "🔴 刹车那台 watchdog 实例数=$WD (应为 1) · MINER=$MN — 矿机可能正在无人监管"
  exit 1
fi
if [ "$MN" != "1" ]; then
  echo "🔴 watchdog 在但矿机数=$MN (应为 1) — 若此刻不在刹车中, 这是异常"
  exit 1
fi

# 心跳必须是一个【整数】。非整数(none/bad/空/乱码)一律判故障, 不许当成"大概没事"。
case "$HB" in
  ''|*[!0-9-]*|-|'-')
    echo "🔴 进程在但【心跳不可用】(HB=${HB:-空}) — 进程在不等于循环在转"
    exit 1
    ;;
esac

if [ "$HB" -gt "$HB_MAX" ]; then
  echo "🔴 进程在但【心跳陈旧】: ${HB}ms > ${HB_MAX}ms — 循环可能卡死, 而进程数看起来一切正常"
  exit 1
fi
if [ "$HB" -lt "$HB_MIN" ]; then
  echo "🔴 心跳来自【未来】: ${HB}ms < ${HB_MIN}ms — 时钟跳变/状态文件被搬动, 这个读数不可信"
  exit 1
fi
exit 0
