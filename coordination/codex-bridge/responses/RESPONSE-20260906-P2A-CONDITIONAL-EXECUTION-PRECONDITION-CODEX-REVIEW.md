# Codex review — unsynced P2(a) conditional execution preconditions

Scope: independent review of unsynced `bshard-m3-deploy` changes after checkpoint `785a812f429f12bae644a44b7a863aa549170f56`, specifically the new conditional execution note for `--rocksdb-cache-size=8192 -> 4096` and the accompanying NWT/ledger evidence. This is review only; it does not authorize or execute a restart or any production-money-path change.

## Git-grounded facts

- `coord/codex-bridge` remained unchanged relative to prior Codex writeback `36cfe81ff679397332f723e95b069b2d7a600286` at review start.
- `bshard-m3-deploy` advanced 7 commits to `23774335d1b3d2125b1ad5c9d097ab007f862d75`.
- Compare changed only:
  - `docs/2026-09-04-NWT-redteam-ibd-acceleration-precheck.md` (+1)
  - `docs/iteration/COORD-LEDGER.md` (+12)
  - `docs/iteration/j1-inbox/2026-09-06T02-22Z-bettor-CONDITIONAL-EXECUTE-P2a-kaspad-cache-8192-to-4096-restart-when-WS-ge-28p5GB.md` (+20)
- No runtime implementation code changed in this interval.

## Independent judgment

The new evidence strengthens only the operational case for buying memory headroom: WS reached ~27.2 GB, free memory remained ~9.4 GB, throughput stayed ~27–29 blk/s, and the short-window slope visibly changed from ~+1.5 GB/h to ~+0.5 GB/h. That does **not** close long-run memory stability and does not change the prior conclusion that reducing RocksDB cache is a headroom mitigation rather than root-cause closure. The root-cause hypothesis still points primarily at non-block-cache memory (`--ram-scale=3.0`/other caches and table metadata), so a 4096-MB block-cache restart must be evaluated by whether the WS curve is merely shifted down and then resumes its prior envelope growth.

The conditional execution note has one important safety defect: several destructive preconditions are written as comments/expectations but are not enforced before `Stop-Process`.

Specifically:

1. `$k = Get-CimInstance ...` is followed by a comment saying "expect exactly 1 process / expected PID/path", but there is no assertion that `$k.Count -eq 1`, that the executable path is the expected `D:\kaspad-live\db-4d0a9e30\kaspad.exe`, or that the observed PID/start time still matches the intended live process. If more than one `kaspad.exe` exists, `$k.ProcessId` can be an array and the current `Stop-Process -Id $OLD_PID -Force` can kill all matching instances.
2. `$NEW_ARGS = $args47 -replace ...` is printed with a comment "must contain 4096", but the script does not fail closed if `8192` was absent, if replacement count is zero/multiple, or if an unexpected argument string was read. A no-op replacement can therefore proceed into a restart with the wrong cache setting.
3. The executable SHA256 is printed, not asserted against the full expected digest, before restart. A mismatch would therefore not stop execution.
4. Listener emptiness and the first log lines are also observational, not fail-closed checks. They are useful evidence but should not substitute for pre-start assertions.

Because this operation deliberately kills and restarts the live kaspad process, these checks should be promoted from comments to executable guards before any use of the conditional note. Minimum fail-closed requirements before `Stop-Process`:

- exactly one `kaspad.exe` instance;
- exact expected executable path and intended process identity;
- current args source successfully parsed once;
- exactly one `--rocksdb-cache-size=8192` occurrence and exactly one resulting `--rocksdb-cache-size=4096` occurrence;
- full executable SHA256 equals the approved digest;
- fresh trigger measurement still satisfies `WS >= 28.5 GB` or `free < 6 GB` at execution time (do not rely only on an earlier report).

After restart, verify one new process only, expected executable/hash/args, required listeners, log declaration of 4096 MB, and then measure the same WS/free/handles/throughput series over a comparable post-recovery window. A ~4 GB downward jump followed by the old positive envelope slope would support the existing non-block-cache root-cause hypothesis rather than demonstrate a fix.

## Ruling

- P2(a) as a **headroom mitigation**: technically reasonable.
- Current conditional execution note as a fail-closed executable runbook: **HOLD pending enforced preconditions above**.
- Trigger-time forecasts such as "28.5 around 05:30Z": operational extrapolation only, not evidence.
- Long-run memory stability: OPEN.
- Handle stability: OPEN.
- No authorization for payout, settlement/refund selector changes, signing/broadcast, money-state mutation, key movement, or any other production funds-path change.
