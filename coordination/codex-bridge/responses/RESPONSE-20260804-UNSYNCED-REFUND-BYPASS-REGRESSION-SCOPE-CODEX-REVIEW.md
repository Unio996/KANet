# Codex review — refund-bypass regression scope update

## Verdict

`RESTART_REPLAY_CASE_ACCEPTED__TEST_MUST_PROVE_STALE_UNAUTHORIZED_EVENT_CANNOT_REGAIN_EFFECTIVE_AUTHORITY__ALL_REAL_MONEY_MOVEMENT_PRIMITIVES_REQUIRE_THE_SAME_AUTHORIZATION_PREDICATE__PRODUCER_SUPPRESSION_IS_DEFENSE_IN_DEPTH_NOT_THE_PRIMARY_BOUNDARY__NO_MONEY_PATH_AUTHORIZATION`

## Checked source

- Active branch: `bshard-m3-deploy`
- Source commit: `652f02cebc6cb461190505dbe26cd70480a798ab`
- Source path: `docs/iteration/COORD-LEDGER.md`
- Source blob: `cfffd7917ca4be5edfe4a7d00bf9457e7dd05ed5`
- Compared against the previously inspected active-branch range rooted at `df082bbd12d3abc0dc88cb96d9f11e6f06cca566`; this run adds one directly related commit.

## Independent assessment

The added restart/replay case is required and correctly closes a gap in the prior five-scenario test plan. A historical `bettor_refund_available` row is durable audit data, not durable authorization. Restarting a worker, replaying a cursor, rebuilding an in-memory queue, or changing relay availability must not convert that old row into fresh authority to construct, sign, or broadcast a refund.

The test should not merely assert that no new event is emitted. It must seed a pre-existing unauthorized event before worker startup, then execute the real consumer path after restart and assert all of the following:

1. the event remains visible as historical evidence but is classified non-authorizing;
2. no refund claim object is constructed;
3. neither production call site of `pool_side_refund_cancelled_tx` is reached;
4. signer and broadcaster call counts remain exactly zero;
5. repeated restarts and cursor resets remain idempotently blocked;
6. adding unrelated relay keys or changing which node owns a matching key does not change the authorization result;
7. malformed, missing, unknown, revoked, or market-level-only authorization cannot satisfy a transaction-level predicate.

The stronger architectural boundary is the closed set of actual value-moving primitives and their call sites, not the open set of event producers. Suppressing unauthorized event emission and checking every `freezeAwaitingAuthorization()` return value are still required defense-in-depth measures, but they cannot replace a single shared authorization verifier immediately before each real refund IPC/sign/broadcast path.

A passing test must invoke the production consumer and authorization helper rather than reproduce their SQL or inspect source text. The shared predicate should be imported from one implementation and exercised independently at both production IPC call sites; duplicated predicates can produce two tests that agree while the implementations drift.

## Status

This is a regression-scope and architecture acceptance only. It does not close the bypass, authorize implementation deployment, authorize existing-event cleanup, or authorize any refund, claim construction, signature, broadcast, settlement, migration, or restart involving a money path.
