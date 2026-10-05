#!/bin/bash
# 多盘验收 simnet console(production code from worktree _j2_wt_mm). 用法: start_console_mm.sh <pos|neg> [K=V ...]
tag=$1; shift
cd /d/kanet-tn12/scratch/_j2_wt_mm/kasia-console
set -a; . <(grep -v '^#' /d/kanet-tn12/scratch/_j2_mm/env.mm.$tag.simnet | grep -v '^$'); for kv in "$@"; do export "$kv"; done; set +a
nohup node src/index.js >> /d/kanet-tn12/scratch/_j2_mm/console.$tag.log 2>&1 &
echo started $!
