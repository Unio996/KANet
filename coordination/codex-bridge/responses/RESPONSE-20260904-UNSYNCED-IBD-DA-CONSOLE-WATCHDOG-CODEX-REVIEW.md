# Codex review — unsynced IBD D-a / console / watchdog evidence

## Git basis
- canonical branch checked first: `coord/codex-bridge`
- last processed / write-back SHA: `98fd423546a54b51d999006fc450819f8eaeec6e`
- current canonical HEAD before this write: `98fd423546a54b51d999006fc450819f8eaeec6e`
- real compare: identical; ahead=0, behind=0, commits=0, files=[]
- canonical blobs re-read from that SHA:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge had no delta, so the active branch was checked. `bshard-m3-deploy` advanced from prior checkpoint `5502907e043aa2cddff87c456b048a720f192509` to `84474130a58694cd0320b995cb3bbce57156c4ce`: ahead=18, behind=0. Actual changed files are only:
- `docs/2026-09-04-NWT-redteam-ibd-acceleration-precheck.md` +23/-0
- `docs/2026-09-05-bettor-ibd-acceleration-design-v0.2.md` +34/-0
- `docs/iteration/COORD-LEDGER.md` +38/-0
- `docs/iteration/j1-inbox/2026-09-04T18-25Z-bettor-D-a-recompile-runbook-ask-and-watchdog-file-align-and-restart-window-rule.md` +5/-0

There is no KANet runtime implementation diff in these 18 commits.

## Independent review

### 1. Console headless log archive: live-path evidence now exists
Ledger 829 reports a real supervisor-driven console restart and the first real creation of `console.log.prev-20260904T184129Z`. This upgrades the earlier archive change from code-review-only to **LIVE-PATH SUPPORTED** for the narrow invariant “a supervisor restart can preserve the previous console log”. It does not prove archive correctness for every failure mode, nor does it close monitor lifecycle/heartbeat issues.

### 2. `hb_guard` lifecycle remains fragile and is not closed
The same incident reports `hb_guard` exiting, then needing re-arming; one chained `nohup` form was reaped and a `Start-Process` attempt failed because of PATH/environment handling before a standalone `nohup` form worked. This is additional operational evidence that the current guard is not a durable supervisor/service lifecycle. The bounded-expiry issue and guard-vs-console heartbeat separation remain OPEN.

### 3. D-a build isolation is acceptable; switch/deploy remains HOLD
Owner approval recorded here is approval to **build in isolation**, not technical authorization to replace the live kaspad. The stated build discipline (separate clone/target, patched exe plus clean control exe, do not touch live exe, preserve provenance) is appropriate.

However the actual rusty-kaspa patch/build refs (`003875b0`, patch `d8565ef6…`, clean control `7b1e18cc`) are not repository-resolvable from the canonical KANet branch in this review. Therefore the concrete source diff, compile result, produced binary hashes, and VA still require independent evidence before any switch. **No production/live binary replacement is authorized by this review.**

### 4. R2 wording still overclaims the evidence
The new design calls the RocksDB `max_open_files=3,568 < 17,402 SST` path and “every-read open/close storm” an **established structural root cause**. The repository evidence supports a strong mechanism candidate and a plausible optimization target, but these 18 commits still do not contain direct ETW/WPA (or equivalent per-process file-I/O) attribution proving actual Create/Open/Close frequency or that it accounts for the claimed fraction of `IO Other` / kernel time.

So current status should remain:
- fd/open-file pressure mechanism: **SUPPORTED**
- `max_open_files`/cache D-a as a reasonable experiment: **SUPPORTED**
- literal “every read causes open/close storm” and R2 as proven dominant root cause: **NOT YET PROVEN**
- projected `1.4–1.7x` block rate / `~3x` catch-up rate: **MODEL / CONDITIONAL**, not acceptance evidence

The NWT safeguards are good: opt-in behavior, shared `OnceLock` cache, explicit low-cache rejection rather than silent clamp, bounded memory rollback thresholds, and patched-vs-clean control builds. Those reduce experiment risk but do not substitute for live A/B measurement.

### 5. Restart timing evidence supports cheap restart relative to reconnect, not automatic benefit
The documented comparison that a full process restart adds only roughly ~80 s beyond an in-process reconnect is useful for planning. It supports using an already-occurring header/reconnect episode as the least-cost window **if a separately approved binary switch is needed**. It does not itself justify initiating a restart, and it does not prove the new binary will improve IBD.

### 6. Watchdog argv drift remains a must-fix-before-watchdog-restart item
The J1 inbox correctly preserves the earlier requirement: repository-controlled watchdog args must be aligned with the actual intended live argv, including `--ram-scale=3.0`, without restarting merely to achieve config alignment. A privileged read of the live process CommandLine is still required to close the live-side evidence. Do not let watchdog restart a process from stale repository argv.

### 7. Scanner experiment remains confounded
The post-Scanner-stop window overlaps a header re-download phase, so the observed event-loop-lag increase cannot be attributed to Scanner removal. The ledger correctly labels this mixed window as non-causal. Re-test only with same-phase A/B windows if the question still matters.

## Status / holds
Continue HOLD on live D-a switch until: source patch and clean-control diff are independently reviewable; binary hashes/provenance are committed; compile/config smoke tests pass; watchdog/launcher single-owner preconditions are closed; rollback artifact and exact old/new argv are recorded; and same-phase post-switch measurements test the claimed IO/kernel/block-rate effects.

No production money-path, signing/broadcast, settlement/refund, DB money mutation, key movement, or live kaspad replacement is authorized here.
