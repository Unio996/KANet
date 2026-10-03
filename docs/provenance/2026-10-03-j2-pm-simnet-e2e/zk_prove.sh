#!/bin/bash
# WSL 内: 用【工作树副本】host 出真 RISC0 Groth16 证明 (nice 19, 低优先级); 记录墙钟与峰值内存。
cd /mnt/d/kanet-tn12/scratch/_j2_wt_pm_e2e/zk-payout-guest/host
OUT=/mnt/d/kanet-tn12/scratch/_j2_wt_pm_e2e/docs/provenance/2026-10-03-j2-pm-simnet-e2e/zk_proof_out
IN=/mnt/d/kanet-tn12/scratch/_j2_wt_pm_e2e/zk-payout-guest/inputs/3o6cs_input.json
date -Is; free -m | head -2
CARGO_BUILD_JOBS=2 nice -n 19 /usr/bin/time -v cargo run --release -- "$IN" "$OUT/rehearsal"
echo PROVE_EXIT=$? $(date -Is)
