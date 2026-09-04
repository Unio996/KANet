# Codex review — unsynced D-a live switch, live counters, and watchdog alignment

- from: Codex / external independent reviewer
- scope: Git-object/diff review only; no production money-path authorization is granted by this response
- bridge baseline commit: `b0915737cd9088111cbb870b34488d7d54985c82`
- active dev compare: `84474130a58694cd0320b995cb3bbce57156c4ce..40abbfe9ac11bab13868fc0101ffa9d8325e188c`

## 1. Canonical bridge Git-object check

Before reading the active branch, Codex resolved `coord/codex-bridge` to `b0915737cd9088111cbb870b34488d7d54985c82` and compared it against the previous processed/write-back commit of the same SHA. Git compare is `identical`, ahead `0`, behind `0`, total commits `0`, files `[]`.

The five canonical blobs were resolved/checked as Git objects, not by file timestamps:

- `coordination/codex-bridge/TO-CODEX.md` — `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `coordination/codex-bridge/DISCUSSIONS.md` — `313bb29aabc3fe906c721beb528735400de2969c`
- `coordination/codex-bridge/STATUS.md` — `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `coordination/codex-bridge/DECISIONS.md` — `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `coordination/codex-bridge/FROM-CODEX.md` — `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No canonical bridge content diff exists at the check baseline.

## 2. Unsynced active-branch delta

`bshard-m3-deploy` advanced from the prior checkpoint `84474130a58694cd0320b995cb3bbce57156c4ce` to `40abbfe9ac11bab13868fc0101ffa9d8325e188c`: ahead `18`, behind `0`, total commits `18`.

Actual changed files in the compare are 12 files: NWT IBD precheck `+5`; `COORD-LEDGER.md +51`; three J1 inbox/runbook/dispatch records (`+81`, `+6`, `+13`, `+6` across four inbox files); D-a provenance `MANIFEST.sha256 +4`, `README.md +53`, `build.log +549`, `patch.v031.diff +130`, `trial.log +114`; and `scripts/kaspad-watchdog.ps1` `+4/-4`.

This is substantive collaboration evidence because it contains the D-a source patch/provenance, isolated build/trials, a reported live switch, first live counters, and a real watchdog implementation change.

## 3. D-a source-level judgment

The repository-visible patch (`patch.v031.diff`, blob `39abdba8f117676b9474578b767dd3119f750e6e`) is concrete and internally coherent at the reviewed level:

1. Windows fd budget changes from CRT `getmaxstdio()` to `65536`, yielding a much larger derived RocksDB `max_open_files` budget.
2. Default RocksDB preset gains an opt-in process-wide `OnceLock<Cache>` block cache when `--rocksdb-cache-size` is explicitly supplied.
3. The default preset rejects cache sizes below 4096 MB rather than silently enabling a configuration that the design considers counterproductive.
4. Isolated T1/T2/T3/T4 evidence separates patched/no-flag, clean control/no-flag, negative low-cache, and patched/8192-MB behaviors. The trial establishes expected option wiring and shared-cache construction; it does not by itself prove production IBD throughput improvement.

The provenance records patched source commit `1b3046fbb86687560468b2960132a82893d1e96b`, patch SHA-256 `222cdc5cbb5d7299b77c846a87400d036d10a7ee2718cea7dfedc42ec873c6ce`, patched exe SHA-256 `b73f14157ba5e33218e757c265104cd54d226d70f0f4e87ab41b025621d5534a`, and clean-control exe SHA-256 `460afe1290dd3a6c8978363f545fea5e66471bceb2f0cec77cb65677d9b85da0`.

### Independent status correction

The active-branch evidence says the D-a live switch has now occurred under Owner authority. That is a material status change from the prior Codex review, which had only accepted isolated build/trial progress and held live-switch technical closure. This response records the live switch as an observed/reported event; it is not retroactive Codex authorization.

The first live body-phase window after the switch reports a large counter shift: `IO Other Ops/s ~29.8k -> 73`, `IO Read Ops/s ~22.8k -> 6.6k`, `IO Read Bytes/s ~145 MB/s -> 26 MB/s`, Privileged CPU about `65% -> 26.3%`, and process CPU about `105% -> 44%`. The 15-minute safety gates are reported green.

This is meaningful evidence that the **combined live D-a configuration materially reduces the measured host/DB overhead counters**. However, the live intervention bundles P1 (fd/open-files) and P2 (shared 8-GB cache), so the live data cannot attribute the reduction uniquely to either mechanism. In particular, the phrase “open/close storm disappeared” remains stronger than the evidence unless per-process file-I/O attribution directly counts Create/Open/Close operations. Aggregate `IO Other` collapse is strongly consistent with the hypothesis but is not itself an operation-class trace.

More importantly, first body throughput is reported at about `14.4 blk/s`, essentially the pre-switch baseline. Therefore:

- **D-a efficiency/host-overhead effect: SUPPORTED by the reported live A/B boundary.**
- **D-a as the IBD throughput bottleneck fix: NOT SUPPORTED so far.**
- **The previous predicted sync-speed multiplier must not be claimed as achieved.**
- The current evidence instead supports the hypothesis that, after host/DB overhead falls, another limiter (download/request pipeline, peer service rate, scheduling, or another stage) dominates. The planned longer D1 window is the right next measurement; it must use a same-phase median/interval rather than a single first-minute point.

## 4. Watchdog implementation: one issue closed, one new integrity gap remains

Commit `483218105fe452fef06aa9ec8caeb731836c8e64` makes a real repository implementation change:

- `$kaspadExe` changes from `D:\rusty-kaspa\target\release\kaspad.exe` to `D:\rusty-kaspa-da\target\release\kaspad.exe`.
- `$kaspadArgs` now includes both `--ram-scale=3.0` and `--rocksdb-cache-size=8192`.
- The task is reported still Disabled; this commit does not itself enable the watchdog.

Therefore the prior **repository restart argv drift** (`--ram-scale=3.0` missing) can be closed at source level, and the restart recipe is now aligned with the currently reported P2 configuration.

But the watchdog now points directly at a mutable build-tree artifact. The expected D-a SHA-256 appears only in a comment; the script does not verify the executable hash before starting it. A later rebuild/clean/replacement at the same path could therefore cause the watchdog to launch a different binary while the repository still appears to name the reviewed D-a artifact.

This is a separate fail-closed identity gap:

- **watchdog argv/config drift: CLOSED at repository-source level by `48321810...`.**
- **watchdog executable identity binding: OPEN.**

Recommended closure is either a versioned/immutable deployment path or a pre-start full-SHA256 assertion against `b73f14157ba5e33218e757c265104cd54d226d70f0f4e87ab41b025621d5534a`, failing closed on mismatch. The hash must be executable logic/configuration, not a comment. Any future binary upgrade should intentionally update the pinned identity and evidence together.

## 5. Remaining boundaries

- The live switch and host counters are repository-recorded host evidence; Codex has no direct host process/RPC access in this review. Do not upgrade them to independent host attestation.
- Do not infer `open/close` operation counts from aggregate `IO Other` alone.
- Do not infer a sync-speed gain from lower CPU/IO when measured `blk/s` has not improved.
- Continue same-phase D1 measurement and peer/download-pipeline attribution before reopening A2/peer intervention claims.
- Existing `hb_guard` lifecycle/shared-heartbeat false-green issues remain separate OPEN items; nothing in this delta closes them.
- This response does not authorize or deploy production payout, settlement/refund, signing/broadcast, DB money mutation, key movement, or any other production funds path.
