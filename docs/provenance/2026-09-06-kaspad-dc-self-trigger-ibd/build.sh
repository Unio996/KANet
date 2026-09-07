#!/usr/bin/env bash
# D-c release build (J2, 2026-09-06). Isolated worktree + isolated CARGO_TARGET_DIR; -j 2 (host free < 10 GB, live kaspad 28 GB WS).
# Never builds under D:\rusty-kaspa-da\target (that is the live D-a exe). Output copied to D:\kaspad-live\dc-<short>\kaspad.exe (rule 863: file name unchanged, per-version subdir).
set -u
# Attempt 1 (82d47d85) and attempt 2 (a39c60d2) built in the git WORKTREE D:\rusty-kaspa-dc whose .git is a FILE ->
# utils/build.rs:41-42 (`.git` must be a directory) embedded NO commit hash (see build-attempt2-WORKTREE-no-embedded-hash-*.log).
# Attempt 3+: real clone D:\rusty-kaspa-dc2 (same commit, .git is a directory); target dir reused for dependency artifacts.
SRC=/d/rusty-kaspa-dc2
export CARGO_TARGET_DIR=/d/rusty-kaspa-dc/target-dc
export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2}
cd "$SRC" || exit 2
H=$(git rev-parse HEAD); S=$(git rev-parse --short HEAD)
DIRTY=$(git status --porcelain | wc -l)
echo "BUILD SCRIPT start $(date -u +%FT%TZ) commit=$H dirty=$DIRTY jobs=$CARGO_BUILD_JOBS rustc=$(rustc --version) cargo=$(cargo --version) target=$CARGO_TARGET_DIR"
if [ "$DIRTY" != "0" ]; then echo "ABORT: dirty tree (artifact would embed a misleading hash)"; git status --porcelain; exit 3; fi
echo "free_gb_before=$(powershell -NoProfile -Command "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)" 2>/dev/null)"
T0=$(date -u +%s)
cargo build --release -j "$CARGO_BUILD_JOBS" -p kaspad 2>&1 | grep -v "^ *Compiling"
RC=${PIPESTATUS[0]}
echo "BUILD rc=$RC $(date -u +%FT%TZ) wall=$(( $(date -u +%s) - T0 ))s"
[ "$RC" != "0" ] && exit $RC
EXE="$CARGO_TARGET_DIR/release/kaspad.exe"
ls -la "$EXE"
SHA=$(sha256sum "$EXE" | cut -c1-64); echo "exe sha256=$SHA"
EMB_S=$(grep -a -o "$S" "$EXE" | wc -l); EMB_F=$(grep -a -c "$H" "$EXE")
echo "embedded short hash count=$EMB_S full=$EMB_F   (no strings on this host; grep -a)"
if [ "$EMB_S" = "0" ]; then echo "ABORT: no embedded commit hash in exe (built outside a real .git directory?) — NOT copying to kaspad-live"; exit 4; fi
OUT=/d/kaspad-live/dc-$S; mkdir -p "$OUT"; cp "$EXE" "$OUT/kaspad.exe" && echo "copied to $OUT/kaspad.exe sha256=$(sha256sum "$OUT/kaspad.exe" | cut -c1-64)"
echo "free_gb_after=$(powershell -NoProfile -Command "[math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1)" 2>/dev/null)"
echo "BUILD SCRIPT end $(date -u +%FT%TZ)"
