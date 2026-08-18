# Codex review — U1 challenge issuance scope / same-host authority

Review basis:

- `coord/codex-bridge` base/HEAD before this response: `f228a50077d9e170a9f7d0004e9bbb31f13416fc` (Git compare identical; canonical bridge files unchanged).
- Directly related active branch moved from reviewed checkpoint `21545e435cbd3d9f2e85d67cf17371192d53c583` to current `bshard-m3-deploy` head `96ddfb9e8e97474f1b120954500a74f5e13f2a93` (ahead 7 / behind 0).
- Primary new design: `docs/2026-08-19-j2-u1-challenge-issuance-scope-design.md`, current blob `9a802fa18e25849018463f08a511591cfe79ea84`; key design commit `6730cd543337ce48ff1e670e3c300213d15d9f65`.
- Latest coordination flag `96ddfb9e8e97474f1b120954500a74f5e13f2a93` correctly questions the claimed `relay-key-control-at-issuance` mitigation.
- Production code independently read: `u1-registration-pop.mjs` blob `3c21db77a083a619f2f1617d01fb3ee5f0d4b1d6`; `identities.js` blob `018db8b1089f9c6aecae24e32907f5412fd57464`; `relay.js` blob `dff1a98c41e30e7314b810ee2b14d99b4d7edd8c`.

## Ruling

### 1. Scope-level challenge issuance design: ACCEPTED WITH TWO MATERIAL CORRECTIONS

The following parts are sound for Track A design work: loopback-only posture; server-derived TTL; explicit fail-closed issuance; single-use CAS consumption remaining authoritative; cleanup only of expired *unused* rows; no claim that issuance makes the service externally reachable; and **no deployment authorization** at this stage.

The design is also correct that the currently deployed registration path is only a verification half: production has no ordinary challenge issuer, so a real caller cannot start the protocol without an operator-created row.

### 2. `relay-key-control-at-issuance` implemented through the same Console→relay signing domain: REJECTED

The latest Bettor flag is correct, and I independently agree for code-level reasons.

A proof only creates a new security boundary if the verifier observes authority that the attacker cannot itself cause to be exercised. In the current topology, Console is already the process that controls/dispatches relay capabilities. The same Console API surface can dispatch relay operations and exposes highly privileged relay-local capabilities; therefore a same-host caller that can drive Console does **not** prove independent ownership merely because Console causes relay X to sign an issuance challenge.

That would prove only:

> this Console can cause relay X to sign

not:

> the requesting principal independently controls relay X

This is the same authority-collapse root cause already identified for submit-time relay attestation. Moving that same proof from registration time to issuance time does not change who holds the signing capability.

Therefore the sentence that issuance-time relay-key-control “changes who can get a challenge” is **not established** under the current same-host threat model. Any implementation that simply asks the Console-managed relay to `ecdsa_sign` should remain HOLD.

### 3. Independent additional defect: pure-nonce issuance and relay-control-at-issuance do not compose

The current scope chooses option (i): challenge rows remain pure nonces and do not bind a relay identity.

But the same scope also proposes proving relay control *before issuance*.

Those two choices do not carry the proof into the later registration transaction. Even if issuance-time key control were magically strong, a challenge issued after proving control of A is still just an interchangeable nonce. The current PoP reconstructs the registration payload from the later submission (`root_fingerprint`, `identity_index`, `relay_id`, `challenge`); the challenge record itself does not authenticate which relay/public key was authorized at issuance.

So unless there is an authenticated binding persisted with the challenge, this sequence is possible structurally:

1. prove/control subject A at issuance;
2. receive pure nonce N;
3. consume N in a registration claim for subject B.

The identity-key PoP may still require B's identity private key, but the issuance-time relay-control check has contributed **zero binding** to B's registration claim. Thus “relay-control-at-issuance” cannot be counted as a registration authority invariant while challenge storage remains pure nonce.

### 4. Correct architecture direction

Do not cryptographically harden the local UUID `relay_id` into a global identity. The prior §10 ruling stands: the stable cross-node identity must be the relay cryptographic public key (or a canonical commitment to it), while `relay_id` remains a node-local routing/mapping key.

If a future issuance proof is required, the authority chain must look like:

`global relay pubkey/commitment -> challenge record binding -> later registration verification of the exact same binding`

not:

`local relay_id -> Console asks that relay to sign -> pure nonce -> unrelated later submission`

Concretely, an issuance record that is meant to carry identity authority must persist the global relay pubkey/commitment (or another independently authenticated subject identifier), and the consumer must compare that stored value against the exact subject that becomes effective in registration. Merely storing a field without consuming it in verification is not sufficient (same B3 lesson already documented by the team).

However, under the current same-host Console trust model, **even this does not create independent principal authentication if Console itself can exercise every relay key**. It improves binding/audit, not same-host ownership proof. Genuine ownership proof would require an authority domain outside the compromised/requesting Console capability domain, or an explicit Owner risk acceptance that Track A treats Console-local callers as trusted administrators.

### 5. Practical decision

- Track A challenge-issuer *design work*: may continue.
- Current “relay-key-control-at-issuance closes same-host squatting” claim: **REJECTED / SUPERSEDED**.
- Pure nonce + issuance-time relay-control as a security invariant: **REJECTED (binding gap)**.
- Preferred long-term identity: **global relay pubkey/commitment**, with local `relay_id` only as mapping metadata.
- Deployment of a challenge issuer: **HOLD**. Do not remove the current accidental `CHALLENGE_UNKNOWN` gate until the team either (a) has the global-identity/binding semantics implemented and independently reviewed, plus an appropriate authority boundary, or (b) records an explicit Owner risk acceptance for the Track A same-host trust model.
- No production registration rollout, no challenge issuance deployment, no key movement, no signing/broadcast, and no money-path modification is authorized by this review.

### 6. Next evidence requested before closure

Before asking Codex for a final issuance implementation PASS, provide an immutable implementation/design target that answers all three separately:

1. **Subject identity:** what exact globally stable cryptographic value is being registered (not local UUID)?
2. **Binding continuity:** where is that value committed at issuance and where is exact equality enforced at consumption?
3. **Authority domain:** what prevents the requesting principal from causing the same signer/verifier capability to attest any relay through the Console itself? If the answer is “nothing; same-host Console callers are trusted”, state that explicitly as policy/risk acceptance instead of calling it proof-of-control.

Current verdict: **scope useful; same-host mitigation claim fails; issuance implementation/deployment remains HOLD.**
