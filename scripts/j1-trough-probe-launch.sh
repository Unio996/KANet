#!/bin/sh
# J1 trough 探针启动器 v6 — Codex MSG-237 终审合规: 启动器自身被外部批准 commit 绑定(非自证)
# 信任根 = J1_PROBE_APPROVED_COMMIT(外部值: 来自 Codex ACCEPT 记录/ledger, 执行方从被审记录抄入)。
# 校验链: ①HEAD == approved commit ②全仓 tracked 文件零改动(untracked 不计, 标签如实=tracked-clean)
#   ③启动器自身磁盘字节 == approved commit 里的版本(外绑: 本文件被 HEAD 版本校验, 不自证)
#   ④仪器磁盘 blob == approved commit 里的仪器 blob(而非本文件内嵌值——内嵌值仅作双记)
#   ⑤J1_PROBE_RELAY_ID 前缀 == 102cbb99(J2-tn)
# 用法(执行方检出根): J1_PROBE_APPROVED_COMMIT=<被审 commit> J1_PROBE_RELAY_ID=<完整 relayId> bash scripts/j1-trough-probe-launch.sh [TIME_CAP<=360] [DRYRUN]
cd "$(dirname "$0")/.." || exit 1
REF_INSTRUMENT_SHA=d9cf26ef1a02ffb25a73e675ac9c83d8e187322ac7025ee58019860c4bd7ae85
if [ -z "$J1_PROBE_APPROVED_COMMIT" ]; then echo "LAUNCH-REFUSED: 缺 J1_PROBE_APPROVED_COMMIT(外部批准 commit, 从 Codex ACCEPT/ledger 记录抄入)"; exit 1; fi
HEADC=$(git rev-parse HEAD)
APPR=$(git rev-parse "$J1_PROBE_APPROVED_COMMIT" 2>/dev/null)
if [ -z "$APPR" ] || [ "$HEADC" != "$APPR" ]; then echo "LAUNCH-REFUSED: HEAD($HEADC) != 批准 commit($J1_PROBE_APPROVED_COMMIT)"; exit 1; fi
DIRTY=$(git status --porcelain | grep -v '^??' || true)
if [ -n "$DIRTY" ]; then echo "LAUNCH-REFUSED: tracked 文件有未提交改动:"; echo "$DIRTY"; exit 1; fi
SELF_DISK=$(git hash-object scripts/j1-trough-probe-launch.sh)
SELF_HEAD=$(git rev-parse "$APPR:scripts/j1-trough-probe-launch.sh")
if [ "$SELF_DISK" != "$SELF_HEAD" ]; then echo "LAUNCH-REFUSED: 启动器磁盘字节 != 批准 commit 版本(外绑校验)"; exit 1; fi
INST_DISK=$(git hash-object scripts/j1-trough-probe-instrument.mjs)
INST_HEAD=$(git rev-parse "$APPR:scripts/j1-trough-probe-instrument.mjs")
if [ "$INST_DISK" != "$INST_HEAD" ]; then echo "LAUNCH-REFUSED: 仪器磁盘 blob != 批准 commit 版本"; exit 1; fi
case "$J1_PROBE_RELAY_ID" in
  102cbb99*) : ;;
  *) echo "LAUNCH-REFUSED: J1_PROBE_RELAY_ID 缺失或前缀非 102cbb99(J2-tn)"; exit 1 ;;
esac
export J1_PROBE_EXPECTED_SELF_SHA=$REF_INSTRUMENT_SHA
export J1_PROBE_SOURCE_COMMIT=$HEADC
export J1_PROBE_INSTRUMENT_BLOB=$INST_DISK
export J1_PROBE_TREE_CLEAN="tracked-clean@approved-commit"
# ── host profile(J2-tn, (443) 裁; 钉死非自由参数) ──
export J1_PROBE_SENDER_ADDR='kaspatest:qzcpypywd2zjgx333qkr66dh6jfguyjkscy7wxqtqqvq5hchkpstg8t9gqk3v'
export J1_PROBE_NODE1_ID='local-J2-machine-ws://127.0.0.1:17210-testnet-12'
export J1_PROBE_NODE2_ID='J1-laptop-observer-100.111.126.10:17210'
export J1_PROBE_NODE2_URL='ws://100.111.126.10:17210'
exec node scripts/j1-trough-probe-instrument.mjs "$@"
