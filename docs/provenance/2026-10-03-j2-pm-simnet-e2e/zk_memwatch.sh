#!/bin/bash
# 防 OOM 误杀同 WSL 里的数字人(vLLM/avatarforcing): MemAvailable < 1200MB 就杀 r0vm/host 并记一行
while pgrep -f "r0vm|release/host" >/dev/null; do
  a=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  echo "$(date -Is) MemAvailable=${a}MB r0vm_rss=$(ps -o rss= -C r0vm | awk '{s+=$1}END{print int(s/1024)}')MB"
  if [ "$a" -lt 1200 ]; then echo "KILL: MemAvailable<1200MB"; pkill -9 -f r0vm; pkill -9 -f release/host; break; fi
  sleep 3
done
echo watch-exit
