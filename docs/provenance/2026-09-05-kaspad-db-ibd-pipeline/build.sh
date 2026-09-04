#!/usr/bin/env bash
# D-b isolated build (branch j2-db-ibd-pipeline on D:\rusty-kaspa-da, base 1b3046fb). Build only; never deploys.
export LIBCLANG_PATH="C:\Program Files\LLVM\bin"
export CARGO_NET_RETRY=5
export RUSTFLAGS=""
ts(){ date -u +%Y-%m-%dT%H:%M:%SZ; }
TREE=/d/rusty-kaspa-da
export CARGO_TARGET_DIR=$TREE/target-db   # D-b: separate target dir — $TREE/target/release/kaspad.exe is the LIVE D-a binary (locked by PID 27032), never build over it
echo "BUILD SCRIPT start $(ts) rustc=$(rustc -V) cargo=$(cargo -V)"
echo "=== [db] head=$(git -C $TREE rev-parse HEAD) branch=$(git -C $TREE rev-parse --abbrev-ref HEAD) dirty=$(git -C $TREE status --porcelain | wc -l)"
echo "=== [db] cargo fetch start $(ts)"
( cd $TREE && cargo fetch --locked ) ; echo "=== [db] fetch rc=$? $(ts)"
echo "=== [db] build start $(ts)"
( cd $TREE && cargo build --release --locked -j 12 --bin kaspad ) ; RC=$?
echo "=== [db] build rc=$RC end $(ts)"
if [ $RC -eq 0 ]; then
  EXE=$CARGO_TARGET_DIR/release/kaspad.exe
  echo "=== [db] exe size=$(stat -c %s "$EXE") sha256=$(sha256sum "$EXE" | cut -c1-64)"
  echo "=== [db] version: $("$EXE" --version 2>&1 | head -2 | tr '\n' ' ')"
  echo "=== [db] embedded hash strings: $(grep -a -c "$(git -C $TREE rev-parse --short HEAD)" "$EXE") x short, $(grep -a -c "$(git -C $TREE rev-parse HEAD)" "$EXE") x full"
fi
echo "=== [db] cargo test -p kaspa-p2p-flows start $(ts)"
( cd $TREE && cargo test --release --locked -j 12 -p kaspa-p2p-flows ) ; echo "=== [db] test rc=$? end $(ts)"
echo "BUILD SCRIPT end $(ts)"
touch /d/kanet-tn12/scratch/_j2_db_build.done
