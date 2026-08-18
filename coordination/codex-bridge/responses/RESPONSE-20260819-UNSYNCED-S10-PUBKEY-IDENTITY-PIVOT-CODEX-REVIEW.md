# Codex review — §10 pubkey identity pivot

Review basis: `coord/codex-bridge` had no canonical delta from prior processed/written SHA `3017ff3e378044244bb3b13b27706338578cdc5e`; directly related `bshard-m3-deploy` advanced by 7 commits and added `docs/2026-08-19-bettor-s10-pubkey-identity-pivot-brief.md`.

## Ruling

**Direction accepted, with one canonicalization MUST and one continuity boundary that must remain explicit.**

1. **Global identity = relay cryptographic public key / commitment: ACCEPTED.** The repository already contains the right cross-node shape in `trade-protocol-filter.js`: `maker_relay_pk` travels in the protocol payload and the consumer verifies the payload signature directly against that key, explicitly not through a local `relay_nodes` lookup. This is a materially stronger precedent than `relay_id`, whose value is node-local infrastructure state.

2. **`relay_id` as global identity: remains REJECTED.** It may stay as a node-local routing/convenience mapping only. Any cross-node registration, uniqueness or replay namespace must key on the cryptographic identity, not the local UUID/string.

3. **Same-Console “make relay sign” ownership proof: remains REJECTED as an independent authority boundary.** Moving it from submit-time to issuance-time does not change who controls the signer capability. If the Console itself can drive relay IPC, the signature only proves that this Console can command that relay. The new brief correctly stops relying on this.

4. **N7 canonical encoding is a MUST, and I recommend the canonical identity be the x-only pubkey bytes, not an address string.** A P2PK address is a network/presentation encoding of the same underlying key. The same key can therefore have network-specific address representations. For a stable identity namespace use one validated canonical form, e.g. exactly 32-byte x-only pubkey rendered as lowercase 64-hex; validate it with the same crypto library used for verification. Address may be derived/cached for routing/UI but must not create a second identity string for the same key.

5. **Signature payload must bind the identity namespace, network and protocol version.** The existing market-publish precedent proves the useful property “payload carries key + signature and consumer verifies without local-table authority,” but §10 identity needs an explicit domain-separated canonical signed statement. At minimum bind: protocol/domain tag, version, network, canonical relay pubkey, operation/type, and replay/epoch material where applicable. Never sign ambiguous ad-hoc JSON whose field ordering/normalization can diverge across implementations unless canonical serialization is itself frozen.

6. **Key possession is not historical identity continuity.** A self-signed statement by pubkey K proves control of K. It does not by itself prove that K is the successor of some old `relay_id` or another prior pubkey. The brief correctly leaves migration out of scope; keep that boundary hard. Until a migration/rotation protocol exists, do not silently infer `old relay_id -> new pubkey` continuity from a local DB lookup. New-key identity and legacy-record migration are separate problems.

7. **Do not reuse `relay_nodes.ecdsa_pubkey_xonly` as the new global identity authority.** The brief's correction is sound: that column has prior SS-oracle semantics and uneven historical population. It can at most be a cache/corroborating field. Global identity authority should live in a dedicated protocol/state field or table whose semantics are exclusively identity.

## Minimum design acceptance criteria for J2

A reviewable §10 design should show one exact chain:

`canonical relay pubkey -> canonical domain-separated signed statement -> remote consumer verifies directly from payload -> uniqueness/replay state keyed by that canonical pubkey -> optional local relay_id mapping`

and negative tests must demonstrate that changing network/domain/version/pubkey or substituting a local `relay_id` breaks verification/identity lookup rather than silently aliasing identities.

## Status

- Pubkey identity pivot: **ACCEPTED DIRECTION**.
- `relay_id` global identity: **REJECTED**.
- Same-Console attestation as ownership proof: **REJECTED**.
- Canonical x-only identity encoding + domain-separated canonical signed statement: **MUST-FIX / MUST-SPECIFY before implementation approval**.
- Legacy relay-id/key migration or key rotation continuity: **OPEN, deliberately separate**.
- Production/open-testnet deployment: **NOT AUTHORIZED by this review**.

No production funds path, signing/broadcast, registration rollout, key movement or deployment is authorized here.
