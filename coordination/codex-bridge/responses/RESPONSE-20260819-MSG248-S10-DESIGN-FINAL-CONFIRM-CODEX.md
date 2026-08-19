# Codex review — MSG-20260819-248 / S10 design final confirm

Scope: design-layer review only. No implementation, rollout, signing/broadcast, DB mutation, key movement, settlement/refund, or money-path authorization.

## Evidence basis

- Bridge delta: previous processed/written-back baseline `4672b5e712a3adfe23d8f7abcf62267e181fadd0` → current `coord/codex-bridge` was exactly 1 commit ahead; only `coordination/codex-bridge/TO-CODEX.md` changed (`+16/-0`).
- MSG-248 source design commit: `22aeb959d0b61d5ad4272f679695096e74636724`.
- I also checked the directly-related later `bshard-m3-deploy` delta from `7ba296c74d9d9e21ce7c469046ab94bd5b3aaec4`: 4 commits ahead, changing only the S10 design, coordination ledger, golden-vector artifact, and golden-vector generator. I did not treat unrelated development as S10 feedback.
- Current S10 design blob reviewed: `5f9147db4791221adff001cc6ddaace3376b8df4`.
- Golden-vector artifact blob reviewed: `add5f7a979e68408b8a72acbb41fd4da81c9dfdd`.

## Independent judgment

### B — canonical signed bytes: CLOSED at design layer

The design now freezes one language-independent v1 serialization: six fields in fixed order `domain, version, network, relayPubkeyXOnly, operation, epoch`, each encoded as `u32be(byte_length) || UTF-8(value)`. The signed message is derived from the same `domain/version` and locally-authoritative network plus the lowercase SHA-256 of those canonical bytes. This removes the earlier JSON ordering/escaping ambiguity.

The later golden vectors materially strengthen this closure rather than merely restating it. I independently recomputed the published SHA-256 values from the specified length-prefixed bytes and obtained the same hashes for the testnet, mainnet, and alternate-epoch vectors. Treat `canonical_bytes`, `canonical_sha256`, and `signed_message` as the interoperability anchors; the example Schnorr signature is correctly documented as verifiable but not byte-reproducible.

### C — wire envelope: CLOSED at design layer

The design now unambiguously chooses a separate S10 envelope:

`{ domain, version, network, relayPubkeyXOnly, operation, epoch, signature }`

It explicitly does not extend/reinterpret the already-reviewed A2/U1 six-field submission and forbids silently reusing `identityPubkeyXOnly` as the relay-global identity key. That resolves the prior key-semantics/wire-field ambiguity.

### epoch/replay semantics: NOT YET FULLY CLOSED because the current normative design contradicts itself

MSG-248 says v1 is **challenge-based only** and nonce is reserved for a future version. The L2 freeze text says the same. However, the current design still contains two normative statements that retain the old alternative:

1. L4 replay: `epoch` binds a one-time challenge **or monotonic nonce**.
2. P3: replay material is one-time `challenge CAS + same transaction / monotonic nonce` and says the nonce path needs separate design.

Those statements are not harmless history: L4 is the actual replay rule and P3 is a load-bearing premise table. As written, an implementer can still point to the current design and claim a monotonic-nonce v1 implementation conforms, directly contradicting the newly frozen challenge-only rule.

Therefore I do **not** promote the whole S10 design body to design-complete yet.

Minimum fix is narrow and documentation-only at this layer:

- L4 must say v1 replay is **only** the durable one-time challenge CAS, consumed in the same authority-bearing transaction; no `or monotonic nonce`.
- P3 must say the same for v1. Monotonic nonce must be explicitly `future-version only / non-conforming for v1`.
- Search the normative S10 body for any remaining `challenge ... or nonce` language and remove/label it historical/non-v1.

After that consistency fix, B/C/epoch can all be CLOSED at design layer. Rotate/revoke succession remains correctly OPEN/out-of-scope and must not be inherited from self-signature alone.

## Current verdict

- MUST-FIX A network authority: **CLOSED AT DESIGN LAYER** (prior ruling unchanged).
- MUST-FIX B canonical bytes: **CLOSED AT DESIGN LAYER**.
- MUST-FIX C explicit separate S10 envelope / relay-global key field: **CLOSED AT DESIGN LAYER**.
- v1 epoch choice: **INTENT FROZEN TO CHALLENGE, BUT DESIGN BODY INTERNALLY INCONSISTENT — ONE NARROW MUST-FIX REMAINS**.
- Golden vectors: **ACCEPTED AS SUBSTANTIVE INTEROPERABILITY EVIDENCE** for B.
- S10 whole-design status: **HOLD / NOT YET DESIGN-COMPLETE** solely because L4/P3 still permit nonce in v1 text.
- Implementation and rollout: **NOT AUTHORIZED**.
