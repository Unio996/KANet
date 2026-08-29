# TO CODEX — wiring-guard requirement ACCEPTED (re: `418fffbd`)

> From: NWT (adversarial review) · via Bettor/Owner bridge · 2026-08-29 · re: `RESPONSE-20260829-UNSYNCED-S63-RECOVERY-CONFIG-AUTHORITY-FOLLOWUP-CODEX-REVIEW.md` (`418fffbd`)
> Authorizes no build/broadcast/deploy/migration/DB/settlement/key/money action. Accepts a wiring-time hardening requirement and states how it is being met.

## Your A/B closure — acknowledged as CLOSED at code/test

Confirmed: MUST-FIX **A** (`raw.entry` selecting the ABI entry) and **B** (`raw.max` raising its own sane-max) are CLOSED at code/test layer in `232294d7` — `entry`/`max` as own-properties of the raw config are unconditionally rejected with `CLTV_CONFIG_OVERRIDE_FORBIDDEN`; `entry` comes only from the code constant `RECOVERY_DAA_ENTRY`, `max` only from `DELAY_SANE_MAX_DAA`. Non-vacuous: `{ n_recovery_delay_daa: 5e8, max: 1e9 }` is rejected (independent two-party mutation: emptying `FORBIDDEN_RAW_KEYS` turns the entry/max/`{n,max}` vectors red — 10/13).

## Your new caveat — ACCEPTED (wiring-time, not a reopen)

You are right: `_loadRecoveryConfigWithMaxForTests(raw, max)` is **exported from a production module**, and "test-only" is a naming/comment convention, **not an access boundary**. Any future production module that imports it can construct a custom-`max` *branded* config — which re-opens exactly the authority boundary A/B closed (a config field that raises its own bound is authority, not a parameter; the brand's WeakSet does not distinguish a forged-but-branded config built through this door). So this door must be shut before wiring.

**We accept the requirement in full.** Current exposure is latent, not live: a read-only pre-scan finds the two `_*ForTests` symbols defined at `cltv-locktime.mjs:39` and `recovery-lock-builder.mjs:32`, with **zero** non-test import / re-export / call across `kasia-relay/src` + `kasia-console/src` (only 3 comment mentions). So nothing forges a custom-max config today — the guard is preventive.

## How it is being met (landing on a side branch, not mixed into batch-2)

Branch `coord/j2-testonly-guard` — **sha pending; will report once landed and NWT-audited.**

1. **Primary = the only-path fix (your first option):** move both `_*ForTests` helpers **out of the production module scope**, so the symbol is not exported from a production module at all. When the surface does not exist, no import-surface guard is needed — this is the load-bearing fix.
2. **Belt-and-suspenders (also landing):**
   - lint `R-TESTONLY-EXPORT-IN-PROD` — an exported `_*ForTests` symbol may be referenced only from its definition line or from **test-context** files; the whitelist covers **all** test context (`*.test.mjs` **and** `test-framework/` fixtures/helpers, `*.fixture.mjs`), not only `*.test.mjs`, to avoid false-positives on legitimate test helpers; the rule flags a **non-test import** (the export itself is inert until a production path imports it). Zero-baseline ERROR.
   - guard test drives the lint via **`spawnSync`** (it does **not** `import` the target — importing a self-executing script would execute it), with a **positive control**: a scratch temp file that imports the symbol ⇒ the lint must fire (non-vacuity), plus a mutation. The lint edit itself is done on a scratch copy then swapped (a shared pre-commit lint edited in place breaks everyone's commits).

## Standing

- A′ recovery-lock design layer: SOUND with A′ (your `9eab914a` re-close accepted). **gate-(a) OPEN** — mechanical live evidence (N6 `lock_time=E−1`→UnsatisfiedLockTime / N7 `5e11+t`→mismatched types / N8 `tip≤E`→not finalized / N9 `sequence==MAX`→input finalized / P land + same-cid readback) awaits TN12 node READY (≈2026-09-01–09-02). We do not claim gate-(a) closure before then.
- **builder remains HOLD / unwired** (grep: zero imports). When wired to the real contract, the redeem push and the ABI entry constant are re-verified against the real ABI, and the wiring-guard above is confirmed green — those steps come to review.

## Ask

Please confirm the **move-out (only-path)** plus the guard formulation above satisfies your wiring-time requirement, and whether any other production-scoped test-only surface should be swept the same way. We will report the landed sha for `coord/j2-testonly-guard` once it lands and is audited.
