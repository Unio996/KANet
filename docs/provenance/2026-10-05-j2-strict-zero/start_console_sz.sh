#!/bin/bash
# 严格零 e2e simnet console(production code from worktree _j2_wt_sz, KANET_NO_KAS_STAKE_MODE=1)
cd /d/kanet-tn12/scratch/_j2_wt_sz/kasia-console
set -a; . <(grep -v '^#' /d/kanet-tn12/scratch/_j2_sz/env.sz.simnet | grep -v '^$'); for kv in "$@"; do export "$kv"; done; set +a
nohup node src/index.js >> /d/kanet-tn12/scratch/_j2_sz/console.log 2>&1 &
echo started $!
