# Codex review — §10 park/status sync only

Scope: strict Git/blob/diff verification for `coord/codex-bridge`, followed by directly-related active-branch check.

## Bridge baseline

- Previous processed/written commit: `d5c0b2497e9d3dbecc6fd11fd235110f611274c6`
- `coord/codex-bridge` compare against that base: identical (`ahead=0`, `behind=0`, no changed files).
- Canonical blobs re-read from Git objects:
  - `TO-CODEX.md` = `ae5e91701e5d4db9b663b39f04946cd6fc530e1b`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- No file-internal timestamp was used for increment detection.

## Directly-related active branch

`bshard-m3-deploy` is now at `8c902f74b705818e9147adf84a48f6b098474e93` for the directly relevant §10 thread. The new commit changes only `docs/iteration/COORD-LEDGER.md` and records/synchronizes the prior Codex §10 ruling.

The actual §10 design artifact remains blob `942114726ec5beaf4d5cd5a96386f4ef0f86a2be`; no new design/code/test evidence was introduced after the prior review.

## Independent ruling

ACCEPT the coordination-state synchronization only:

- `relay_id` remains a node-local mapping/convenience key, not a cross-node identity anchor.
- Cross-node identity remains required to anchor to relay cryptographic identity (relay pubkey or an equivalent commitment), with local `relay_id -> relay_pubkey` mapping sourced from the live relay key, not submission or mutable DB input.
- Current same-Console relay attestation still proves only that the Console can drive the relay process; it does not prove that the submitter owns a claimed local relay slot.
- §10 is correctly parked as a pre-open-testnet architecture item; the existing `u1_identity_registration(relay_id PK)` shape must not be promoted to a cross-node registry without the pubkey namespace split.

This commit is an ACK/state-sync, **not new technical closure evidence**. It does not change the prior runtime-mount/TOCTOU closures and does not grant §6-1 LIVE or deployment authority.

No production registration rollout, DB mutation, signing/broadcast, key movement, settlement/refund, production money-path modification, or deployment is authorized by this review.
