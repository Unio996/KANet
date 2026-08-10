# Codex review — watchdog config graph follow-up

- reviewer: Codex
- scope: `scripts/tn12-mining-watchdog-v2.ps1` and directly related tests/mutants
- reviewed development commit: `83a9a341290bdf9230ff49fbad5a1e9f57fcec51`
- prior reviewed development base: `eca19cba0ae0ae61110d4c633426c0443f49ef3b`
- bridge baseline before this write: `d08ebe602760de22146d207e8512ad34cf1148b3`
- authority: code/evidence review only; no deployment or production-money-path authorization

## Independent findings

### 1. Prior `TN12_PULSE_SEC` raw-env blocker is CLOSED IN CODE

The new `Get-BoundedEnv` path removes the raw `[int]$env:TN12_PULSE_SEC` startup-crash/domain problem, derives a positive lower bound from the enforced settle default, and enforces an explicit upper bound. `DAA_SETTLE_MS` remains bounded against the validated `PULSE_SEC`, so the previous defect — using an unvalidated quantity to derive another safety bound — is materially fixed.

The composition fixture described in the commit is also directionally correct because it varies the real source quantity rather than injecting a hard-coded `PULSE_SEC` into a settle-only fragment.

### 2. The claim that the whole config dependency graph is now validated is still too strong

The implementation validates each individual integer domain and one cross-variable dependency (`PULSE_SEC -> DAA_SETTLE_MS`), but the control loop contains other cross-variable invariants that are currently unchecked.

#### 2a. Brake/resume hysteresis relation is not enforced

`TIPS_BRAKE` and `TIPS_RESUME` are independently accepted in `[1,100000]`, but the state machine assumes a meaningful hysteresis relation:

- engage when `tips > TIPS_BRAKE` (or trend verdict fires)
- release when `tips < TIPS_RESUME` and `risingStreak == 0`

A valid-domain configuration such as `TIPS_BRAKE=220, TIPS_RESUME=500` defeats that hysteresis. The controller can brake above 220 and then release at a still-high tip level merely because the climb broke and the value is below 500. This can cause brake/release oscillation around a level that is still beyond the intended brake operating point.

Required closure: mechanically validate the relational invariant actually intended by the state machine (normally `TIPS_RESUME < TIPS_BRAKE`, or a stronger documented margin if one is intended), reject an incompatible pair loudly, and fall back to a coherent safe pair. Add executable negatives for equality and inverted ordering.

#### 2b. Pulse efficacy window can be configured out of existence

`MAX_PULSES` and `PULSE_CHECK` are also independently accepted in `[1,10000]`. But tips-efficacy is only checked when:

`pulseCount % PULSE_CHECK == 0`

If `PULSE_CHECK > MAX_PULSES`, the episode can exhaust its entire pulse budget before the tips-efficacy check runs even once. Per-pulse DAA progress still prevents a true wedge from continuing, so this is not the same failure class as the old blind-pulse bug; however, it does disable the separate invariant that repeated pulses must actually reduce tips before the controller spends the whole configured budget.

Required closure: either enforce `PULSE_CHECK <= MAX_PULSES`, or explicitly redefine the semantics so the final/budget edge performs an efficacy check even when the modulo boundary was never reached. Add executable tests for `PULSE_CHECK = MAX_PULSES`, `PULSE_CHECK > MAX_PULSES`, and one normal multi-window case.

### 3. `POLL_SEC` versus `PULSE_SEC` comment/semantics should be made mechanically true or rewritten

The source says the pulse "must stay well under POLL_SEC's cadence so each poll still re-reads tips before deciding again", yet independent bounds allow `POLL_SEC=1` and `PULSE_SEC=120`. Because this loop is synchronous, the actual cadence is pulse + settle + probe + poll, not a fixed timer. If no safety invariant truly depends on `PULSE_SEC < POLL_SEC`, rewrite the comment to match the real control semantics. If it does, enforce the relation. Do not leave a safety-sounding relationship that the accepted config space contradicts.

## Verdict

- `TN12_PULSE_SEC` domain validation: **GREEN / CLOSED IN CODE**.
- `PULSE_SEC -> DAA_SETTLE_MS` composition: **GREEN**.
- whole-config-graph closure claim: **NOT YET PROVEN**.
- `TIPS_RESUME < TIPS_BRAKE` relational hysteresis: **RED / MUST-FIX before deployment**.
- `PULSE_CHECK <= MAX_PULSES` (or equivalent final efficacy semantics): **RED / MUST-FIX before deployment**.
- `POLL_SEC`/`PULSE_SEC` statement: **must be enforced or corrected as documentation/semantics**.

No watchdog deployment/restart, miner operation, refund/settlement, backfill, signer/broadcaster change, production DB mutation, key movement, or production-money-path action is authorized by this review.
