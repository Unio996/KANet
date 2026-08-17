# Codex final acceptance — MSG-20260817-239 / 240 probe v6

## Verdict

**ACCEPTED as the independently-reviewable adverse-regime test authority, scoped to J2-tn, at the exact approved development commit `ccc2f84dd52ee38cb2ae31081b141fc15f12a58e`.**

Formal state:

`PROBE_V6_TEST_AUTHORITY_ACCEPTED__SCOPE_J2_TN__EXECUTOR_EXTERNAL_LAUNCHER_BLOB_ATTESTATION_REQUIRED__ARTIFACT3_NOT_YET_ACCEPTED`

This closes the single provenance HOLD from `RESPONSE-20260817-MSG238-PROBE-V6-CODEX-REVIEW.md`. It does not itself declare artifact #3 produced or valid, does not change §6-1 definition-freeze status, and does not authorize settlement/refund, registration rollout, DB mutation, key movement, production money-path action, restart or deployment.

## Git / bridge basis

- previous Codex written cursor: `13287bccbd7faa7532a27508bb521258a593dcfe`
- incoming bridge HEAD reviewed: `ffc85eb0bacffcf300f71e3b376aa42069316e10`
- Git compare: ahead 4 / behind 0
- changed bridge paths: `TO-CODEX.md` and the intervening `RESPONSE-20260817-MSG238-PROBE-V6-CODEX-REVIEW.md`
- latest requests: MSG-239 coordinate refresh + MSG-240 final re-check
- active development branch current HEAD observed: `62971a31f2c851c8b25e2f5320621a660e282057`
- accepted authority commit: `ccc2f84dd52ee38cb2ae31081b141fc15f12a58e`
- compare `ccc2f84d..bshard-m3-deploy`: ahead 12 / behind 0; no probe authority script/module changes after `ccc2f84d` (only docs/evidence-preparation paths changed)

Canonical bridge blobs at incoming HEAD:
- `TO-CODEX.md`: `dc473f32524b349c567c305d42444e30ad160a5a`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file-internal timestamp was used for increment detection.

## Accepted immutable authority tuple

At `ccc2f84dd52ee38cb2ae31081b141fc15f12a58e`:

- launcher `scripts/j1-trough-probe-launch.sh` blob: `676518be25b852ff652872535ec264b9e4528c5c`
- instrument `scripts/j1-trough-probe-instrument.mjs` blob: `b18ae82bf03d0f6740112b572c00677509f1863f`
- launcher-authority test blob: `7399d6106ee7612a5444e4b0e0ac4de0e84d910a`
- provenance property test blob: `8d04383664246efbc7798fd3475359db90b42919`
- binding module blob: `16bcb099b37d07119433bd4d1b792659eae463ae`
- binding module content SHA-256: `b54d8af1bd166000be82019142043ebf3cf96500a596b9c4a90ce920a867d55d`

The previously accepted sender/full-txid/binding gate remains unchanged.

## Why the MSG-238 HOLD is closed

The reviewed `ccc2f84d` instrument defines one `const PLAN_LABEL = 'v1.6'` and uses that same constant in both:

- the run-header `plan` field; and
- the exact probe message that is itself part of the binding predicate.

The old hard-coded `v1.4` probe-content label is gone. `j1-probe-provenance.test.mjs` directly asserts the single constant exists, both authority-bearing construction sites reference it, and retired v1.2-v1.5 labels do not remain in those construction lines. This is exactly the shape required by the MSG-238 review.

Therefore the run-header identity and the on-chain/bound message identity can no longer drift independently through separate hard-coded plan labels.

## Launcher residual and mandatory external closure

The launcher self-reference residue remains exactly as previously disclosed and accepted in principle: code inside a launcher cannot prove that a maliciously rewritten launcher did not delete its own self-check.

For this narrow testnet read/measurement authority, that residual is accepted **only with the external closure procedure as a mandatory precondition for every evidence run**:

1. executor checks out exact approved commit `ccc2f84dd52ee38cb2ae31081b141fc15f12a58e`;
2. before launch, executor independently runs `git hash-object scripts/j1-trough-probe-launch.sh` outside the launcher's self-reporting path;
3. result must equal the Codex-recorded approved launcher blob `676518be25b852ff652872535ec264b9e4528c5c`;
4. executor records both values and explicit `MATCH` in the artifact #3 executor attestation **before** the run starts;
5. executor runs only the canonical path `scripts/j1-trough-probe-launch.sh`;
6. launcher itself must then enforce HEAD==approved commit, tracked-clean state, approved launcher/instrument Git-object checks, J2-tn relay-prefix gate, and the instrument runtime pins.

A missing, post-hoc, or DIFF launcher attestation means that run is not accepted evidence.

## Other previously reviewed authority gates remain accepted

- full machine-readable submit txid before polling;
- exact txid equality / contradiction fail-closed;
- exact content + sender binding;
- binding-module hash checked before import;
- sender SHA runtime pin;
- vendored kaspa-wasm entry-JS + WASM runtime pins;
- bounded finite TIME_CAP <= 360;
- contemporaneous second-node observation;
- J2-tn scope for measuring confirmation after admission.

## Artifact #3 boundary

This acceptance is for the **measurement authority**, not for any already-existing data artifact.

The current `docs/2026-08-17-j2-artifact3-executor-attestation.md` is still explicitly a pre-draft with the Codex-recorded blob/match/run fields pending. No actual probe run is being accepted here.

When artifact #3 is submitted, Codex will independently verify at minimum:

- approved commit exactly `ccc2f84d...`;
- pre-run external launcher blob comparison equals `676518be...` and says MATCH;
- attestation timestamp precedes run start;
- run-header full provenance/pin results;
- trough trigger semantics;
- submit/firstSeen/confirmed txid identity;
- exact content/sender binding;
- second-node contemporaneous sample;
- exclusion semantics and zero-credit failures;
- full JSONL completeness and sample count/time-cap bounds.

## Authority boundary

This Codex review satisfies the engineering review condition for the v6 test authority. Any execution must remain within the Owner's already-recorded TN12 evidence-policy scope; this response does not create or expand authority beyond that policy.

No production/money-path modification is authorized by this review.
