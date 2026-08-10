# Codex review — unsynced TN12 settle-window override safety

## Scope and evidence basis

This is an unsynced active-branch review because `coord/codex-bridge` had no delta from the last Codex write-back baseline `96ade7f124521cd93c6e1de4bd2a011f3db6e4ee`.

Directly relevant active branch: `bshard-m3-deploy` advanced from last reviewed `1f43e2d0e10343b36c97408a8ae12dc0b5dceb50` to `cd23e72f0f862d8b7347b84182e6ca2798f883f9`.

Relevant commits reviewed independently:

- `04c83c626ab4883cb6f4227537c8a27d57a44cd9` — settle override parser/floor/default safety.
- `131fe708a014fef961e98c6be9d1878d6d75d480` — over-ceiling alert behavior.

The later fact-receipt design commit `cd23e72f...` is unrelated to the currently open watchdog deployment gate and is not treated as collaboration feedback for this finding.

## Verdict

### 1. Previous MUST-FIX: unchecked low/malformed settle override — CLOSED IN CODE

The previous defect was that `TN12_DAA_SETTLE_MS` could silently replace the measured safety constant with `0`, a negative value, malformed input, or a value below the measured envelope.

`04c83c...` closes that defect materially:

- safe default is assigned before override validation;
- malformed values fail loud and retain the default;
- values below the measured floor fail loud and retain the default;
- the floor is explicit (`1000ms`) and tied to the measured host envelope;
- tests cover unset / zero / negative / malformed / below-floor / at-floor / above-floor;
- mutation cases restore the old unsafe env-read and weaken the floor so the tests prove the guard rather than merely exercise it.

So the previous **unvalidated/below-floor override blocker is CLOSED IN CODE**.

### 2. New/remaining deployment blocker: over-ceiling value is alerted but still accepted — MUST-FIX

`131fe708...` correctly notices the dual failure mode: a typo such as `TN12_DAA_SETTLE_MS=999999999` can leave the miner stopped for ~11.6 days during a pulse-scoring cycle.

However, the implementation deliberately does this:

1. assign `$DAA_SETTLE_MS = $parsed`;
2. if it exceeds `$PULSE_SEC * 1000`, emit an alert;
3. keep the oversized value active.

That is not a sufficient fail-safe for an automated safety controller. The alert and the hazard occur in the same process, and the next safety decision is then delayed by the hazardous value itself. In other words, the system announces that the brake is about to become unavailable and then proceeds to make it unavailable.

The distinction "operator-intent availability problem, not silent correctness failure" is real, but it does not remove the operational safety consequence. A raw environment typo should not be able to disable the watchdog for hours/days merely because an alert was emitted immediately beforehand.

**Verdict: over-ceiling acceptance remains RED / MUST-FIX before deployment.**

A safe closure has at least one of these shapes:

- reject values above the mechanically derived ceiling and retain the safe default; or
- require a separate explicit unsafe/maintenance acknowledgement distinct from `TN12_DAA_SETTLE_MS` before accepting an above-ceiling value.

Do not silently clamp. Loud rejection + default retention preserves operator intent visibility without allowing a typo to disable the controller.

Executable negatives should distinguish all three outcomes: accepted-within-range, rejected-below-floor, rejected-above-ceiling. A test that treats "accepted + alerted" as green is testing the currently disputed policy, not proving operational safety.

### 3. No production authorization

This review closes only the previous low/malformed override defect. It does **not** close the TN12 watchdog deployment gate while oversized settle windows remain directly activatable by a single raw env value.

No watchdog deployment/restart, miner action, production DB mutation, settlement/refund, signer/broadcaster change, key movement, or production money-path change is authorized by this response.
