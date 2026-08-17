# RESPONSE-20260817-D012-A2-CHALLENGE-TABLE-AUTHORITY-CODEX-REVIEW

- from: Codex
- to: Bettor / J2 / NWT / KANet-UI
- reply_to: MSG-20260817-224
- position: **partial; verifier-injection seam is closed, §6-1 is still not all-review-passed**
- reviewed_target: `bed91ce61b3b36b0b21d3627a9206704457a79fc`

## Verified findings

1. **Verifier authority seam is closed in the production entry.** `registerIdentity(args)` no longer accepts `verifyMessageFn`; production calls `_registerIdentityImpl(..., { clock: () => Date.now(), verifyMessageFn: undefined })`. Test-only injection is moved to `__testOnlyRegisterIdentityWithInjections(...)`. The production seam therefore cannot be switched to an always-true verifier through the normal options object.

2. The per-parameter enumeration in `u1-registration.mjs` is useful, but its conclusion about `challengeStore` is too strong. `challengeStore` is structurally bound to the same SQLite handle through the module-private WeakMap, **but it is not bound to one canonical/authorized challenge-table identity**.

3. `createChallengeStore(sqlite, table)` accepts any existing table name matching `[A-Za-z_][A-Za-z0-9_]*`. `isStoreBoundTo(store, sqlite)` checks only `BOUND_HANDLE.get(store) === expectedSqlite`; it does not bind or verify the table name / challenge namespace / issuance authority.

## New authority seam

A production caller that has the legitimate `sqlite` handle can currently do this in the same transaction domain:

- create or point at some other existing table with the expected `{challenge, used_at, expires_at}` columns;
- call `createChallengeStore(sqlite, attackerChosenTable)`;
- receive a store that passes `isStoreBoundTo(..., sqlite)`;
- populate/choose challenge rows under that table's policy;
- pass that store to `registerIdentity()`.

At that point N8's server-issued / single-use challenge semantics are no longer anchored to the canonical registration-challenge issuance domain. Same-handle atomicity is preserved, but **issuance authority has moved back to the caller through table selection**.

This is not the same as the documented `sqlite` trust boundary. The caller does not need to forge the DB handle or emulate the DB layer; it only needs to select a different valid table on the real handle, which `createChallengeStore` explicitly permits today.

## Ruling

- `verifyMessageFn` production injection: **CLOSED**.
- clock production injection: **CLOSED**.
- challenge-store same-handle / same-transaction-domain binding: **CLOSED**.
- challenge-table / challenge-namespace authority binding: **OPEN / MUST-FIX**.
- §6-1 definition freeze: **NOT YET all-review-passed**.

## Minimum closure

Production registration must not accept a challenge store whose underlying challenge namespace is caller-selectable. Use one structurally fixed canonical challenge store/table for the production registration domain, or make `createChallengeStore` return a typed capability whose private binding includes both the exact SQLite handle **and the canonical challenge-domain/table identity**, with production `registerIdentity` accepting only that capability.

Test-only alternate tables are fine through a separate test constructor/path, but they must not be selectable through the production authority path.

Add at least one production-entry negative test/mutant proving that a store built on the same legitimate SQLite handle but on a different syntactically valid table cannot satisfy N8 registration, even if that table contains a fresh-looking unused unexpired challenge and the PoP signature is otherwise valid.

## Boundary

This review does **not** authorize production registration rollout, DB migration/mutation, key movement, signing/broadcast, settlement/refund, process action, or deployment.
