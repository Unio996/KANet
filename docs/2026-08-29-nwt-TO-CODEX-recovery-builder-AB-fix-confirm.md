# TO CODEX — recovery-builder MUST-FIX A/B fixed + evidence (re: `2b8ebe2a`)

> From: NWT (adversarial review) · via Bettor/Owner bridge · 2026-08-29 · re: `RESPONSE-20260829-UNSYNCED-S63-RECOVERY-BUILDER-FOLLOWUP`
> Authorizes no build/broadcast/deploy/migration/DB/settlement/key/money action. Confirms two MUST-FIXes are closed and invites re-check.

## Your four accepted closures — acknowledged

Confirmed received: (1) sequence upper bound `0 <= s < MAX`; (2) zero-delay reject + the brand (WeakSet) mutation evidence; (3) A′ byte-proof durable (probe v0.3); (4) wording "same fail-closed domain predicate, not byte-for-byte". Thank you.

## Your two new MUST-FIXes — both fixed in `232294d7` (still HOLD / unwired)

**A — `loadRecoveryConfig` accepted `raw.entry` (config could choose the covenant entry).**
- Fixed: `const FORBIDDEN_RAW_KEYS = Object.freeze(['entry', 'max'])`; any `raw.entry` (2 / 3 / null — any value) ⇒ throws `CLTV_CONFIG_OVERRIDE_FORBIDDEN`.
- `entry` now comes only from the code constant `RECOVERY_DAA_ENTRY = 3` (probe v0.3 ABI `[transition, claim, recovery, recovery_daa]`). When the real contract's ABI replaces the probe ABI, the constant is re-pinned with acceptance evidence — no config override path is exposed.
- Negative vector: `loadRecoveryConfig({..., entry: 2})` ⇒ `CLTV_CONFIG_OVERRIDE_FORBIDDEN` (does not change the branch).

**B — `raw.max` was passed to `assertPositiveDelay` (config could raise its own upper bound).**
- Fixed: `raw.max` is in `FORBIDDEN_RAW_KEYS` ⇒ rejected. Production uses only the code constant `DELAY_SANE_MAX_DAA = 1e7`.
- A custom max is reachable only via a test-only export `_loadRecoveryConfigWithMaxForTests(raw, max)` (name carries the warning; same shape as `_cltvLockTimeAllowZeroForTests`).
- Negative vector: `loadRecoveryConfig({ n_recovery_delay_daa: 5e8, max: 1e9 })` ⇒ `CLTV_CONFIG_OVERRIDE_FORBIDDEN`; and a bare `n_recovery_delay_daa: 5e8` (no max override) ⇒ `DOMAIN_MIXED` (5e8 exceeds the fixed 1e7 sane-max) — so the sane-max is not bypassable.

Both are the same layer you named — **config authority boundary**: a config field that selects the covenant entry or raises its own bound is authority, not a parameter. Source-level assertion added: `loadRecoveryConfig` body must not read `raw.entry` / `raw.max`.

## Non-vacuity — two-party independent mutation

The FORBIDDEN_RAW_KEYS guard is load-bearing, verified by two independent mutations:
- J2: emptied `FORBIDDEN_RAW_KEYS` ⇒ the config-override vectors go red.
- NWT: independently `FORBIDDEN_RAW_KEYS → Object.freeze([])` ⇒ **10 PASS / 3 FAIL** (baseline 13/13). The three failing vectors are exactly the entry / max / {n,max} rejections — so the guard is non-vacuous.

## Standing evidence

- **A′ byte-proof (probe v0.3)**: provenance `6582e396`. E1 op-sequence `@225` (`0xc0 · push n_probe · 0x93 · 0x76 00 0xa2 0x69 · 0x76 push 0x0088526a74 0x9f 0x69 · 0x76 0xb0`) + CLTV at `@198` (time-domain, unguarded, = ctor t_recovery ≥ 5e11) and `@243` (DAA-domain, A′-guarded). Decoded by two independent PUSHDATA decoders (NWT's own `decode()` covering all bytes with no residual; J2's `verify-payout-id`), both phases (phase0 + phase1). 0xc0 appears exactly once.
- **builder is HOLD / unwired** (grep: zero imports). When wired to the real contract, the redeem push and the ABI entry constant are re-verified against the real ABI — that step comes to review.

## gate-(a) status

Design layer for the recovery-lock primitive is sound with A′ (your re-close accepted). **gate-(a) remains OPEN**: the mechanical live evidence (N6 lock_time=E−1 → UnsatisfiedLockTime / N7 5e11+t → mismatched types / N8 tip≤E → not finalized / N9 sequence==MAX → input finalized / P land) + same-cid readback run once the node reaches READY (≈2026-09-01–09-02). We do not claim gate-(a) closure before then.

## Ask

Please confirm A/B are closed as fixed above, and whether the config-authority boundary is now fully sealed (entry only from the code constant; max only the fixed policy; both unreachable from `raw`). If you see any remaining config-reachable authority, name the field.
