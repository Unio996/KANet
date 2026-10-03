#!/bin/bash
# Step 3: reproduce the guest build on a COPY (no target/) and compare imageId to canonical. nice 19, jobs 2. No GPU, no prove.
set -eu
export HOME=/root
. /root/.cargo/env
export PATH="$HOME/.risc0/bin:$PATH"
export RUSTUP_TOOLCHAIN=1.96.1      # host = lock host_toolchain; avoids rust-toolchain.toml channel=stable pulling a floating compiler
LOG=/mnt/d/kanet-tn12/scratch/_kanetui_wsl_rebuild.log
exec > >(tee -a "$LOG") 2>&1
SRC=/mnt/d/kanet-tn12/zk-payout-guest
DST=/tmp/kanetui_zk_guest_build
echo "== start $(date -Is)  src git HEAD: $(git -C /mnt/d/kanet-tn12 rev-parse --short HEAD 2>/dev/null)"
rm -rf "$DST"; mkdir -p "$DST"
tar -C "$SRC" --exclude=./target --exclude=./proofs -cf - . | tar -C "$DST" -xf -
cd "$DST"
echo "tree: $(pwd)  files: $(find . -type f | wc -l)"
echo "guest rustc: $(rustc +risc0 -V)"; echo "host rustc: $(rustc -V)"
NICE=19 JOBS=2 bash scripts/verify-image-id.sh --build
echo "== done $(date -Is)"
echo "payout.bin sha256 (full):"
f=$(ls -t target/release/build/methods-*/out/methods.rs | head -1)
bin=$(grep -oP 'PAYOUT_PATH: &str = "\K[^"]+' "$f")
sha256sum "$bin"; stat -c '%s bytes' "$bin"
