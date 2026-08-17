# Codex review — D-012 §6-1 A2 final contract-definition freeze

Target reviewed: `154291d8d89adf8966d538e55ade78eb2ef2eec5`
Bridge inbound: `5e5a544f819b6aa5bbc45349f10e63389c9fd00e` / MSG-20260817-231

## Ruling

**PROMOTE: §6-1 Oracle permission-boundary contract-DEFINITION freeze = ALL-REVIEW-PASSED, scoped exactly to the frozen A2 registration contract on target `154291d8...`.**

This promotion is based on an independent code/test-artifact reread, not on the four-party PASS transcription alone.

### What is now structurally closed in the reviewed production path

1. **Challenge single-use:** challenge consumption is module-owned CAS (`WHERE used_at IS NULL`), with transaction-local pre-read and post-read checks.
2. **Atomic transaction domain:** the challenge-store token is structurally bound through a private `WeakMap` to the exact SQLite handle used by registration; registration uses an IMMEDIATE transaction.
3. **Issuance/expiry authority:** production registration no longer accepts a caller-supplied challenge record; it rereads the canonical bound store, and expiry is rechecked inside the transaction.
4. **Clock authority:** production `registerIdentity()` fixes the clock to internal `Date.now()`; clock injection exists only on the explicit test-only entry.
5. **PoP verifier authority:** production registration does not accept a caller-selected verifier; the production path falls through to the real `kaspa-wasm` `verifyMessage` implementation.
6. **Canonical challenge namespace:** the production entry fixes `CANONICAL_CHALLENGE_TABLE`, and store binding checks both SQLite-handle identity and table identity; `expectedTable` cannot silently disappear from the binding check.
7. **Caller-held token method replacement:** the returned challenge-store object is an opaque frozen token and carries no `read` / `consume` methods.
8. **Executable-capability leakage:** the prior exported `getBoundOps()` seam is gone. `readBoundChallenge()` / `consumeBoundChallenge()` validate the binding internally, execute private operations, and return only data / completion; no export hands the caller the mutable operations object used by registration.
9. **N4-bis custody source:** the registration path derives custody from server-side `relay_nodes` state and does not trust `submission.custody`.
10. **N8 binding/PoP core:** the signed payload binds root fingerprint, identity index, relay id and challenge, and verification is performed under the claimed identity pubkey after the root/index/pubkey derivation check.

The final test artifacts also exercise the important regression family at the production seam rather than only asserting old symbol names. In particular, I-1 walks the challenge-store export surface, I-2 verifies binding mismatch + real canonical-table consumption/CAS, I-3 covers the missing-table fail-closed case, and the dedicated store mutation suite targets capability exposure, token-method reintroduction, binding weakening and CAS removal.

## Scope boundary — do not over-promote this ruling

This is **definition freeze only**. It is **not** an authorization to make §6-1 LIVE, deploy it, migrate production schema, move keys, register production identities, sign/broadcast, or modify any production money path.

The following remain outside this promotion exactly as already scoped by the team and must not be rewritten as "solved by this PASS":

- `deriveCustody` state-change / TOCTOU hardening between its pre-transaction read and the eventual registration write;
- concrete durable table schema / migration / indexes and production wiring;
- mutation-harness refactor to mutate a copy instead of the production file in-place;
- Owner physical-host / LIVE authorization and the operational evidence required after wiring.

Those are post-definition implementation/operations gates. If any future production wiring changes the reviewed trust shape — especially by adding a new parameter, a caller-selectable provider, or a new `x.y()` dereference on caller-held state — this definition PASS does **not** grandfather that new seam; the parameter/dereference authority enumeration must be rerun.

## Final disposition

**§6-1 A2 contract-definition freeze: ALL-REVIEW-PASSED on immutable target `154291d8d89adf8966d538e55ade78eb2ef2eec5`.**

**§6-1 LIVE / production rollout: NOT AUTHORIZED by this ruling.**
