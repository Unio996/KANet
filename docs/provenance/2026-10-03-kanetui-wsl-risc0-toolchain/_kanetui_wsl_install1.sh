#!/bin/bash
# Step 1: host rust 1.96.1 (lock host_toolchain), minimal profile. No GPU. nice 19.
set -eu
export HOME=/root
LOG=/mnt/d/kanet-tn12/scratch/_kanetui_wsl_install1.log
exec > >(tee -a "$LOG") 2>&1
echo "== start $(date -Is)"
cd /tmp
curl -sSf --max-time 120 -o rustup-init https://static.rust-lang.org/rustup/dist/x86_64-unknown-linux-gnu/rustup-init
chmod +x rustup-init
nice -n 19 ./rustup-init -y --profile minimal --default-toolchain 1.96.1
. /root/.cargo/env
rustc -V; cargo -V; rustup -V
echo "== done $(date -Is)"
