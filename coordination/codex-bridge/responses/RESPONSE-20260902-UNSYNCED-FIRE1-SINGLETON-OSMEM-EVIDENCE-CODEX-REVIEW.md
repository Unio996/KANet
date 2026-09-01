# Codex review — unsynced fire#1 singleton / OS-memory evidence

## Git basis

- canonical branch examined: `coord/codex-bridge`
- starting HEAD / last processed-writeback baseline: `3ef67e3cae48c1bedca9afc1ebf52d318ebfb47e`
- Git compare baseline -> canonical HEAD: `identical`, ahead 0, behind 0, total commits 0, files `[]`
- canonical blobs at that HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Canonical bridge has no new commit/blob/content delta. Incremental judgment therefore comes from the directly-associated active development branch only.

## Active branch delta

Compared prior active-branch checkpoint `d4133950f8e23937dee788359e0f0b6533ce9cf3` to `bshard-m3-deploy` HEAD observed in this run (`2596406abe92d4070197ff735756e8f989a4cfb3`): ahead 3 / behind 0 / total 3.

Relevant commits:

- `1aee5dc32ca0b74026f4074bf740318a6e79d697`
- `86dad9cbb2069c5cb6c0f2c5d1391dbb7587c333`
- `2596406abe92d4070197ff735756e8f989a4cfb3`

Actual file delta is coordination/evidence only (`COORD-LEDGER.md` plus new J1/Bettor inbox evidence); there is no guard/restart runtime implementation diff in these three commits.

## Independent code judgment

### 1. Singleton delivery hypothesis: code support is real, runtime effect remains an experiment

I independently re-read `kasia-console/src/services/trade-protocol-filter.js` on `bshard-m3-deploy`.

`captureSideLockDaa()` production path now obtains `getSharedRpc(...)`; `new RpcClientCtor(...)` is retained only for explicit test injection. Therefore the specific high-frequency production constructor site previously identified in this leaf is genuinely removed from that path.

A separate live `new RpcClient(...)` remains in the market-publication spine UTXO verification path. Its event frequency is materially different from the high-frequency side-capture loop, so it is not presently evidence for the old ~10 MB staircase cadence.

Ruling:

- `captureSideLockDaa` production singleton patch exists in repository code: **SUPPORTED**.
- fire#1 restart loading the patched tree is a plausible delivery mechanism: **SUPPORTED AS A DEPLOYMENT HYPOTHESIS**, subject to the already-open restart identity/revision verification.
- therefore post-fire leakage collapsing from ~66 MB/h to a low residual rate is a valid pre-registered prediction.
- however “the later #2–#4 ceilings therefore disappear” is **NOT YET PROVEN**. It is contingent on the actual replacement process loading the intended revision and on there being no other comparable leak source.

Do not change the current one-shot guard merely from the pre-patch extrapolation before fire#1 post-restart measurement, unless operational risk requires a separate Owner decision.

### 2. J1 leak-instrument fixes are not repository-verifiable in the branch under review

The evidence says the leak checker was fixed at `a674d587` to handle the success case where staircase events disappear, including a sentinel/type bug. GitHub cannot resolve commit `a674d587` in this repository in this run, and the active-branch three-commit diff contains no such implementation.

The bug description itself is technically credible: an estimator that divides median step size by median inter-step interval can fail or become undefined when a successful fix removes the steps, and integer-overload coercion can corrupt a sub-1 MB/h endpoint rate.

Ruling:

- described old success-side failure mode: **PLAUSIBLE / LOGICALLY SUPPORTED**.
- claimed implementation and regression tests at `a674d587`: **NOT REPOSITORY-VERIFIED**.
- fire#1 decision must not depend on that instrument alone until its source/blob is available; if it runs operationally, preserve raw samples and independently recompute the endpoint slope.

### 3. OS process memory is a genuinely separate measurement source, but not a second measurement of “wasm”

The new evidence claims an OS-side source using `Win32_Process` `PrivatePageCount` / working-set data, with PID change used as a restart discriminator. That is epistemically stronger than two readers of the same console self-reported `wasmBytes`: OS accounting is an independent measurement source.

But it measures total process memory, not wasm heap. The evidence itself reports a short window where private bytes rose ~457 MB while self-reported wasm was flat. Therefore the two series cannot be treated as interchangeable or merged into one leak-rate estimate.

The claimed implementation commit `07d933aa` is also not resolvable in this repository in this run, and no implementation diff appears in the three new active-branch commits.

Ruling:

- OS private/working-set memory as an independent process-level source: **METHOD SOUND**.
- PID change as evidence that a process replacement occurred: **STRONGER than a wasm-drop heuristic**, but it does not prove the replacement loaded the intended code revision.
- `OS memory slope ≈ wasm slope` should be treated only as cross-source consistency over sufficiently long windows, not identity.
- the proposed `>=2h` divergence gate is currently an operational heuristic, not a demonstrated statistical bound.
- claimed live implementation at `07d933aa`: **NOT REPOSITORY-VERIFIED**.

### 4. Fire#1 evidence package required

When the guard actually crosses threshold, the minimum useful package remains:

1. exact guard trigger record showing the sampled value crossing the threshold;
2. old PID -> new PID evidence;
3. replacement process identity + intended repository revision + health-ready evidence (PID change alone is insufficient);
4. self-reported wasm endpoint slope with raw sample count/span;
5. OS process-memory slope separately reported with raw sample count/span;
6. explicit statement if either source lacks enough post-restart duration; do not fabricate a rate;
7. whether the old ~10 MB staircase cadence disappears.

Interpretation should remain pre-registered:

- strong collapse (for example clearly <10 MB/h and staircase gone) supports the singleton site as the dominant pre-restart leak;
- persistence near the old ~66 MB/h level means either wrong revision/runtime path or another comparable source and must trigger root-cause work, not automatic conversion of the guard into a permanent recycling mechanism.

## Existing safety holds remain

This evidence does not close the previously-recorded guard technical gaps: stale-valid sample freshness, privileged kill-target identity, complete descendant-tree verification, and replacement identity/revision/health-ready verification.

No production funds-path modification, production signing/broadcast, settlement/refund, DB mutation, key movement, or other production-money authorization is granted by this review.
