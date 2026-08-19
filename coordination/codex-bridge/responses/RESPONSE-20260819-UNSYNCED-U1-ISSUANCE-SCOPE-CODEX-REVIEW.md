# Codex review — unsynced U1 challenge issuance scope

## Git/Blob baseline

- coord/codex-bridge baseline / current HEAD before this write: `1bd8cb336e2f749444a8ff0741d33d06e9215a36`
- compare baseline..coord/codex-bridge: `identical`, ahead=0, behind=0, files=[]
- canonical blobs at that HEAD:
  - TO-CODEX.md `8e0fe0b05a422c81d727bf68d2c1ab1a881e7346`
  - DISCUSSIONS.md `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS.md `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS.md `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX.md `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file-internal timestamp was used for increment detection.

## Unsynced directly related branch change

`bshard-m3-deploy` advanced from the last S10 design checkpoint `847bcf229f62bf287af9308f5b20fc64ec49c2d9` to `55c792692365abe8076c3557ef578da6a1a384f4`: ahead 15 / behind 0. Aggregate changed set is only:

- `docs/2026-08-19-j2-u1-challenge-issuance-scope-design.md` (+102/-1)
- `docs/iteration/COORD-LEDGER.md` (+80/-0)

No production implementation file is in that compare.

The final scope-doc fold-in commit is `cf8c5d1ecb128228af356272767251380ccdde15`; the branch-head ledger closure commit is `55c792692365abe8076c3557ef578da6a1a384f4`.

## Independent code-level judgment

I independently checked the two load-bearing claims rather than accepting the ledger conclusion.

1. **Relay-key proof impossibility inside the current Console capability domain — ACCEPTED.** The current Console exposes `GET /relays/:id/mnemonic` with no route-level auth/preHandler in `kasia-console/src/api/relay.js`. If an attacker in the assumed same-Console HTTP capability class can obtain the raw relay secret, a signature produced by that secret is cryptographically indistinguishable from one produced by the legitimate relay process. Therefore a “prove control of this relay key” issuance gate does not create an independent ownership boundary in this threat model.

2. **Admin-secret distinction — ACCEPTED, but only as defense-in-depth.** `checkAdminSecretTier()` reads an operator secret from `process.env[envVarName]`, fails closed with 503 if unset and 403 on a missing/mismatched header. That is genuinely different from a relay-secret proof for an HTTP-only attacker because the operator secret is not itself exposed by that helper. However it is not a boundary against an executor/process with filesystem/environment access. The scope doc now states this limitation explicitly, which is correct.

3. **North-star transition gap — correctly left OPEN and deployment-gating.** The S10/pubkey design removes `relay_id` from global identity authority in the target state, so a squatted local `relay_id` need not permanently own the future global identity. But the repository still has no designed legacy `relay_id` / historical-key -> successor migration rule. Therefore the scope doc is correct to require any future deployment request to answer how pre-existing/squatted registration rows are treated during migration. This is not optional cleanup; it is a transition-state safety requirement.

## Ruling

**U1 challenge-issuance scope document: DESIGN-LAYER COMPLETE for the stated Track-A/internal scope.**

This does **not** authorize implementation or deployment. The current status remains:

- issuance implementation: NOT AUTHORIZED
- issuance deployment: HOLD / north-star-gated + Owner policy decision
- admin-secret, if later used: defense-in-depth only, not proof that the same-host window is closed
- legacy/squatted-row migration handling: MUST be answered before any deployment authorization
- external registration exposure: still NOT implied by an internal issuer

No signing/broadcast, key movement, settlement/refund, DB mutation, process action, production deployment, or production money-path modification is authorized by this review.
