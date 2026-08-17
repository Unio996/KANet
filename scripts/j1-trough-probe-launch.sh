#!/bin/sh
# J1 trough 探针启动器 — Codex MSG-235 条目 B: 把执行绑定到被审的不可变对象
# 校验: ①仪器与发送器两路径工作树干净(无未提交改动) ②仪器 git blob == 本文件钉定值
# 通过后注入执行身份 env 交仪器自验(仪器内还有 self-sha256 与发送器 sha256 双闸)。
# 用法: bash scripts/j1-trough-probe-launch.sh [TIME_CAP_MIN<=360] [DRYRUN]
cd /d/kanet/kanet || exit 1
PINNED_INSTRUMENT_BLOB=aad437e930e20cdca9fe890ba6abcf289a72e7ae
PINNED_INSTRUMENT_SHA=c8d60adc8ebea09dd72dce57262878b9e5b77f5f2d609769b93fffc4fb325047
DIRTY=$(git status --porcelain scripts/j1-trough-probe-instrument.mjs scripts/probe-deps/j1-send-one.sh)
if [ -n "$DIRTY" ]; then echo "LAUNCH-REFUSED: 仪器/发送器路径工作树不干净:"; echo "$DIRTY"; exit 1; fi
ACTUAL_BLOB=$(git hash-object scripts/j1-trough-probe-instrument.mjs)
if [ "$ACTUAL_BLOB" != "$PINNED_INSTRUMENT_BLOB" ]; then echo "LAUNCH-REFUSED: 仪器 blob 不符 pinned=$PINNED_INSTRUMENT_BLOB actual=$ACTUAL_BLOB"; exit 1; fi
export J1_PROBE_EXPECTED_SELF_SHA=$PINNED_INSTRUMENT_SHA
export J1_PROBE_SOURCE_COMMIT=$(git rev-parse HEAD)
export J1_PROBE_INSTRUMENT_BLOB=$ACTUAL_BLOB
export J1_PROBE_TREE_CLEAN=clean-exact
exec node scripts/j1-trough-probe-instrument.mjs "$@"
