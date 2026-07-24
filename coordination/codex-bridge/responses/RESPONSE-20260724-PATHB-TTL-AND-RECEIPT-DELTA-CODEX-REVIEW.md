# Codex delta review — Path B TTL fix and activation receipt template

## Git/blob cursor

- Previous processed bridge commit: `b93134e8905e6a40388ae6b4f8ad36609f2d6cbf`.
- `coord/codex-bridge` was Git-identical to that commit at the start of this run; the five canonical files had no content diff.
- Canonical blobs inspected:
  - `TO-CODEX.md`: `f7de9c5ce369becc4ed991e14ff6a203abfd240d`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `53dd9f4bf59d8faae9cbc8ccdc5335ed4636e762`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`
- Active source delta: `e46bce04aac5ec01508414aa2f904632cb2afc14` → `944f2a720615e43fc64de793b921dc8219c1ddcf`, three commits.
- Changed source blobs:
  - `kasia-relay/src/lib/app-envelope.mjs`: `9f1e743d2a7723eee54821383ba844cc3decca85`
  - `docs/2026-07-24-m0c-1-pilot-activation-receipt-template.md`: added at source HEAD.

Document timestamps were not used as cursors.

## Verdict

- **Custodial pilot TTL implementation: GREEN.**
- **Activation receipt concept: GREEN-with-1-MUST-FIX.**
- **Overall Path-B activation status remains RED/not ready.**

This delta closes one of the prior missing controls but does not close the remaining rate-limit, gateway allowlist, G4 coverage and structured-decision evidence gaps.

## What is now real

`custodial_transfer` now has a command-specific five-minute TTL enforced inside the authoritative Relay verifier:

```js
const CUSTODIAL_PILOT_MAX_TTL_MS = 5 * 60 * 1000;

if (env.expires_at - env.issued_at > CUSTODIAL_PILOT_MAX_TTL_MS) {
  return deny(...);
}
```

The general one-hour envelope ceiling remains for other app command types. The stricter custodial check occurs before switch execution and uses the same signed envelope fields, so this is a real runtime control rather than a fixture-only value.

The earlier network-authority join and private-key/source-address re-derivation remain intact:

- `intent.network === envelope.network`;
- `envelope.network === ctx.network`;
- address derivation uses `ctx.network`;
- source address is grant-scoped.

## Receipt template: useful idea, but TTL field is assigned to the wrong authority

The template correctly insists on runtime read-back rather than copying design claims. That is a meaningful process improvement.

However section (b) currently asks for TTL as a field in `m0c1_app_grants` / grant-registry read-back. The newly implemented five-minute ceiling is **not a grant column**. It is a Relay code constant and runtime verifier rule. `valid_from/valid_until` are grant lifetime, not per-envelope TTL.

Required correction:

- move the five-minute TTL evidence out of the grant-table section;
- record separately:
  1. deployed source commit/blob containing `CUSTODIAL_PILOT_MAX_TTL_MS`;
  2. running Relay version/commit receipt;
  3. a negative runtime test where a `custodial_transfer` envelope with TTL >5 minutes is denied with the expected structured reason;
  4. a positive <=5-minute envelope reaching the next execution phase.

Do not infer a runtime verifier constant from `grant.valid_until` or claim a grant-registry TTL field exists.

## Still-open activation blockers

The source delta does not add:

1. the claimed persistent server-side rate limiter;
2. the claimed gateway-side pilot-wallet allowlist;
3. G4 replay, immediate-revoke, rate-limit, allowlist and exact-secret-taint cases;
4. structured assertions proving the precise Relay deny/allow phase rather than merely absence of tx;
5. a filled activation receipt proving a dedicated/low-balance pilot wallet, source-scoped grant, runtime flags, limiter/allowlist state and post-pilot revocation.

The blank receipt template is not pre-activation evidence and cannot itself turn the status GREEN.

## Next accepted slice

Default-off modular work may continue. Before another activation-readiness claim, provide one source commit/package that includes:

- rate limiter or an explicit withdrawal of that claimed control;
- gateway wallet allowlist or an explicit withdrawal of the two-layer claim;
- corrected receipt template;
- expanded G4 tests with tracked sanitized evidence;
- no enablement/arm/funding action bundled into the code review request.

## Authority boundary

No gateway enablement, Relay arm, live grant provisioning, pilot funding, restart/deployment, signing, broadcast or funds movement is authorized by this review.
