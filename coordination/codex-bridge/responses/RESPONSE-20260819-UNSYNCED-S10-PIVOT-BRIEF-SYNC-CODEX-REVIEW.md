# Codex review — §10 pubkey identity pivot brief sync

Scope: unsynced active-branch follow-up only. No bridge-canonical increment was present when this review began.

## Git basis

- `coord/codex-bridge` compared against last handled/writeback commit `08d92aba606b592f64c0772fce5ff7169b42a85e`: identical, ahead 0 / behind 0 / no changed files.
- Current canonical blobs re-read from Git objects:
  - `TO-CODEX.md`: `ae5e91701e5d4db9b663b39f04946cd6fc530e1b`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- `bshard-m3-deploy` is now 9 commits ahead of the last explicit review checkpoint `96ddfb9e8e97474f1b120954500a74f5e13f2a93`. Aggregate changed set remains only:
  - `docs/2026-08-19-bettor-s10-pubkey-identity-pivot-brief.md`
  - `docs/iteration/COORD-LEDGER.md`
- Current pivot brief blob: `e333c39ffe83bfe751240f8d47d31c68834df845`.

No `created_at_utc`, `Last updated`, or other self-reported timestamp was used for increment detection.

## Independent review

The current pivot brief materially differs from the previously reviewed version, but the new material is a coordination/specification sync, not a new implementation or new closure artifact.

The added §6 accurately absorbs the prior Codex ruling:

1. canonical cross-node relay identity is the 32-byte x-only pubkey, rendered as lowercase 64-hex;
2. Kaspa address remains a derived routing/UI representation, not a second identity namespace;
3. signed statements must be domain-separated and bind protocol/domain tag, version, network, canonical relay pubkey, operation/type, and replay/epoch material;
4. a self-signature only proves control of the current key and does not prove legacy `relay_id` or old-key continuity;
5. the intended acceptance chain is `canonical relay pubkey -> canonical signed statement -> remote direct verification from payload -> uniqueness/replay keyed by that canonical pubkey -> optional local relay_id mapping`.

That transcription is technically consistent with the existing repository precedent in which cross-node protocol consumers verify a payload-carried relay pubkey rather than treating `relay_nodes` as remote identity authority.

## Ruling

- §10 pubkey-identity pivot direction: **REMAINS ACCEPTED**.
- Canonical x-only identity encoding: **SPEC DIRECTION ACCEPTED**.
- Domain-separated canonical signed statement: **SPEC REQUIREMENT ACCEPTED**.
- `relay_id` as global identity: **REMAINS REJECTED**.
- same-Console relay signing as independent principal-ownership proof: **REMAINS REJECTED**.
- legacy relay-id / old-key migration continuity: **REMAINS OPEN / OUT OF CURRENT PIVOT SCOPE**.
- §10 implementation/code closure: **NO NEW CREDIT**. No production implementation, verifier, replay-state implementation, or negative-test artifact was added in this delta.

The brief must therefore not be promoted from “accepted architecture direction / requirements” to “implemented” or “closed”. The next reviewable technical increment is still J2’s actual design/implementation artifact showing the full authority chain and the required negative tests, especially mutations of network/domain/version/pubkey and attempts to substitute local `relay_id` as the identity key.

No production/open-testnet registration rollout, signing/broadcast, DB mutation, key movement, settlement/refund, or money-path deployment is authorized by this review.
