# Codex review — MSG-20260819-247 / S10 design re-confirm

Review target: `docs/2026-08-19-s10-pubkey-identity-design.md` at `7ba296c7` (blob `0163769bec742c770e90b007113b934722972864`).

This review is design-layer only. It does **not** authorize implementation, rollout, signing/broadcast, DB mutation, key movement, settlement/refund, or any production money path.

## Verdict

### A — local network authority: CLOSED AT DESIGN LAYER

The revised design now states the correct authority relationship: the verifier has one locally configured authoritative network; it checks `payload.network === localNetwork` before cryptographic verification; a correctly signed testnet statement presented unchanged to a mainnet-configured verifier must be rejected. The distinction between "mutate network after signing" and "replay a completely valid signed statement into another network context" is now explicit in §6-1 versus §6-9, and outer/inner network duplication is required to be single-source or fail-closed (§6-13).

This is sufficient for design closure of MUST-FIX A. Implementation must still prove the stated negative tests on the actual production verifier.

### B — canonical signed bytes: NOT CLOSED

The design correctly identifies the requirement but still deliberately leaves two protocol-incompatible wire choices open:

- (a) exact UTF-8 grammar; or
- (b) length-delimited/canonical serialization.

For a cross-node identity protocol, that choice is itself part of the protocol design, not an implementation detail. If two independent implementations can both claim conformance while choosing different byte encodings for the same semantic statement, the design has not defined one protocol identity message.

Therefore **the (a) vs (b) choice must be frozen at the design layer**. It does not need to dictate a particular programming-language implementation, but it must define one byte-exact canonical function from semantic fields to signed bytes, including field order/types, encoding, normalization and integer/epoch representation. Golden vectors should then be derivable from the design and shared by every implementation.

A statement such as "implementation must pick one and freeze it" is not enough for design closure because different implementations could pick differently without violating the written design.

### C — explicit relay-global-pubkey field: PARTIALLY FIXED, NOT CLOSED

The key-semantic ambiguity is correctly fixed: `relayPubkeyXOnly` is now an explicit distinct semantic field, and silent reuse of A2 `identityPubkeyXOnly` is forbidden. That part is accepted.

However §4 still leaves two incompatible protocol shapes open:

1. independent S10 envelope with `relayPubkeyXOnly`; or
2. versioned extension of the existing U1 submission.

That is also a wire-protocol design choice, not merely implementation placement. The signed statement, replay scope, handler dispatch and compatibility behavior depend on which envelope owns the field. **One shape must be selected at the design layer before C can be called closed.**

My recommendation is the design's own preferred option: a separate S10 protocol envelope. It preserves the already-reviewed A2/U1 six-field semantics and prevents relay-global identity from being accidentally reinterpreted as A2 identity during compatibility work.

## One additional design-level ambiguity that should be frozen with B/C

L4/P3 still defines `epoch` as either:

- a one-time challenge; **or**
- a monotonic nonce.

Those are materially different replay protocols and give the `epoch` field different semantics. Because `epoch` is inside the canonical signed statement, this choice affects the byte grammar, state machine and replay authority. It should not remain an implementation-local choice for a design claimed to be closed.

For the current registration path, the cleanest choice is to freeze v1 as challenge-based replay using the already reviewed durable challenge CAS/same-transaction semantics; reserve a future version/domain for nonce-based operation if needed. If nonce is desired now, its monotonic authority and persistence rules must be designed now.

## What is now accepted

- canonical global identity = 32-byte relay x-only pubkey, lowercase 64-hex;
- local `relay_id` is not a global identity authority;
- remote identity verification is payload/self-contained and must not consult local relay mapping/IPC;
- local network is independent verifier authority;
- register-only operation allowlist is required today;
- no legacy `relay_id` / `ecdsa_pubkey_xonly` fallback;
- A2 identity key and relay-global key are distinct semantic types;
- rotate/revoke continuity remains explicitly out of scope and is not accidentally "solved" by current self-signature.

## Closure state

- MUST-FIX A: **CLOSED AT DESIGN LAYER**.
- MUST-FIX B: **OPEN** — select and freeze one byte-exact canonical serialization in the design.
- MUST-FIX C: **OPEN** — select one wire/envelope shape in the design; explicit field semantics themselves are accepted.
- replay/`epoch` semantics: **OPEN DESIGN CHOICE** — freeze challenge vs nonce for v1.

Once those protocol choices are frozen, the design can be re-reviewed for design closure; implementation-layer negative tests §6-9 through §6-13 remain mandatory and cannot be promoted from J1 primitive demonstrations alone.
