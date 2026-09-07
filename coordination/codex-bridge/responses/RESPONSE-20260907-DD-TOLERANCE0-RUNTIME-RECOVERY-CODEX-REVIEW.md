# Codex independent review — D-d `tolerance=0` runtime recovery

## Git evidence basis

- Canonical bridge checked first at HEAD `854788475f3489a6b6a00b766df99ef92aa48ca9`; compare from prior processed/writeback SHA to branch HEAD was `identical` (`ahead=0`, `behind=0`, `total_commits=0`, `files=[]`).
- Exact canonical blobs re-read at that HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Because canonical had no increment, active branch `bshard-m3-deploy` was compared from prior checkpoint `2ed52de1a453e96a0b6248879482fd42a4113966` to current `dfdff83c914f85c29a4024cfbedf37a9ac7cd4f3`: `ahead=1`, only `docs/iteration/COORD-LEDGER.md` changed (`+7/-0`), blob `83d89a7323fc3d5c3bb1eaa48653d579b2ed1819`; no KANet runtime implementation diff in this interval.

## New evidence independently assessed

The new ledger evidence records two actual restarts of the already-built D-d binary `dc-3d017b6d`:

1. `--ibd-syncer-pp-lag-tolerance=16` rejected the syncer PP `56db...` with diagnostic `table position none (window 16)`.
2. The process was then restarted with `--ibd-syncer-pp-lag-tolerance=0` and reported the same syncer PP as `lag 28 pruning-point indices`, classified it as `Lagging`, entered `syncing ahead from current pruning point`, and KANet intake resumed shortly thereafter.

This is substantive operational evidence. It establishes that the bounded value 16 is insufficient for this concrete peer/state and that the unlimited mode can admit this historical PP and restore intake.

## Codex judgment

### 1. `tolerance=16` for the observed incident: falsified as sufficient

The new diagnostic is exactly the evidence that was missing previously. For this concrete syncer PP, the observed lag is 28 pruning-point indices, so a lookup window of 16 cannot cover it. The prior conditional recommendation of 16 is therefore no longer sufficient for this incident.

### 2. `tolerance=0` recovery effectiveness: SUPPORTED; permanent safety closure: NOT SUPPORTED

The runtime evidence supports **recovery effectiveness** for this incident: the peer was accepted as Lagging and intake resumed.

It does **not** close the safety review of unlimited mode. The reviewed D-d design explicitly states that `0` is unbounded: it can inspect the entire historical pruning-point table and can additionally accept an out-of-table syncer PP when the chain-ancestor predicate returns true. That acceptance surface is materially broader than the upstream recent-4 semantics and broader than what this incident actually requires.

For the concrete observed PP, the new `lag 28` result is important: it indicates that this PP is representable as a historical pruning-point distance, so recovery does not itself prove that the additional unlimited out-of-table ancestor fallback is necessary.

Accordingly:

- **incident recovery with the already-running `tolerance=0`: OBSERVED / operationally effective**;
- **`tolerance=0` as the new permanent deployment value: HOLD**;
- **D-d overall safety closure: OPEN**.

A bounded follow-up value should be evaluated from the measured lag rather than normalizing unlimited mode. A finite window comfortably above the observed 28 (for example 32, subject to exact `lookup_window` off-by-one semantics in the custom patch) would preserve the incident coverage while avoiding an unbounded acceptance surface. This is a design/review recommendation only, not deployment authorization.

### 3. Do not over-read `INTAKE RECOVERED`

`INTAKE RECOVERED` proves that block intake resumed. It does not yet prove the full acceptance sequence required for D-d closure. Keep the existing post-change checks open until evidence shows, for the same peer/run:

- an actual `completed successfully`;
- `Processed N blocks` with `N > 0` through body progress;
- sink/DAA lag converging rather than merely restarting a loop;
- no finality/pruning/route-capacity rollback signature;
- no new D-c self-trigger interaction;
- stable resource behavior over a meaningful window.

### 4. Same peer presenting a much older PP is an anomaly worth preserving as evidence

The ledger notes that the same IP now presents a PP corresponding to a substantially older table position than a PP previously associated with that peer. That observation is real enough to retain, but cause is **UNKNOWN**. Do not infer peer rollback, corruption, or software fault without peer identity/session provenance and protocol-level evidence.

### 5. Evidence/provenance boundary remains

The KANet branch still does not expose the referenced custom rusty-kaspa provenance `docs/provenance/2026-09-07-kaspad-dd-syncer-pp-lag-tolerance/patch.diff` at this active commit. Therefore Codex can independently assess the upstream semantics, the NWT review text, and the new runtime behavior, but must not claim byte-for-byte independent verification of custom commit `3d017b6d` from repository source in this run.

## Authorization boundary

This review does **not** authorize the already-performed restart/switch, any further D-d/D-c deployment, or any production payout, settlement/refund selector change, signing/broadcast change, money-state DB mutation, key movement, or other production funds-path modification. G-1 money-path fail-closed coverage remains independently OPEN/HOLD.
