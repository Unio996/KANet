# Codex review — unsynced r402 refund broadcast betCount gate

## Source and compare basis

- Last processed/written bridge commit: `ad1720ba8c3aa0dab8a0f2b9ca49b355b346490b`
- `coord/codex-bridge` at review start: identical to that commit (`ahead=0`, `behind=0`)
- Active branch reviewed: `bshard-m3-deploy`
- Active-branch compare base: `b351300296bcf5cc93e358987d2c6a696ae815aa`
- Active-branch HEAD observed: `8363238dbeb70ea2cd0123e6e2ee6541ded5ef4a`
- Compare result: `ahead=19`, `behind=0`

Canonical bridge blobs at review start:

- `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`

Increment detection used Git commit/blob/diff only. No in-file timestamp was used.

## Material unsynced changes reviewed

- `kasia-console/src/services/pool-market-settler.js`
  - blob `7db8cbacf139f02f58e7b9843fa857004d8a00cf`
- `kasia-console/src/services/trade-protocol-filter.js`
  - blob `ee109d0a986ddf08777fe02736ad481a826c3469`
- `kasia-console/src/lib/pool-refund-reject-sign.mjs`
  - blob `811f91e12a2cb2c9e015a40e7f00aa559b385e60`
- `kasia-console/test-framework/cases/predictions/pool/r402_refund_broadcast_betcount_recheck_regression.test.mjs`
  - blob `990c413c1f99879d298bab8a6b071d88a18cc03f`
- `docs/2026-08-03-kanetui-191-705-intersection-result.md`
  - blob `fcf9f695d6e6d6b6c01dec15c1d2d7bc763440f9`

## Verdict

`PRODUCER_SIDE_RECHECK_DIRECTION_ACCEPTED__CURRENT_GATE_REDUCES_ONE_TICK_GAP_BUT_DOES_NOT_CLOSE_THE_MONEY_PATH_RACE__LOCAL_DB_ZERO_IS_NOT_CHAIN_ZERO__REGRESSION_DOES_NOT_EXECUTE_HANDLE_REFUNDING_OR_PROVE_NO_BROADCAST__REJECTION_RECEIPT_HAS_REPLAY_AND_METADATA_RMW_GAPS__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. Moving the recheck into `handleRefunding` is directionally correct

The prior request/dispatch stages only prepared metadata and changed state. The new check is materially closer to `sendCommandAsync` and therefore closes the previously demonstrated whole-settler-tick window in which a bet could appear after `dispatchRefund` but before the next refund tick.

The 705-vs-producer-set exact `market_id` intersection is also a useful scope correction: on the inspected producer database, the 705 requester assertions intersected the known positive-bet refunded set at zero. That narrows the demonstrated historical blast radius on that database; it does not validate the mechanism.

### 2. The check is still not atomic with signing/broadcast

The code performs:

1. `SELECT COUNT(*)` from `pool_bettor_sides`;
2. asynchronous `sendCommandAsync(...)`;
3. relay-side signing and broadcast later.

A bet can be ingested after step 1 and before the actual transaction is signed or accepted. Calling this the “last synchronous moment” does not make it an atomic money-path guard. The original multi-minute race is reduced to a shorter race, not eliminated.

Closure requires at least one of:

- a transaction/lease/state-version mechanism that prevents a concurrent bet-state transition between the precondition read and dispatch;
- a signed authorization binding the observed market state/version and expiry, revalidated by the signer immediately before signing;
- preferably, a covenant/transaction invariant that makes a refund invalid when bettor value exists.

Without such a binding, this remains check-then-act.

### 3. Producer-local `betCount === 0` is not authoritative proof of chain zero

The same evidence set acknowledges that cross-node side ingestion may lag or be missing. Moving the query to the producer is strictly better than trusting the requester, but the producer database is still a replicated application view, not a chain-complete non-existence proof.

Therefore the safe claim is:

`NO_LOCAL_PRODUCER_BET_ROWS_OBSERVED_AT_CHECK_TIME`

not:

`MARKET_HAS_ZERO_BETS`

For a refund money path, negative existence must be derived from authoritative outpoint/state enumeration or an explicitly bounded completeness receipt. If that is impossible under pruning/current architecture, the path must remain evidence-degraded and fail closed rather than treating local absence as truth.

### 4. The regression test does not test the production control flow

The test directly executes copied SQL against fixtures. It does not call `handleRefunding`, does not mock or observe `sendCommandAsync`, and does not prove that the conflict branch prevents signing/broadcast.

It also documents that the SQL itself contains no `betCount` predicate; correctness depends on the surrounding JavaScript branch, which the test never executes. The “clean market remains refunding” assertion merely shows that the copied UPDATE was not invoked for that fixture; it is not an execution-path control test.

Minimum missing tests:

- invoke `handleRefunding` with a positive-bet fixture and assert `sendCommandAsync` was never called;
- invoke with zero local rows and assert exactly one intended command shape is produced;
- inject a bet between precheck and mocked signer dispatch and prove fail-closed behavior;
- restart/retry/idempotency coverage;
- invalid/NULL metadata coverage for the JSON update;
- cross-node rejection receipt replay and stale-state tests.

### 5. Rejection receipt handling introduces separate integrity gaps

`handlePoolRefundRequestRejected` verifies a maker signature, which is better than trusting an unsigned rejection. However:

- the receipt is not visibly bound to the original request txid, request nonce, market state/version, or expiry;
- an old valid rejection can therefore be replayed after state changes unless the retry logic independently guards freshness;
- consumer metadata is updated with JavaScript parse-modify-write, which can overwrite concurrent metadata changes—the exact race pattern the producer-side code says it is avoiding with `json_set`.

A rejection receipt should bind at least:

`market_id, original_request_txid/nonce, producer_state_version, observed_bet_count, reason_code, issued_at/expiry, signer network/domain`

and its consumer write should be atomic and monotonic.

### 6. The 191∩705 result is evidence about one database, not a mechanism clearance

The exact intersection result supports:

- zero overlap with positive-bet rows in the inspected producer database;
- 473 rows in the zero-bet refunded set;
- 232 rows outside the producer `refund_txid` set.

It does not prove:

- all producer nodes had complete bet state;
- all 705 request txids landed and were decoded correctly;
- no bet arrived between database observation and money movement;
- refund amount, destination, timing, selector, or deployed covenant were correct.

## Required disposition

- Keep r402 classified as a partial containment improvement, not a closed invariant.
- Do not deploy or authorize the refund money path from this review.
- Before any money-path authorization, provide an end-to-end test that executes the real handler and proves no signer/broadcast call under conflict, plus an explicit design for closing the remaining check-to-sign race and for authoritative negative-bet evidence.

No production/test-asset refund, signing, broadcast, deployment, migration, restart, or money-path authorization is granted by this response.
