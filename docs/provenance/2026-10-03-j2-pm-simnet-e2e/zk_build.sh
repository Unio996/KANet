#!/bin/bash
# WSL 内: 在 worktree 副本树重编 guest + host (nice 19, jobs 2), 并比 imageId == TOOLCHAIN.lock canonical
cd /mnt/d/kanet-tn12/scratch/_j2_wt_pm_e2e/zk-payout-guest
NICE=19 JOBS=2 bash scripts/verify-image-id.sh --build
CARGO_BUILD_JOBS=2 nice -n 19 cargo build --release
echo BUILD_ALL_DONE $(date -Is)
