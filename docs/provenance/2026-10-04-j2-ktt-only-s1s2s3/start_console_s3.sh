#!/bin/bash
# S3 simnet console (production code from worktree _j2_wt_s12, KANET_NO_KAS_STAKE_MODE=1). 额外 env 以参数 KEY=VAL 传入。
cd /d/kanet-tn12/scratch/_j2_wt_s12/kasia-console
set -a; . <(grep -v '^#' /d/kanet-tn12/scratch/_j2_s3/env.s3.simnet | grep -v '^$'); for kv in "$@"; do export "$kv"; done; set +a
nohup node src/index.js >> /d/kanet-tn12/scratch/_j2_s3/console.log 2>&1 &
echo started $!
