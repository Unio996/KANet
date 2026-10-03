#!/bin/bash
# 起 simnet 彩排 console(生产代码, worktree)。env 来自 env.simnet.template + 额外 env(参数 KEY=VAL ...)
cd /d/kanet-tn12/scratch/_j2_wt_tokenize/kasia-console
set -a; . <(grep -v '^#' ../docs/provenance/2026-10-04-j2-settle-tokenize-seg1/env.simnet.template | grep -v '^$'); for kv in "$@"; do export "$kv"; done; set +a
nohup node src/index.js >> /d/kanet-tn12/scratch/_j2_tok_sim/console.log 2>&1 &
echo started $!
