#!/bin/sh
# J1 trough 探针启动器 v1.5 — 执行绑定(Codex B) + host profile 钉定注入(J2-tn host, ledger (443) 裁)
# 校验: ①两源路径工作树干净 ②仪器 blob==钉定 ③J1_PROBE_RELAY_ID 必给且前缀==102cbb99(J2-tn)
# 安全承重=下方钉死的完整 SENDER_ADDR(行绑定用); relayId 是传输寻址, 错值只会导致 sender 不符=零 credit。
# 用法(J2 在其检出根): J1_PROBE_RELAY_ID=<J2-tn 完整 relayId> bash scripts/j1-trough-probe-launch.sh [TIME_CAP<=360] [DRYRUN]
cd "$(dirname "$0")/.." || exit 1
PINNED_INSTRUMENT_BLOB=2774e6ca6fa4502047a9633b1f946f5a9e1f2901
PINNED_INSTRUMENT_SHA=84c7fe9b4858d4100acc62a9d3697119780bf50f06fb5daea1c6232997af25ad
DIRTY=$(git status --porcelain scripts/j1-trough-probe-instrument.mjs scripts/probe-deps/j1-send-one.sh kasia-console/src/lib/j1-probe-binding.mjs)
if [ -n "$DIRTY" ]; then echo "LAUNCH-REFUSED: 源路径工作树不干净:"; echo "$DIRTY"; exit 1; fi
ACTUAL_BLOB=$(git hash-object scripts/j1-trough-probe-instrument.mjs)
if [ "$ACTUAL_BLOB" != "$PINNED_INSTRUMENT_BLOB" ]; then echo "LAUNCH-REFUSED: 仪器 blob 不符 pinned=$PINNED_INSTRUMENT_BLOB actual=$ACTUAL_BLOB"; exit 1; fi
case "$J1_PROBE_RELAY_ID" in
  102cbb99*) : ;;
  *) echo "LAUNCH-REFUSED: J1_PROBE_RELAY_ID 缺失或前缀非 102cbb99(J2-tn)。J2 在其机器上供给完整 relayId。"; exit 1 ;;
esac
export J1_PROBE_EXPECTED_SELF_SHA=$PINNED_INSTRUMENT_SHA
export J1_PROBE_SOURCE_COMMIT=$(git rev-parse HEAD)
export J1_PROBE_INSTRUMENT_BLOB=$ACTUAL_BLOB
export J1_PROBE_TREE_CLEAN=clean-exact
# ── host profile(J2-tn, (443) 裁; 值钉死非自由参数) ──
export J1_PROBE_SENDER_ADDR='kaspatest:qzcpypywd2zjgx333qkr66dh6jfguyjkscy7wxqtqqvq5hchkpstg8t9gqk3v'
export J1_PROBE_NODE1_ID='local-J2-machine-ws://127.0.0.1:17210-testnet-12'
export J1_PROBE_NODE2_ID='J1-laptop-observer-100.111.126.10:17210'
export J1_PROBE_NODE2_URL='ws://100.111.126.10:17210'
exec node scripts/j1-trough-probe-instrument.mjs "$@"
