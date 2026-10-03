#!/bin/bash
# Step 2: risc0 guest toolchain per zk-payout-guest/TOOLCHAIN.lock.json (rust 1.94.1, cargo-risczero 3.0.5, r0vm 3.0.5)
set -eu
export HOME=/root
. /root/.cargo/env
LOG=/mnt/d/kanet-tn12/scratch/_kanetui_wsl_install2.log
exec > >(tee -a "$LOG") 2>&1
echo "== start $(date -Is)"
nice -n 19 bash /mnt/d/kanet-tn12/scratch/_kanetui_risc0_install.sh
export PATH="$HOME/.risc0/bin:$PATH"
rzup --version
nice -n 19 rzup install rust 1.94.1
nice -n 19 rzup install cargo-risczero 3.0.5
nice -n 19 rzup install r0vm 3.0.5
rzup show
rustup toolchain list
ls -la /root/.risc0/toolchains/ 2>&1
rustc +risc0 -V
cargo +risc0 -V
echo "== done $(date -Is)"
