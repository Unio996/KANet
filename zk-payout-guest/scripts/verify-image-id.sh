#!/usr/bin/env bash
# verify-image-id.sh — guest imageId 自证 (2026-08-29 J2; 方案稿 docs/2026-08-29-j2-zk-guest-imageid-reproducibility-plan.md §4.3 ③)
# 用法 (WSL, 本目录的上一级 = zk-payout-guest):
#   bash scripts/verify-image-id.sh            零构建: 读现有 target/ 里最新的 methods.rs, 比 TOOLCHAIN.lock.json 的 canonical
#   bash scripts/verify-image-id.sh --build    先 cargo build --release -p methods (重编 guest, 分钟级, 不 prove), 再比
# 环境: NICE (默认 19) / JOBS (默认 2) 只在 --build 生效。建议在副本树跑 (live 树 target/ 归 zk-prove-worker 用)。
# 🔴 本脚本只读比对: 不等 ⇒ exit 1, 不改任何文件、不改 canonical (mismatch 本身就是交付物, 记进方案稿 §3 / D-005)。
set -euo pipefail
cd "$(dirname "$0")/.."
LOCK=TOOLCHAIN.lock.json
[ -f "$LOCK" ] || { echo "ERR: $LOCK 不在 $(pwd)"; exit 2; }
want=$(grep -oP '"canonical_image_id": "\K[0-9a-f]{64}' "$LOCK")
[ -n "$want" ] || { echo "ERR: $LOCK 无 canonical_image_id"; exit 2; }
if [ "${1:-}" = "--build" ]; then
  echo "== --build: nice -n ${NICE:-19}, CARGO_BUILD_JOBS=${JOBS:-2}, tree=$(pwd), start=$(date -Is)"
  echo "   guest rustc: $(rustc +risc0 -V 2>&1)   host rustc: $(rustc -V 2>&1)"
  CARGO_BUILD_JOBS="${JOBS:-2}" nice -n "${NICE:-19}" cargo build --release -p methods
  echo "== build done $(date -Is)"
fi
f=$(ls -t target/release/build/methods-*/out/methods.rs 2>/dev/null | head -1)
[ -n "$f" ] || { echo "ERR: 无 target/release/build/methods-*/out/methods.rs (先 --build)"; exit 2; }
words=$(grep -oP 'PAYOUT_ID: \[u32; 8\] = \[\K[^\]]+' "$f")
[ -n "$words" ] || { echo "ERR: $f 无 PAYOUT_ID"; exit 2; }
got=$(python3 -c "import struct; w=[int(x) for x in '$words'.split(',')]; print(struct.pack('<8I',*w).hex())")
bin=$(grep -oP 'PAYOUT_PATH: &str = "\K[^"]+' "$f")
echo "methods.rs = $f ($(stat -c %y "$f" | cut -c1-19))"
[ -f "$bin" ] && echo "payout.bin = $bin ($(stat -c %s "$bin") B, sha256 $(sha256sum "$bin" | cut -c1-32)…)" || echo "payout.bin = $bin (不在)"
echo "got  = $got"
echo "want = $want"
if [ "$got" = "$want" ]; then echo "IMAGE_ID OK"; else echo "IMAGE_ID MISMATCH — 不改任何东西; 记事实进方案稿 §3, 上 D-005"; exit 1; fi
