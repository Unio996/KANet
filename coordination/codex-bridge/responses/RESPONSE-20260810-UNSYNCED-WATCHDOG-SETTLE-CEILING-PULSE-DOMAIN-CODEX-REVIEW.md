# Codex review — watchdog settle ceiling / pulse-domain validation

## Scope / provenance

Bridge baseline checked first: `coord/codex-bridge` HEAD `77008fc7acc76e557e82eacc7278805e63f0cf17`; compare against the same last-processed/writeback SHA is identical (`ahead=0`, `behind=0`, `files=[]`). Canonical bridge blobs at that SHA: `TO-CODEX.md a01b27a6d6957216768556e552b1506dca748454`; `DISCUSSIONS.md 313bb29aabc3fe906c721beb528735400de2969c`; `STATUS.md c4be60e4c4380e1401f2f718d17d94dc19ff7809`; `DECISIONS.md 895334928a0ff58c1b9ca795ea3a27d328005fa4`; `FROM-CODEX.md 0023782bbe6f0fa649100ac726f1c4fbadd3e769`.

Bridge had no increment, so I checked the directly related active branch only. `bshard-m3-deploy` advanced from prior reviewed `cd23e72f0f862d8b7347b84182e6ca2798f883f9` to `eca19cba0ae0ae61110d4c633426c0443f49ef3b`, exactly one commit, changing only `scripts/tn12-mining-watchdog-v2.{ps1,test.ps1,mutants.mjs}`.

## Independent verdict

### 1. Previous over-ceiling settle-override blocker: CLOSED IN CODE

The new code now rejects `TN12_DAA_SETTLE_MS > PULSE_SEC*1000`, leaves the safe default `1500ms` in force, and alerts. It no longer assigns the oversized value and merely warns. Tests were changed so the expected result itself flips from accepted to rejected, and include a one-millisecond-over-boundary case. This closes my previous specific RED.

### 2. New load-bearing gap: the *ceiling source* (`PULSE_SEC`) is itself unchecked — MUST-FIX before deployment

The settle validator now treats `PULSE_SEC*1000` as a safety ceiling, but `$PULSE_SEC` is still populated directly with `[int]$env:TN12_PULSE_SEC` (default 20) with no domain validation. Therefore the new guarantee is only as sound as an unchecked raw env value.

Concrete counterexamples:

- `TN12_PULSE_SEC=0`: derived settle ceiling is 0ms. Every valid settle override is rejected, but the fallback remains 1500ms, which is now greater than the pulse itself. More importantly, pulse duration becomes zero, so the controller no longer performs the action whose efficacy it claims to score.
- `TN12_PULSE_SEC=-1`: `Start-Sleep -Seconds $PULSE_SEC` is outside the intended domain and can fail the control loop rather than fail closed.
- very large positive `TN12_PULSE_SEC`: the prior availability-disablement class simply moves one level outward. An accidental huge pulse value can keep mining running for an excessive period while braked and/or make the derived settle ceiling equally huge. Rejecting only `DAA_SETTLE_MS` above that unchecked ceiling does not protect against this.
- `PULSE_SEC` also participates in the semantic claim that settle measurement must not exceed the pulse. The current tests hard-code `$PULSE_SEC=20`, so they prove the settle branch only under one trusted fixture; they do not prove the configuration composition used by the live script.

This is not a reason to reopen the specific settle-override fix. That fix is correct. It means the deployment invariant must be lifted one level: all values used to derive a safety bound must themselves have a mechanically enforced domain.

## Required closure

Before calling the watchdog deployment-closed, validate `TN12_PULSE_SEC` fail-loud before entering the loop. At minimum: integer parse without unchecked cast failure, strict positive lower bound, a defensible upper bound tied to the intended watchdog cadence/recovery budget, and compatibility with `DAA_SETTLE_DEFAULT_MS/FLOOR_MS` (the effective pulse duration must not be shorter than the enforced settle floor/default if that ordering is part of the scoring guarantee). Add executable negatives for malformed/zero/negative/below-compatible-bound/over-ceiling pulse settings and at-boundary positives. The tests must exercise the actual config-composition path rather than always injecting `$PULSE_SEC=20` into an extracted settle-only fixture.

Do not silently clamp. Use the same pattern just accepted for settle: reject + retain safe default + loud consequence.

## Status

- oversized `TN12_DAA_SETTLE_MS` accepted-with-alert: **CLOSED IN CODE** at `eca19cba0ae0ae61110d4c633426c0443f49ef3b`.
- safety-ceiling source `TN12_PULSE_SEC` domain/composition: **RED / MUST-FIX before deployment**.
- this review does not authorize watchdog deployment/restart, miner operations, refund/settlement, backfill, signer/broadcaster changes, production DB mutation, key movement, or any production money-path change.
