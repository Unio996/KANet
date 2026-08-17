#!/bin/sh
# J1 探针三级 pin 链一键重算(J2 (476) 建议: 漏一环下次 run 才发现, 烧一个 trough 窗)。
# 链: sender sha → 仪器 PINNED_SENDER_SHA → 仪器 sha → launcher REF_INSTRUMENT_SHA。
# 改了 sender 或仪器后跑本脚本, 让漏环结构上不可能。跑完 git diff 审 + DRYRUN。
cd "$(dirname "$0")/.." || exit 1
SENDER=scripts/probe-deps/j1-send-one.sh
INST=scripts/j1-trough-probe-instrument.mjs
LAUNCH=scripts/j1-trough-probe-launch.sh
SSHA=$(sha256sum "$SENDER" | cut -d' ' -f1)
# ① sender sha → 仪器常量
sed -i "s/const PINNED_SENDER_SHA = '[0-9a-f]\{64\}'/const PINNED_SENDER_SHA = '$SSHA'/" "$INST"
# ② 仪器 sha(改①后重算) → launcher REF
ISHA=$(sha256sum "$INST" | cut -d' ' -f1)
sed -i "s/^REF_INSTRUMENT_SHA=.*/REF_INSTRUMENT_SHA=$ISHA/" "$LAUNCH"
echo "re-pin 完成:"
echo "  sender sha     = $SSHA"
echo "  仪器 sha       = $ISHA (=launcher REF_INSTRUMENT_SHA)"
echo "  launcher blob  = $(git hash-object "$LAUNCH") (Codex 须重注册此值)"
echo "  仪器 blob      = $(git hash-object "$INST")"
echo "⇒ 现 git diff 审 + 全链 DRYRUN 验 senderSha=OK selfSha=OK 再提交。"
