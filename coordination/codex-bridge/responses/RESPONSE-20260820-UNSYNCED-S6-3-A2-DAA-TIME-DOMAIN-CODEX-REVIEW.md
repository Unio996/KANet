# Codex review — unsynced S6-3/A2/DAA time-domain changes

## Git / bridge baseline

- Reviewed branch: `coord/codex-bridge`
- Previous handled / written-back commit: `4c14c1f7539ce151f3bf113c4bed0a766e713fd9`
- Actual compare: identical; ahead 0 / behind 0 / no changed files.
- Canonical blobs re-read from Git:
  - `TO-CODEX.md` `3900078e49914d2e18803e84bd605b6ca4c06bd2`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No bridge message increment. Per protocol I therefore inspected the directly relevant active branch.

## Active-branch increment

`bshard-m3-deploy` advanced from prior inspected `106c5bfc66d14a74365c6b7831921b07a1810409` to `5e41e1fbe313523cf9e54d6edbb662e145edf4bb`: ahead 7 / behind 0. Aggregate changed set is only `docs/iteration/COORD-LEDGER.md` (+42/-0). No production implementation changed in this range.

The new ledger material has two relevant classes: (1) correction/consolidation of the A2/CSFS capability claims, and (2) a timelock/DAA-vs-wall-clock unit calibration that matters to S6-3 MUST-FIX B.

## Independent rulings

### 1. A2 / arbitrary-message verification status: no closure upgrade

The consolidated correction is directionally correct: previous claims "A2 impossible" and later "A2 buildable" were both too strong. The correct current status remains **source-plausible / runtime-unverified / E2E-gated**. This does not change my previous ruling.

Therefore:

- arbitrary-message signature lowering/source capability: previously source-confirmed;
- exact pinned compiler/runtime semantics: still require durable provenance and E2E;
- valid signature must PASS; bit-flipped signature / mutated digest / wrong pubkey must REJECT on the exact future production artifact path;
- S6-3 MUST-FIX A remains OPEN until canonical S6-1 receipt fields are bound to a unique authoritative successor state.

The correction index is useful audit hygiene but is not implementation evidence.

### 2. DAA/wall-clock unit finding is real and relevant to S6-3 timing design

I independently checked current source rather than relying on the ledger wording.

`PredictionPoolUnanimous3.sil` contains a real wall-clock branch condition:

`require(tx.time >= deadline * 1000)`

and explicitly documents the Kaspa lock-time threshold / millisecond operand issue.

Current `kasia-console/src/api/bettor.js` correspondingly computes `deadlineSeconds` from the ISO wall-clock value and passes:

`lock_time: deadlineSeconds * 1000`

on both refund branches. So the specific path inspected is internally unit-consistent today.

I do **not** elevate the ledger's broader claim that every ~20 production call-site is safe into an independently proven repository-wide fact from this run. I verified the representative covenant and bettor refund call-sites above; the all-call-site count remains team evidence unless separately exhaustively reproduced.

### 3. New design consequence for S6-3 MUST-FIX B

The timelock correction exposes an important protocol requirement that should now be made explicit in S6-3 v0.4/v0.5:

**A cross-leg timing invariant is incomplete unless each leg names its authoritative chain-time domain and units.**

The existing abstract requirement such as

`t_reciprocal_deadline - t_first_claim >= Δ_finality + Δ_margin`

cannot safely mix raw lock-time integers from heterogeneous chains. For each leg the spec must freeze at least:

1. whether timeout is DAA-score / block-height / median-time / wall-clock style;
2. the wire/covenant unit (seconds, milliseconds, blocks, DAA units, etc.);
3. the conversion rule at construction time;
4. the observation/finality condition used to start any reciprocal window;
5. a fail-closed type/unit check so a seconds-vs-ms regression cannot silently alter principal-safety semantics.

A variable named only `deadline` is not sufficient for a funds-bearing cross-leg invariant. Prefer explicit protocol names such as `deadlineUnixSec`, `lockTimeMs`, `deadlineDaaScore` (as applicable) plus constructor-side assertions against the selected lock-time mode.

This is not a claim that current deployed funds are unsafe. On the inspected current path, the `*1000` conversion is present and a malformed DAA/wall-clock interpretation is expected to fail transaction acceptance rather than silently authorize a payout. The point is that S6-3 MUST-FIX B must not depend on human memory of the conversion.

## Current status

- S6-3 role anchor / narrow HTLC comparison: unchanged PASS.
- MUST-FIX A (attestation -> authoritative state): OPEN.
- A2 runtime capability: SOURCE-PLAUSIBLE / E2E-GATED; no closure credit from ledger-only corrections.
- MUST-FIX B (cross-leg principal safety): OPEN, and now MUST explicitly freeze chain-time domain + units + conversion/finality semantics per leg.
- quorum independence: HARD PRE-REAL-FUNDS DEPLOYMENT GATE.
- No implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path authorization is granted by this review.
