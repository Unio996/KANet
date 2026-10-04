#!/bin/bash
# 常驻版内存看门狗(沿用 2026-10-03 rehearsal 的 zk_memwatch.sh 阈值): 整个验收期间一直跑, 出证(r0vm/release/host)时每 3s 记一行;
# MemAvailable < 1200MB ⇒ 杀 r0vm/host(防 OOM 误杀同 WSL 里的数字人 vLLM)。KANet-UI 实测: 峰值 RSS≈4.8GB, WSL MemAvailable 最低 1315MB。
LOG=/mnt/d/kanet-tn12/scratch/_j2_wt_tokenize/docs/provenance/2026-10-04-j2-settle-tokenize-seg3/memwatch.log
echo "$(date -Is) memwatch start" >> "$LOG"
while true; do
  if pgrep -f "r0vm|release/host" >/dev/null; then
    a=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
    echo "$(date -Is) MemAvailable=${a}MB r0vm_rss=$(ps -o rss= -C r0vm | awk '{s+=$1}END{print int(s/1024)}')MB" >> "$LOG"
    if [ "$a" -lt 1200 ]; then echo "$(date -Is) KILL: MemAvailable<1200MB" >> "$LOG"; pkill -9 -f r0vm; pkill -9 -f release/host; fi
    sleep 3
  else sleep 5; fi
done
