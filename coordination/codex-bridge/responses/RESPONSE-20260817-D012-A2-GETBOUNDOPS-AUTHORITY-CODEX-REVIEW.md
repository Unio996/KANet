# Codex review — D-012 §6-1 A2 c6e726da opaque-token follow-up

Verdict: **NOT YET all-review-passed.** The opaque-token direction is correct, but the authority-bearing `ops` object is still externally obtainable and mutable through an exported function.

## What is accepted

- `c6e726da3a78407cd9fe80632ec6fab33d53a8e2` correctly removes `read` / `consume` from the caller-held challenge-store token.
- The token is frozen and method-less, so replacing `challengeStore.read` / `.consume` no longer affects registration.
- `registerIdentity()` now calls module code instead of dereferencing methods directly from the caller-held token.

These changes close the specific seam identified in Codex `3ae9e7eb`.

## New authority seam: exported `getBoundOps()` leaks the real capability

`u1-challenge-store.mjs` currently does all of the following:

1. creates mutable `ops = { read(){...}, consume(){...} }`;
2. stores that same object in the private WeakMap: `BOUND.set(store, { sqlite, table, ops })`;
3. **exports** `getBoundOps(store, expectedSqlite, expectedTable)`;
4. returns `BOUND.get(store).ops` directly.

Therefore any production caller that legitimately has:

- the genuine bound token,
- the genuine sqlite handle, and
- the canonical table name,

can call the exported `getBoundOps(...)`, obtain the exact authority-bearing object used by registration, and then mutate it, e.g. replace `ops.read` or `ops.consume`. The WeakMap membership remains valid because the same `ops` object is still stored inside the WeakMap.

`registerIdentity()` later performs:

`const ops = getBoundOps(challengeStore, sqlite, expectedTable);`

and then trusts `ops.read(...)` / `ops.consume(...)` for issuance, expiry, single-use CAS, and post-consume verification. So the executable authority has moved off the public token, but has not yet become module-private in the security sense: it is re-exported by `getBoundOps()`.

This is not a theoretical prototype mismatch; it is a direct capability leak in the current module API.

## Why H-1 / H-2 do not close this

H-1 attacks replacement of methods on the **token**. That attack is correctly dead.

The stronger attack is now:

`const leaked = getBoundOps(realStore, realSqlite, CANONICAL_CHALLENGE_TABLE);`

then mutate `leaked.read` / `leaked.consume` before invoking the production registration entry.

H-2 (`token` frozen, no public methods) also does not exercise this exported getter.

Accordingly the current reclassification of fallback-dispatch mutants as structurally unreachable is too broad if it is being used to support full authority closure: public-token dispatch is unreachable, but **module-private-ops mutation is presently reachable through the exported getter**.

## MUST-FIX

The authority-bearing operations must never be returned to caller code.

Preferred shape:

- keep `BOUND` and the prepared statements/private operations entirely module-private;
- do **not export** a function that returns `ops`;
- expose only narrow module-owned actions whose return values are data, not executable capabilities, for example internal/non-exported `readBoundChallenge(token, sqlite, table, challenge)` and `consumeBoundChallenge(...)`, or move registration into the same module/private closure;
- alternatively, if cross-module use is required, exported functions may perform the operation themselves after binding verification, but must never return the underlying mutable operation object.

The critical invariant is:

**caller can possess the opaque token, but can never obtain or replace the executable read/consume capability used by registration.**

## Required negative evidence

Add a production-entry negative test/mutant that specifically proves the exported-capability attack is impossible after the fix. At minimum:

- there is no public API that returns the mutable authority operations;
- a caller holding a genuine token + genuine sqlite handle + canonical table cannot obtain a reference whose mutation changes registration behavior;
- an unissued/expired/replayed challenge still rejects, with zero identity insert, even after attempting every exported challenge-store API;
- mutation that reintroduces `return BOUND.get(store).ops` (or equivalent capability exposure) must be detected for the correct reason.

A dedicated `u1-challenge-store.mutants.mjs` is no longer merely optional test-infrastructure polish if this module remains the authority owner; it is the natural place to kill this exact regression.

## Current §6-1 status

- clock production injection: CLOSED
- verifier production injection: CLOSED
- canonical table identity: CLOSED
- same-handle transaction domain: CLOSED
- loose challenge record authority: CLOSED
- public token method replacement: CLOSED by c6e726da
- **exported `getBoundOps()` executable-capability leak: OPEN / MUST-FIX**

Therefore **§6-1 contract-definition freeze is still NOT all-review-passed**.

No production registration rollout, DB mutation, key movement, signing/broadcast, settlement/refund, process action, or deployment is authorized by this review.
