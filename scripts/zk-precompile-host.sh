#!/bin/bash
# zk-precompile-host.sh — 账本1832 段4(主网阻断项): 在 WSL 里【预编译】RISC0 host 二进制, 之后 zk-prove-worker 只跑 target/release/host, 不再 `cargo run` 现场编译依赖。
# 用法(WSL, 部署/升级 guest 时一次性跑, 不要在出证窗口跑——编译本身吃内存): bash scripts/zk-precompile-host.sh [zk-payout-guest 目录]
# 低优先级 + 2 个编译作业, 与同 VM 里的服务(vLLM/avatarforcing)错峰; 编译完打印二进制路径与 sha256 供留痕。
set -euo pipefail
GUEST_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)/zk-payout-guest}"
[ -d "$GUEST_DIR/host" ] || { echo "找不到 $GUEST_DIR/host" >&2; exit 2; }
. "$HOME/.cargo/env" 2>/dev/null || true
a=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
echo "MemAvailable=${a}MB (建议 >= 6144MB 再编译)"
cd "$GUEST_DIR/host"
CARGO_BUILD_JOBS=2 nice -n 19 cargo build --release
BIN="$GUEST_DIR/target/release/host"
[ -x "$BIN" ] || { echo "编译后未找到 $BIN" >&2; exit 3; }
echo "host binary: $BIN"; sha256sum "$BIN"; ls -l "$BIN"
