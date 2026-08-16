# Codex review — D-012 A2 full-package re-review

Scope: unsynced `bshard-m3-deploy` changes after `5e4db049c3d415df06621ab3ac23b0692b93748d`, through `3295b18c862acb94646babd9e9312d6cdd37d3b4`.

## Correction to prior ruling

The prior response `RESPONSE-20260816-UNSYNCED-D012-A2-SPEC-CODE-DRIFT-CODEX-REVIEW.md` was too narrow because it treated `u1-same-origin.mjs` as if it were the whole current registration gate.

After reading the full package, I retract the statements that N8 and N4-bis are simply absent from the current implementation:

- `kasia-console/src/lib/u1-registration.mjs` blob `ca5d15f76f4f11cc226be2c4a4b95247629ec6b3` derives custody server-side from `relay_nodes` and explicitly ignores caller-supplied `submission.custody`. This satisfies the core N4-bis trust-boundary requirement at the registration orchestration layer.
- `kasia-console/src/lib/u1-registration-pop.mjs` blob `3c21db77a083a619f2f1617d01fb3ee5f0d4b1d6` builds a domain-separated payload binding `root_fingerprint + identity_index + relay_id + challenge` and verifies the signature under the claimed identity pubkey itself. This is the required N8 PoP shape.
- `a674c15a597e1fff1483bbac9208b5135f46f7ec` adds `u1-registration.mutants.mjs` and an entry-point binding regression test; its stated mutation result is 8/8 detected with restore verification. The added test closes a real prior coverage hole where removing the binding gate was not killed by entry-point tests.

Therefore: **N4-bis core derivation = ACCEPTED IN CODE; N8 cryptographic PoP core = ACCEPTED IN CODE; my prior blanket OPEN ruling on those two items is superseded.**

## Remaining normative gap: challenge consumption is optional and non-atomic

I do not yet accept the stronger claim that the full N1–N8 registration contract is frozen/complete as a fail-closed gate.

`registerIdentity()` currently declares `consumeChallenge` optional. After successful PoP and after inserting `u1_identity_registration`, it executes:

`if (typeof consumeChallenge === 'function') await consumeChallenge(s.challenge);`

Thus a caller can omit `consumeChallenge` entirely and still receive `{ ok: true }`. The current entry-point tests themselves demonstrate successful calls without a challenge consumer in V18 and the first N3 registration. This means the one-time challenge property is documented as a caller responsibility, but is not enforced by the normative registration API itself.

There is also an ordering/atomicity seam: the identity row is inserted before challenge consumption. If durable consumption throws/fails, registration state has already changed while the challenge may remain unused. Even though the payload is tightly bound and the root uniqueness constraint limits replay impact, this is still not the advertised fail-closed single-use challenge state machine.

Minimum closure for the registration contract:

1. successful registration must require a durable challenge-consumption capability; omission must fail closed rather than silently succeed;
2. challenge `unused -> consumed` and identity registration must have an explicit atomic/transactional contract, or an equally strong recovery/idempotency invariant that prevents a successful registration from leaving the challenge reusable;
3. tests/mutants must kill (a) omitted consumption, (b) consumption failure after verification, and (c) replay after the success boundary;
4. if challenge issuance/consumption is intentionally declared post-freeze runtime wiring rather than part of the §6-1 definition freeze, the frozen spec/API must say so explicitly and must not call the current `registerIdentity()` path a complete one-time N8 registration gate.

## Scope / zero-production-caller point

The finding that `registerIdentity()` currently has zero production callers is not by itself a defect in a contract-definition freeze if Track A intentionally has zero external users. I accept the definition-vs-live distinction. But the optional/non-atomic challenge-consumption behavior is inside the contract API itself, not merely absence of an HTTP/admin endpoint, so it cannot be dismissed solely as later production wiring.

## Ruling

- same-origin pure judgment core: **ACCEPTED**
- N4-bis server-derived custody: **ACCEPTED IN CODE**
- N8 payload/claimed-key PoP verification: **ACCEPTED IN CODE**
- new registration mutants / binding coverage: **ACCEPTED AS SUBSTANTIVE TEST EVIDENCE**
- zero production caller: **POST-FREEZE WIRING MAY BE ACCEPTABLE, subject to scope**
- durable single-use challenge consumption contract: **OPEN / MUST-FIX OR EXPLICITLY RESCOPE**
- claim `§6-1 contract definition has no remaining technical gap`: **TOO STRONG AS CURRENTLY IMPLEMENTED**

No production registration rollout, key movement, signing/broadcast, settlement/refund, DB mutation, or deployment is authorized by this review.
