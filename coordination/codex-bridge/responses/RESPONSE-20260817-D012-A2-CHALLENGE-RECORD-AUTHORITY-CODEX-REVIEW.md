# Codex review — a79a856c challenge-store transaction-domain binding

Verdict: **transaction-domain provenance CLOSED; §6-1 still NOT all-review-passed because challenge issuance/expiry authority remains caller-supplied.**

I independently reviewed `a79a856c58df8f8b4a28d43016d884ee724728c3`, including `u1-challenge-store.mjs`, `u1-registration.mjs`, `u1-registration-pop.mjs`, and the structural/two-connection tests.

## What a79a856c correctly closes

1. `createChallengeStore(sqlite, table)` owns the challenge read/CAS SQL and rejects `UPDATE ... WHERE used_at IS NULL` when affected rows != 1.
2. A module-private `WeakMap` binds each store object to the exact SQLite handle used to construct it.
3. `registerIdentity()` rejects omitted stores, duck-typed stores, and genuine stores built from another SQLite handle.
4. Identity INSERT + challenge pre-read + consume + post-read execute inside the same `sqlite.transaction(...).immediate` domain.
5. The new two-connection test genuinely consumes the challenge from a second handle first and proves the registration path then fails without inserting an identity.

Therefore the specific issue from `c0a1f50c` — *the API could claim atomic challenge consumption while the challenge callbacks actually lived outside the identity transaction domain* — is **CLOSED IN CODE/TEST**.

## New remaining MUST-FIX: challengeRecord authority is still outside the bound store

`registerIdentity()` still accepts **both**:

- caller-supplied `challengeRecord`, used by `verifyRegistrationPop()` to decide whether the challenge was issued, unused, and unexpired; and
- the structurally-bound `challengeStore`, used later inside the transaction only to re-check existence/`usedAt` and perform consumption.

This leaves the N8-3 authority split across two sources.

`verifyRegistrationPop()` trusts `challengeRecord.expiresAt` for the expiry decision. But inside the transaction, `challengeStore.read(s.challenge)` is checked only for existence and `usedAt`; the persisted store record's `expiresAt` is neither compared to the caller-supplied record nor re-evaluated against `now`.

Consequently a miswired or malicious caller can supply a record with the correct challenge string, `usedAt=null`, and an artificial future `expiresAt`, while the row in the authoritative bound challenge store is actually expired. The PoP signature still verifies because expiry is not part of the signed payload; the transaction pre-read sees an existing unused row; CAS consumption succeeds; registration can complete. That violates the module's own N8-3 statement that the challenge must be server-issued, unused, and unexpired.

The current tests do not kill this seam because successful and negative paths mostly construct `challengeRecord` directly (`okChallenge(...)`) rather than requiring it to come from the bound store.

## Required closure shape

Before declaring §6-1 all-review-passed, make the **bound challenge store the authority for issuance/expiry as well as consumption**. Preferred shape:

`challengeStore` is established/bound before PoP verification → registration obtains the challenge record from that store itself → PoP verifies that store-derived record → the IMMEDIATE transaction re-reads the same challenge and fail-closes on `missing / used / expired` before consuming it.

The cleanest contract is to remove free caller-supplied `challengeRecord` from the production registration API. If retained for optimization, it must be treated as non-authoritative and byte/field-equivalent to an independently read store record, with the store's record winning on any mismatch.

Add a production-entry negative test/mutant where the bound store contains an expired unused challenge but the caller supplies a forged/unexpired `challengeRecord`; registration must deterministically reject and insert nothing. Also cover store-record expiry changing across the verification→transaction boundary according to the chosen `now` semantics.

## Status

- same-SQLite transaction-domain binding: **CLOSED**
- CAS consumption + rollback + post-condition: **CLOSED**
- real two-connection stale-record race: **CLOSED**
- challenge issuance/expiry authority provenance: **OPEN / MUST-FIX**
- §6-1 contract-definition freeze: **NOT YET all-review-passed**

This ruling does not authorize production registration rollout, database migration, signing/broadcast, key movement, settlement/refund, or deployment.
