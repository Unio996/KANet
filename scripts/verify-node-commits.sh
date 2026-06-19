#!/usr/bin/env bash
# verify-node-commits.sh — DoD-E E4 (J1, 2026-06-12): 双节点同-commit deploy-time guardrail.
#
# 为什么: 跨节点 consensus(getBlockAtDaa endBlock / settle preimage / committee_pk_hash)
#   要求两节点跑【字节一致】的共识关键代码. 部署期无机制验 → 静默分叉风险(我 P1 修过正是这类).
#   runtime backstop 已有(committee_pk_hash 跨节点对拍, J2 P1 验 3/3 逐字节同) —— 本脚本只补
#   【部署期】这一段, 与 runtime 对拍互补不重叠.
#
# 怎么用:
#   两个节点各跑 `bash scripts/verify-node-commits.sh`, 把输出整块贴到 dev-coord-testnet 频道,
#   逐行比对. 【主检查】git HEAD 同 = 全树字节一致(若 clean). 【次检查/关键】共识关键文件
#   sha256 同 —— 即便 HEAD 不同(发散 sandbox 合法, 如 J1 :3300 remote=本地), 只要这些文件
#   字节一致, 跨节点 consensus 就安全. 任一关键文件 hash 不同 = 必须停, 会分叉.
#
# 退出码: 0 正常输出; 非0 仅在 git/文件读取异常.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KANET_ROOT="${KANET_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$KANET_ROOT"

# 共识关键文件清单 (跨节点必字节一致 = byte-identical 才不分叉).
# 来源: getBlockAtDaa endBlock 派生 + settle/refund preimage 构建 + P2SH 脚本 + deriveVote 票决.
# 扩展规则: 任何喂入跨节点确定性输出(committee_pk_hash / preimage / 委员可花 P2SH / vote)的文件加这里.
CRITICAL_FILES=(
  "kasia-relay/src/rpc-listener.mjs"                       # getBlockAtDaa endBlock (committee_pk_hash 源)
  "kasia-console/src/services/pool-market-settler.js"      # settle/refund preimage 构建 + requiredInputOutpoints 序
  "kasia-console/src/lib/pool-p2sh-v06.mjs"                # 委员会可花 P2SH 脚本 (双方必同才能花)
  "kasia-console/src/services/derivevote-prompt.mjs"       # deriveVote prompt (票决确定性)
  "kasia-console/src/services/bettor-prediction-voter.js"  # deriveVote 路由/抽取逻辑
)

# 跨平台 sha256 (git bash: sha256sum; 退化 certutil/openssl)
sha256_of() {
  local f="$1"
  if [ ! -f "$f" ]; then echo "MISSING-FILE"; return; fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$f" | cut -d' ' -f1
  elif command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha256 "$f" | sed 's/.*= //'
  else
    echo "NO-SHA-TOOL"
  fi
}

HOST="$(hostname 2>/dev/null || echo unknown)"
HEAD_SHA="$(git rev-parse HEAD 2>/dev/null || echo NO-GIT)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo NO-GIT)"
DIRTY_N="$(git status --porcelain 2>/dev/null | wc -l | tr -d '[:space:]')"

echo "=== KANet node deploy fingerprint (DoD-E E4 双节点同-commit 验) ==="
echo "node    : $HOST"
echo "git HEAD: $HEAD_SHA"
echo "branch  : $BRANCH"
echo "dirty   : $DIRTY_N 个未提交改动$([ "$DIRTY_N" != "0" ] && echo '  ⚠ HEAD 不代表实跑字节, 必比下方关键文件 hash')"
echo "--- 共识关键文件 sha256 (跨节点必逐行相同, 否则分叉) ---"
for f in "${CRITICAL_FILES[@]}"; do
  printf '%s  %s\n' "$(sha256_of "$f")" "$f"
done
echo "=== 把本块整体贴 dev-coord-testnet, 两节点逐行比对; HEAD 同(且 clean) OR 关键文件 hash 全同 = 安全 ==="
