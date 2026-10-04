#!/bin/bash
# Groth16 prove on a private copy of J2's guest tree (read-only source), nice 19, jobs 2, with MemAvailable watchdog.
OUT=/mnt/d/kanet-tn12/scratch/_kanetui_groth16_out
SRC=/mnt/d/kanet-tn12/scratch/_j2_wt_pm_e2e/zk-payout-guest
DST=/tmp/kanetui_g16
mkdir -p "$OUT"
exec > >(tee -a "$OUT/run.log") 2>&1
echo "== start $(date -Is)"; grep -E 'MemTotal|MemAvailable' /proc/meminfo
rm -rf "$DST"; mkdir -p "$DST"
tar -C "$SRC" --exclude=./proofs -cf - . | tar -C "$DST" -xf -
cd "$DST/host"
. /root/.cargo/env
docker version --format 'docker server {{.Server.Version}}'
( while pgrep -f "r0vm|release/host|docker" >/dev/null || [ ! -f "$OUT/.done" ]; do
    a=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
    echo "$(date -Is) MemAvailable=${a}MB r0vm_rss=$(ps -o rss= -C r0vm | awk '{s+=$1}END{print int(s/1024)}')MB gpu=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader 2>/dev/null)" >> "$OUT/mem.log"
    if [ "$a" -lt 1200 ]; then echo "KILL MemAvailable<1200" >> "$OUT/mem.log"; pkill -9 -f r0vm; pkill -9 -f release/host; fi
    sleep 3
  done ) &
WATCH=$!
CARGO_BUILD_JOBS=2 nice -n 19 /usr/bin/time -v cargo run --release -- "$DST/inputs/3o6cs_input.json" "$OUT/sample" 2>&1 | tail -60
echo "PROVE_EXIT=${PIPESTATUS[0]} $(date -Is)"
touch "$OUT/.done"; sleep 4; kill $WATCH 2>/dev/null
ls -la "$OUT"
cat "$OUT/sample.summary.json" 2>/dev/null
cd /; rm -rf "$DST"
echo "== done $(date -Is)"
