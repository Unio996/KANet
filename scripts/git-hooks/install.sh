#!/usr/bin/env bash
# install.sh — 把 scripts/git-hooks/ 下所有 hook 安装到 .git/hooks/
# 用法: bash scripts/git-hooks/install.sh
#
# 注意: 会覆盖现有 .git/hooks/<name>. 如果你的 hook 有自定义改动, 先备份.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
KANET_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
HOOKS_DIR="$KANET_ROOT/.git/hooks"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "错: $HOOKS_DIR 不存在 (本目录不是 git repo?)"
  exit 1
fi

INSTALLED=0
for src in "$SCRIPT_DIR"/*; do
  name=$(basename "$src")
  # 跳过 install.sh / README.md
  case "$name" in
    install.sh|README.md|*.md) continue ;;
  esac
  cp "$src" "$HOOKS_DIR/$name"
  chmod +x "$HOOKS_DIR/$name"
  echo "  ✓ installed $name"
  INSTALLED=$((INSTALLED + 1))
done

echo ""
echo "安装 $INSTALLED 个 hook 到 $HOOKS_DIR"
echo ""
echo "测试: 改 broker 业务文件 (e.g. kasia-console/src/services/broker-llm-agent.js)"
echo "      commit → 检查 logs/post-commit-test.log"
