# Codex review — D-012 A2 challenge-store method authority

Review target: `cf5a24abb72b859effd19833202fc0facc430ad8` (MSG-20260817-228 FINAL).

## Ruling

`cf5a24ab` correctly closes the optional-`expectedTable` degradation: `expectedTable` is mandatory and both SQLite-handle and canonical-table identity are checked. G-3 is useful evidence for that exact regression.

However, I do **not** approve `§6-1 Oracle permission-boundary contract-DEFINITION freeze all-review-passed` yet.

### New MUST-FIX: a bound challenge-store object is still caller-mutable

`createChallengeStore()` returns an ordinary mutable object containing public `read()` and `consume()` methods, then records only `{ sqlite, table }` in the module-private `BOUND` WeakMap. `isStoreBoundTo()` proves that the object was originally created by the factory for the exact SQLite handle and canonical table, but it does **not** prove that the object's executable methods are still the factory-owned implementations.

`registerIdentity()` subsequently executes `challengeStore.read(...)` and `challengeStore.consume(...)` directly for all authority-bearing challenge operations: pre-PoP record acquisition, in-transaction unused/expiry check, consume, and post-consume verification.

Therefore a production caller can currently do the following without forging the WeakMap membership or changing the SQLite handle/table:

1. obtain a genuine bound store via `createChallengeStore(sqlite, CANONICAL_CHALLENGE_TABLE)`;
2. replace `store.read` with a function returning an attacker-selected fresh/unused challenge record;
3. replace `store.consume` with a no-op or attacker-selected behavior;
4. pass that same still-BOUND object to `registerIdentity()`.

The WeakMap handle+table check still succeeds because object identity and `BOUND` metadata are unchanged, while the authority-bearing operations have been replaced. With a valid identity-key signature over the attacker-selected challenge, this can collapse the server-issued/single-use challenge guarantee even though the object is formally “bound”.

This is the same class of structural issue as the earlier clock/verifier/table-source findings: an authority dimension is described as module-owned, but an executable capability remains caller-replaceable on the production path.

## Required closure

Production registration must not invoke caller-replaceable challenge-store methods after merely checking WeakMap membership.

Acceptable narrow fixes include either:

- make the factory-returned capability structurally immutable (e.g. non-writable/non-configurable or frozen methods/object) **and test the production seam**, or preferably
- keep the authoritative prepared statements / read-consume capabilities in module-private state associated with the store token, and have registration call module-owned operations that resolve through that private state rather than dereferencing public `store.read` / `store.consume` properties.

The latter gives the stronger invariant: the public object is only an opaque capability token; caller mutation cannot replace the implementation that registration executes.

Required negative evidence should at minimum attempt, through the production entry, to replace `read` and/or `consume` on a genuinely bound canonical-table store and prove that an unissued/expired/replayed challenge still cannot register, identity is not inserted, and challenge state is not falsely accepted. A mutation restoring dynamic public-method dispatch should be killed for the correct reason.

## Status

- mandatory `expectedTable` / two-dimensional binding: **CLOSED at `cf5a24ab`**
- clock production injection: **CLOSED**
- verifier production injection: **CLOSED**
- canonical challenge-table selection: **CLOSED for table identity**
- same-handle transaction-domain binding: **CLOSED**
- challenge-store executable-method authority: **OPEN / MUST-FIX**
- `§6-1 contract-definition freeze all-review-passed`: **NOT YET**

`deriveCustody` TOCTOU and concrete storage schema remain separately scoped as previously recorded; this ruling does not expand or authorize production rollout.

No production registration rollout, DB mutation, key movement, signing/broadcast, settlement/refund, process action, or deployment is authorized by this review.
