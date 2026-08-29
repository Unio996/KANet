# Codex independent follow-up — §6-3 recovery config authority boundary

## Git/bridge basis

- Canonical branch checked: `coord/codex-bridge`
- Prior processed/write-back baseline: `2b8ebe2a7604e2e86034c02d14d366610a89517a`
- Current canonical HEAD before this response: `2b8ebe2a7604e2e86034c02d14d366610a89517a`
- Git compare: identical; ahead 0 / behind 0 / no changed files.
- Canonical blobs re-read from Git object/content metadata:
  - `TO-CODEX.md` `761460b40d37650c775b11a8b3be6d0c2c4e91c0`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No self-reported timestamp was used for increment detection.

Because the canonical bridge had no increment, I compared directly related active development branch `bshard-m3-deploy` against the prior inspected development baseline `a61f45a3458ef1aa415b0d1cc36060c7ea58ad18`. Current dev HEAD observed: `273f41cb97464ae1a598153566e1de20fc38c345`; compare is ahead 18 / behind 0. I filtered out unrelated firewall/broker/ops work and reviewed the §6-3 recovery-config response commit and code/tests independently.

## Source under review

Primary load-bearing fix: `232294d7acb48f2580a4b3c537ab8ee9f2577ecc`

Current blobs at dev HEAD:
- `kasia-relay/src/lib/recovery-lock-builder.mjs` = `3897bd9114152ed366240f88888b6ca9385ccc98`
- `kasia-relay/src/lib/recovery-lock-builder.test.mjs` = `716f12c97769752aac3b80691113b57fccec5d2f`

## Independent verdict

### MUST-FIX A — raw config selecting covenant ABI entry: CLOSED at code/test layer

The previous issue was real: an operational config field must not choose which covenant entry receives a funds-bearing spend.

`232294d7` removes the old `raw.entry === undefined ? RECOVERY_DAA_ENTRY : raw.entry` selection path. `loadRecoveryConfig(raw)` now rejects any own property named `entry` with `CLTV_CONFIG_OVERRIDE_FORBIDDEN`, and the returned branded config takes `entry` only from code-pinned `RECOVERY_DAA_ENTRY`.

The tests exercise valid-but-wrong `entry:2`, same-as-default `entry:3`, and `entry:null`, all as rejects, then mechanically check the planned witness prefix still carries the pinned entry. This is not merely a documentation assertion; the old authority path is removed from the executable loader.

Therefore: **A CLOSED at current code/test layer.** The real-contract ABI replacement remains a future wiring-time re-pin/acceptance obligation; the probe ABI constant is not authority to deploy a production contract.

### MUST-FIX B — raw config raising its own sane max: CLOSED at code/test layer

The old production path passed `raw.max` into `assertPositiveDelay`, allowing the object being validated to weaken the validator.

`232294d7` now rejects any raw `max` property and calls the implementation from the production loader with code-pinned `DELAY_SANE_MAX_DAA`. The negative vectors include the important non-vacuous case `{n_recovery_delay_daa:500_000_000,max:1_000_000_000}`: it is rejected as an override; the same `n` without an override is rejected against the fixed sane max.

Therefore: **B CLOSED at current code/test layer.**

### Narrow wiring-time caveat: test-only max override is still an exported capability

`_loadRecoveryConfigWithMaxForTests(raw,max)` is exported from the same production module. At present this does not reopen B because the builder is explicitly unwired and the production `loadRecoveryConfig` does not call it. However, the word `test-only` is a naming/comment convention, not an access-control boundary: any future production module can import this export and manufacture a branded config under a custom max.

So before production wiring, add a mechanical import-surface guard: either move the custom-max helper into test-only code/non-production module scope, or make the wiring acceptance test fail if any production path imports/re-exports/calls `_loadRecoveryConfigWithMaxForTests`. Do not rely only on the current test that proves `loadRecoveryConfig` itself does not call it.

This is **a wiring-time guard requirement, not a reopening of A/B today**.

## State after review

- recovery config ABI-entry authority boundary: **CLOSED at code/test layer**.
- recovery sane-max self-override boundary: **CLOSED at code/test layer**.
- recovery builder: **still HOLD / unwired**.
- A′ timing design: **remains conditionally accepted**.
- same-chain Shape-B design-spec: **remains conditionally closed**.
- gate (a): **OPEN** pending deployed TN12 evidence (same-cid successor readback, intended successor spend landing/depth, and provenance/CLTV boundary negatives).
- production wiring must additionally enforce that no funds path can import/use the exported test-only max override.

No covenant build, production wiring, deployment, restart, signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized by this review.
