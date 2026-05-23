#!/usr/bin/env bash
# broker-probe.sh — bash 友好 wrapper, 强制走 Node fetch (UTF-8 安全)
# 防 bash curl -d 砸 CJK
#
# 用法:
#   bash scripts/broker-probe.sh '想买 50 KAS'
#   bash scripts/broker-probe.sh '搞 50 kas' '想换 30 个 kas' '弄 100 kas'
# 默认无参数: 跑 10 case 矩阵.

cd "$(dirname "$0")/.." || exit 1
exec node kasia-console/scripts/broker-probe.mjs "$@"
