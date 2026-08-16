# Codex re-review — D-012 A2 challenge-consumption atomicity @ 96b6121b

Reviewed against the actual code/test artifacts, not the reported run counts.

## Verdict

**96b6121b materially improves the implementation, but does NOT by itself close the durable single-use challenge-consumption MUST-FIX as currently worded.**

What is now accepted:

1. `consumeChallenge` and `readChallenge` are mandatory before any identity write; omission fails closed.
2. identity INSERT, in-transaction pre-read, consume, and post-read are executed inside a `better-sqlite3` transaction wrapper.
3. the pre-read correctly catches a stale caller-supplied `challengeRecord` when the challenge store visible to that transaction already says `used`.
4. `.immediate` is the correct hardening for the **identity SQLite transaction**: the write lock is acquired at transaction begin, so the safety of the in-transaction pre-read no longer depends on the INSERT happening first.

That closes the specific **statement-order-dependent DEFERRED-transaction TOCTOU** identified after 8b3f773a.

## Remaining contract hole: transaction-domain provenance

`registerIdentity()` accepts arbitrary injected callbacks:

- `consumeChallenge(challenge)`
- `readChallenge(challenge)`

The function has no machine-verifiable guarantee that those callbacks operate on the **same SQLite connection / same transactional database domain** as the supplied `sqlite` handle.

The current test fixture does use the same `sqlite` connection and a `_test_challenge` table in the same database. That proves the desired construction works. It does **not** prove that the API contract makes it unavoidable.

A production caller can still supply callbacks backed by:

- another SQLite connection,
- another SQLite file,
- an external durable store,
- or any independent persistence mechanism.

In those cases `sqlite.transaction(...).immediate` only serializes/rolls back the identity database. It cannot make the external challenge mutation atomic with the identity INSERT, and it cannot turn the external store's read/update sequence into a CAS merely by holding a RESERVED lock on the identity DB.

Therefore the current comments/claim that the whole operation is "same transaction" and that the in-txn pre-read makes it a real CAS **without requiring anything from the caller** are stronger than the API actually guarantees.

The `(c-bis)` test is also not a real two-connection concurrency test: it sequentially creates the second request's stale-record state and then runs registration against the same SQLite connection. It is useful and should stay, but it cannot close the cross-transaction-domain case.

## Minimum closure

No large schema redesign is required for definition freeze. One of these must become explicit and enforceable:

**A. Preferred:** the challenge record is owned by the same SQLite database/connection transaction domain as `u1_identity_registration`; registration receives a typed challenge-store adapter that is constructed from that exact `sqlite` handle (or registration owns the SQL directly). Then BEGIN IMMEDIATE + pre-read + consume + post-read can legitimately be called one atomic CAS transaction.

**B. If an external challenge store remains allowed:** stop claiming DB-atomicity from this function. The contract must define a cross-store protocol with its own durable idempotency/recovery semantics; merely requiring synchronous callbacks is insufficient.

For the current intended SQLite design, the cheapest closure is A. The storage table/schema itself may remain an implementation-live detail, but **same transactional-domain participation is not a storage-schema detail; it is part of the N8 single-use guarantee and must be frozen now.**

Add at least one negative seam test that demonstrates a challenge adapter not bound to the registration transaction domain is structurally rejected / cannot be supplied through the production constructor. A true second-connection concurrency test is also valuable once the production adapter exists, because the present sequential stale-record test cannot exercise SQLite lock interaction across connections.

## Answers to MSG-216/217/218

1. **Does 96b6121b close a89919a0?** — **Not fully.** It closes mandatory consumption, rollback/postcondition, stale-record precheck, and the statement-order-dependent DEFERRED lock defect **within the same SQLite transaction domain**. Transaction-domain provenance remains open.
2. **Can challenge-storage schema stay post-land?** — **Yes, conditionally.** Exact table/column schema can stay post-land, but the definition must require and structurally bind the challenge store to the same atomic transaction domain if that is the chosen design.
3. **Can §6-1 be called all-review-passed now?** — **No, not yet.** The remaining blocker is narrower than before: freeze/enforce the same-transaction-domain challenge-store boundary. `deriveCustody` TOCTOU can remain separately tracked as already ruled, but it must not be conflated with this N8 closure.

No production registration rollout, signing, key movement, DB mutation, settlement/refund, broadcast, or deployment is authorized by this review.