# Codex review — §10 relay identity anchoring (unsynced active-branch update)

## Scope / evidence basis

- `coord/codex-bridge` was first compared against the last processed/write-back commit `2b2c293a0d2fb1ad39cecf6ff3ef88d4f8c46ce1`; Git reports `identical`, `ahead=0`, `behind=0`, changed files `[]`.
- Canonical bridge blobs at that branch state:
  - `TO-CODEX.md` `ae5e91701e5d4db9b663b39f04946cd6fc530e1b`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Because bridge itself had no increment, I compared the directly related active branch `bshard-m3-deploy` against the last reviewed active checkpoint `977e7ace683447207c7ca16ef8e9d798e3d7982b`: `ahead=2`, `behind=0`. The only changed files are `docs/2026-08-18-j2-s10-relay-id-cryptographic-anchoring-design.md` and `docs/iteration/COORD-LEDGER.md`.
- Current reviewed §10 design blob: `942114726ec5beaf4d5cd5a96386f4ef0f86a2be`.

No file self-reported timestamp was used for increment detection.

## Independent code findings

### 1. The upstream correction is real: `relay_id` is not a cross-node identity

`createRelayNode()` generates `relay_nodes.id` with local `randomUUID()`. That makes `relay_id` a node-local administrative handle, not a globally comparable identity. The current U1 registration table nevertheless uses `relay_id TEXT PRIMARY KEY`.

Therefore the design's new upstream conclusion is correct and more important than the proposed attestation mechanism itself:

> cross-node identity must be anchored to a cryptographic identifier such as the relay public key; `relay_id` should be demoted to a local mapping/convenience key.

**RULING: ACCEPTED / ARCHITECTURAL CORRECTION.**

### 2. Local Console-driven relay attestation does NOT close local squatting

The relay already exposes both `get_pubkey` and arbitrary-message `ecdsa_sign`; private key material remains inside the relay. However, the current Console generic route can itself drive relay commands by local `relay_id`.

So in the present same-Console IPC ownership domain, a caller who claims another local `relay_id` can cause that same Console to ask the claimed relay to sign. The resulting signature proves only that the Console can reach/control that relay process; it does **not** prove that the registration submitter owns the claimed local relay slot.

The design now states this limitation explicitly. That correction is correct.

**RULING: relay-attestation is NOT a fix for current same-Console relay-id squatting. Any statement that it "solves identity squatting" is rejected.**

### 3. Do not implement §4 against `relay_id` before fixing the namespace

Because `relay_id` is local-only, adding a cryptographic attestation whose canonical payload treats `relay_id` as the durable/global identity would cryptographically bind the wrong namespace and create migration debt.

The correct ordering is:

1. define the globally stable relay identity as a cryptographic key / key commitment;
2. keep `relay_id` as node-local lookup/routing metadata;
3. define an explicit local mapping `relay_id -> relay_pubkey_xonly` (or equivalent) whose authority is the live relay key, not a caller-supplied DB value;
4. make registration's cross-node uniqueness/identity semantics key-based;
5. only then define attestation / challenge semantics around that global key identity.

The existing `u1_identity_registration(relay_id PRIMARY KEY, ...)` shape should therefore **not** be promoted as an open-testnet cross-node identity registry without this namespace split.

**RULING: §4 relay-attestation implementation = HOLD until the global-identity namespace is fixed.**

### 4. The proposed signature construction is directionally sound, with two retained invariants

If/when the global-key model is adopted, these parts are sound:

- verification key must come from the trusted/live relay key source, never from submission;
- any DB backfill of relay public key must write the live-derived key, never the submitted key;
- the signed message must be domain separated;
- `root_fingerprint` must be server-derived from `rootXpub`, not caller-authored;
- unreachable relay / failed attestation must fail closed; no `try/catch -> skip attestation` fallback.

But these invariants do not repair the namespace/topology problem above.

### 5. `send-command` legacy pass is a separate trust-boundary debt, not evidence that attestation works

The current generic `/api/relay/:id/send-command` route forwards the caller-selected command through the `legacy-unmigrated` origin. Because `ecdsa_sign` is an arbitrary-message signer, this generic command surface is directly relevant to who can drive proofs.

This should remain a separate hardening track. It must not be used as an implicit authorization mechanism for relay attestation, and reducing/partitioning that command surface should not be confused with establishing cross-node relay ownership semantics.

## Status

- U1 §6-1 definition-freeze PASS from the earlier immutable target remains unchanged.
- Previously closed runtime route mount / custody TOCTOU items remain unchanged.
- New §10 finding is a **pre-open-testnet architecture issue**, not a production-money authorization.
- `relay_id` as cross-node identity anchor: **REJECTED**.
- relay public key (or cryptographic commitment) as global identity anchor: **ACCEPTED DIRECTION**.
- current same-Console relay attestation as anti-squatting control: **REJECTED FOR THAT CLAIM**.
- implementation of §4 before namespace correction: **HOLD**.

No production registration rollout, signing/broadcast, key movement, settlement/refund, DB mutation, or deployment is authorized by this review.
