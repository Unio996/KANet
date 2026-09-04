# Codex review — unsynced IBD reconnect 3.73h cost

## Git / blob basis

- Canonical branch checked first: `coord/codex-bridge`.
- Starting/current canonical HEAD before this write: `80bd04070323e1af5ba4999611716290de3eb6c4`.
- Previous processed/written-back canonical baseline: `80bd04070323e1af5ba4999611716290de3eb6c4`.
- Canonical compare: identical; 0 commits, 0 changed files.
- Canonical blobs at that HEAD:
  - `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- No timestamp inside those files was used for increment detection.

Because canonical bridge had no increment, the directly corresponding active development branch was checked.

- Active branch: `bshard-m3-deploy`.
- Previous development checkpoint: `05c6bcdb8f03b8553464b4d3421fb1c0c1e1975d`.
- Current active HEAD: `bc4d94b09d020aef726386be02a5a32fa4f189bd`.
- Actual Git compare: ahead 1, behind 0, total commits 1.
- Actual diff: only `docs/iteration/COORD-LEDGER.md`, +6/-0. No runtime/guard/watchdog/restart implementation changed.
- New coordination commit: `bc4d94b09d020aef726386be02a5a32fa4f189bd`.
- Resulting `COORD-LEDGER.md` blob: `ec0a548891da5059a594e41942382e14d24fe29a`.

## Independent judgment

The new evidence closes the observation portion of the peer-reconnect episode more strongly than the prior partial report:

- header re-sync began about `2026-09-03T20:27:11Z` and body mode returned about `2026-09-04T00:11Z`;
- elapsed time is about 3 h 43 m 49 s = **3.73 h** (the ledger heading's `~3.5h` is only a rough label; the explicit timestamps support 3.73 h);
- block count did not regress and later advanced from 8,746,723 to 8,781,868 after body resumed;
- console PID 34368 and wasm ~4.9 MB remained stable;
- the episode self-recovered without restart or privileged intervention.

Accordingly:

- `IBD transport/session reconnect with header re-sync`: **SUPPORTED**.
- `console crash/restart`: **NOT SUPPORTED** by this episode.
- `chain-state rollback`: **NOT SUPPORTED**; absolute block count did not regress.
- `self-recovery without operator action`: **SUPPORTED**.

The key modeling point is that this episode must **not** be charged mechanically as another copy of the prior ~14.2 h phase cost.

Using the currently cited planning convergence rate of 34.9 lag-minutes recovered per wall-clock hour:

- baseline recovery rate = 34.9/60 = ~0.582 lag-hours per wall-clock hour;
- over 3.73 h, the no-event counterfactual would have reduced lag by about 2.17 h;
- the coarse observed lag moved from ~68 h to ~70 h, i.e. about +2 h;
- therefore the event's incremental lag debt relative to the counterfactual is approximately 2.17 + 2.00 = **4.17 lag-hours**;
- at the same 0.582 lag-hours/h recovery rate, that corresponds to about **7.2 h of additional wall-clock recovery**, not 14.2 h.

However, the lag endpoints are displayed only at coarse whole-hour resolution. A +2 h displayed delta can hide substantial rounding error. Treating the true delta as roughly +1 to +3 h gives an illustrative incremental debt range of ~3.17 to ~5.17 lag-hours, equivalent to roughly **5.4–8.9 h** of wall-clock recovery at 34.9 lag-min/h.

Therefore the defensible status is:

- `3.73h episode duration`: **MEASURED / SUPPORTED**.
- `additional READY cost`: **CONDITIONALLY ESTIMATED ~7.2h center, roughly 5.4–8.9h under coarse lag rounding**, pending higher-resolution DAA/chain-time endpoints.
- `copy prior 14.2h phase penalty`: **REJECTED** for this episode.
- `add the full 3.73h directly to READY ETA`: also **not the correct invariant**; the relevant quantity is lost convergence plus observed lag growth, not duration alone.

For the next recurrence, record entry/exit virtual/tip DAA or a sub-hour chain-time lag metric alongside `{headerCount, blockCount, phase, peer/session identity}`. That would remove the current integer-hour quantization and allow direct event-cost integration.

The fact that `hdrPct` rose monotonically 9→...→100 during this episode is useful operational evidence that the re-sync progressed normally after reconnection, but it still should not be treated as a durable-chain progress invariant by itself. Absolute counts/DAA remain authoritative.

## Existing HOLD items

This coordination-only commit does not close any previously open implementation issue: guard stale-valid sample freshness, privileged kill-target positive identity, full descendant-tree pre/post verification, replacement exact identity/revision/health-ready, repository-resolvable privileged guard source/tests, watchdog persistent monotonic `everSynced` plus discriminating VA vectors, sampler exit-code taxonomy alignment, or durable hb_guard/coordination-watcher lifecycle.

No production-funds path modification, production signing/broadcast, settlement/refund, DB mutation, key movement, privileged restart, or deployment is authorized by this review.
