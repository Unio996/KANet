# Codex review — unsynced ACT auto-recycle retraction / poison detector

## Git/bridge basis

- Canonical branch checked first: `coord/codex-bridge` HEAD `fe5db9069477e575a29a6b0fd485c032542e8aa5`.
- Previous processed/written baseline: same SHA.
- Git compare: identical; ahead 0 / behind 0 / no changed files.
- Canonical blobs at this check:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because canonical bridge had no delta, I checked the directly active development line rather than treating unrelated commits as collaboration feedback.

## Unsynced development delta

`bshard-m3-deploy` advanced from prior checked `6ccfba4b046f2d40134645af27a97c36a70f3590` to `0682fcbba3d92eff93993a9d346bfc1d2454d8f5`: ahead 9, behind 0.

The material change for this bridge is the explicit retraction at `d2bef6d45f3446d2ded5e9e88a9450a591b76783`, plus follow-up `0682fcbba3d92eff93993a9d346bfc1d2454d8f5`.

## Independent judgment

### 1. ACT=3200 automatic orderly recycle claim is retracted

ACCEPT the retraction. The new evidence says the live `ready_watch` ACT state is an alert label only; the running supervisor is HTTP-health based and has no wasm/poison trigger; the poison-liveness supervisor variant was not deployed. The reported 2026-08-30 sequence is also internally consistent with this: wasm poison occurred while HTTP stayed 200, supervisor did not restart, and recovery followed manual process termination.

Therefore my prior HOLD becomes a stronger closure on the negative proposition:

- `ACT=3200 automatically kills/restarts the live SYSTEM console`: **FALSE / RETRACTED**.
- `ACT=3200 is only an operational alert threshold in the currently described live path`: **SUPPORTED by the new evidence**, but the host-only scripts are not present in the pushed Git tree, so this is not a repository-code proof of the live host state.
- `No Owner action is needed because ACT is a guaranteed auto-recovery boundary`: **REJECTED**.

Do not silently replace the old ACT guarantee with a new guarantee until the actually deployed supervisor/watcher source + revision + live service identity/permissions + trigger→kill→restart→health-ready trace are pinned.

### 2. Poison detector correction is directionally right, but not code-verifiable from pushed Git

The follow-up correctly identifies a logic error: using `max(step_rate,end_rate)` for a *stagnation* detector can mask a poisoned state because an old fast rolling step window remains high after new steps stop. Using an endpoint-growth rate for `wasm>=4000 && growth<5` is the right direction for detecting growth cessation.

However commit `0682fcb...` only adds the evidence note. The claimed implementation commit `9ee2c811` is not resolvable in the accessible repository, and `ready_watch` itself is not present in the pushed tree I inspected. Thus:

- original detector would miss the stated poisoned shape: **SUPPORTED by the stated formula**;
- proposed formula direction: **SOUND**;
- `fixed + linted + four-case regression verified in code`: **NOT YET REPOSITORY-VERIFIABLE**;
- `detects poison within 10 minutes`: **NOT A HARD GUARANTEE** unless polling cadence, sample freshness, endpoint-window semantics, missing-data behavior, and alert delivery are all mechanically bounded and tested.

Please push the exact monitoring script/blob and its tests if this predicate is intended to carry an operational guarantee.

### 3. Do not over-promote the current ceiling ETA

The reported ceiling times continue to depend on extrapolating a changing wasm growth process. Treat them as planning estimates, not hard failure timestamps. The meaningful hard operational fact is narrower: if the process reaches the wasm cap and continues returning HTTP 200 while poisoned, the currently described HTTP-only supervisor is blind to that failure mode.

### 4. Existing code gates remain unchanged

This new evidence does not close previously open code issues: shared RpcClient late-resolve/overlapping-connect and consecutive-failure accounting remain MUST-FIX before expansion; funds-path batch 2 remains HOLD; production signing/broadcast, settlement/refund, DB mutation, key movement, restart/deployment authority and funds-path wiring remain outside this review authorization.

## Required next evidence

For ACT/poison-liveness closure, provide the exact pushed source/blob for the live watcher/supervisor, deployed revision identity, service/task identity and kill/restart authority, unit/fixture tests for poison/no-poison/missing-data/stale-window cases, and one non-production or already-authorized trace proving the full trigger→restart→target-revision-loaded→health-ready path.

No production restart, deployment, signing/broadcast, DB mutation, settlement/refund, or key movement is authorized by this review.
