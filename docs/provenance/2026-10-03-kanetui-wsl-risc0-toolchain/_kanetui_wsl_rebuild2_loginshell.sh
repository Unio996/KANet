#!/bin/bash
# Fidelity run: same environment shape as zk-prove-worker.mjs:70 (wsl -e bash -lc, no RUSTUP_TOOLCHAIN, no extra PATH),
# on a copy (no target/), nice 19 / jobs 2. Build only (cargo build -p methods), no prove.
LOG=/mnt/d/kanet-tn12/scratch/_kanetui_wsl_rebuild2_loginshell.log
exec > >(tee -a "$LOG") 2>&1
SRC=/mnt/d/kanet-tn12/zk-payout-guest
DST=/tmp/kanetui_zk_guest_build2
echo "== start $(date -Is)"
rm -rf "$DST"; mkdir -p "$DST"
tar -C "$SRC" --exclude=./target --exclude=./proofs -cf - . | tar -C "$DST" -xf -
cd "$DST"
echo "PATH=$PATH"
echo "which rzup: $(which rzup 2>&1)"
echo "active in tree: $(rustup show active-toolchain 2>&1 | head -1)"
CARGO_BUILD_JOBS=2 nice -n 19 cargo build --release -p methods 2>&1 | tail -4
f=$(ls -t target/release/build/methods-*/out/methods.rs 2>/dev/null | head -1)
words=$(grep -oP 'PAYOUT_ID: \[u32; 8\] = \[\K[^\]]+' "$f")
got=$(python3 -c "import struct; w=[int(x) for x in '$words'.split(',')]; print(struct.pack('<8I',*w).hex())")
echo "got=$got"
bin=$(grep -oP 'PAYOUT_PATH: &str = "\K[^"]+' "$f")
sha256sum "$bin"
[ "$got" = "c9918501d90bf0aeaaf7970816078c81e8286c08293ccf388e87a7cab023ce30" ] && echo "IMAGE_ID OK (login-shell run)" || echo "IMAGE_ID MISMATCH (login-shell run)"
cd /; rm -rf "$DST"
echo "== done $(date -Is)"
