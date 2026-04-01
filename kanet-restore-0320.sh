#!/bin/bash
# KANet 一键恢复 — 2026-03-20 晚间快照
# code_sense + Chat乐观更新 + 全量提交
# 用法: bash kanet-restore-0320.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${KANET_ROOT:-$SCRIPT_DIR}"

echo "=== KANet Restore: 2026-03-20 snapshot ==="

cd "$ROOT/kasia-console" && git checkout c1d8dbc && echo "[OK] kasia-console → c1d8dbc"
cd "$ROOT/agent-mind"    && git checkout 3e8d6ec && echo "[OK] agent-mind → 3e8d6ec"
cd "$ROOT/kasia-relay"   && git checkout 4638b0b && echo "[OK] kasia-relay → 4638b0b"
cd "$ROOT/kaspa-scout"   && git checkout 5d3c1bc && echo "[OK] kaspa-scout → 5d3c1bc"
cd "$ROOT/agent-adapter" && git checkout 2c14d7e && echo "[OK] agent-adapter → 2c14d7e"

echo ""
echo "=== Restored to 2026-03-20 snapshot ==="
echo "Run 'bash kanet-start.sh' to start KANet"
