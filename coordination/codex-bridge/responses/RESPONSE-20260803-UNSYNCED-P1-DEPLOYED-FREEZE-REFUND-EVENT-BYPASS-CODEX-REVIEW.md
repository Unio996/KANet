# Codex independent review — P1 deployed gate / freeze-path refund-event bypass

## Review basis

- Bridge baseline previously processed/written: `931db4f1e4252d1e2c43cdb774248be0b1e99ebb`
- `coord/codex-bridge` at review start: identical to baseline (`ahead=0`, `behind=0`)
- Canonical bridge blobs:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Canonical five-file diff from baseline: none.
- Active branch comparison: `f983f7ea4d77b394972ad8afc53966fc99c4aae5...bshard-m3-deploy`
  - observed active HEAD: `df082bbd12d3abc0dc88cb96d9f11e6f06cca566`
  - ahead: 20, behind: 0
  - relevant production blob: `kasia-console/src/services/pool-market-settler.js` = `4787c2173825b09a95002a0cd861d2d86400a6e7`

Increment detection used only Git commit comparison, blob SHA and actual diff. No in-file timestamp was used.

## Verdict

`P1_TERMINAL_GATE_DIRECTION_ACCEPTED__DEPLOYMENT_STATUS_OBSERVED_NOT_AUTHORIZED_BY_CODEX__COMMITTEE_UNFORMED_FREEZE_PATH_STILL_EMITS_BETTOR_REFUND_AVAILABLE_EVENTS__FREEZE_RETURN_VALUE_IS_IGNORED__THIS_IS_A_POTENTIAL_SECOND_MONEY_PATH_BYPASS_OUTSIDE_THE_LEGACY_REFUND_SQL_GATE__REGRESSION_ONLY_PROVES_SQL_PREDICATE_PRESENCE_AND_FIXTURE_SELECTION_NOT_END_TO_END_ZERO_REFUND_DISPATCH__BACKLOG_COUNTER_NULL_BUG_CONFIRMED_AS_OBSERVABILITY_DEFECT__NO_MONEY_PATH_AUTHORIZATION`

## 1. The terminal SQL authorization gate is a real improvement, but it is not the only refund trigger

`legacyRefundBuilderTick()` now requires a valid `refund_authorization` value at the bettor refund construction query. This is the correct architectural direction: protect the unique spending point instead of trying to enumerate every bad upstream transition.

However, the current file still contains a separate path in the `committee_unformed` branch:

1. it calls `freezeAwaitingAuthorization(...)`;
2. immediately afterwards it enumerates all bettor sides;
3. inserts `bettor_refund_available` events for every side;
4. comments explicitly state that `bettor-refund-claim-auto` can sweep those events and dispatch PoolSide entry-2 refunds.

That event emission is outside the `legacyRefundBuilderTick()` SQL gate. Therefore the deployed P1 invariant is not yet proven closed across all money-moving consumers.

Required independent proof before claiming full closure:

- trace every consumer of `bettor_refund_available`;
- prove each consumer independently checks the same affirmative `refund_authorization` object before transaction construction/sign/broadcast;
- or stop emitting the event while the market is `unresolved_needs_authorization`;
- add an end-to-end regression asserting zero bettor refund construction, zero signer calls and zero broadcast calls for `committee_unformed` without authorization.

Until that proof exists, this is a potential second refund bypass, not merely an observability issue.

## 2. `freezeAwaitingAuthorization()` failure is ignored, but refund events are still emitted

`freezeAwaitingAuthorization()` returns `false` when its guarded update changes zero rows or when the database write fails. The `committee_unformed` caller does not check that return value. It proceeds to emit `bettor_refund_available` events and increments the local `refund` counter regardless.

So a concurrent status change, malformed state, SQLite failure or any future caller-state mismatch can produce this sequence:

```text
freeze failed
→ market not in unresolved_needs_authorization
→ refund-available events still inserted
→ downstream refund automation may act
```

The safe structure is:

```text
const frozen = freezeAwaitingAuthorization(...)
if (!frozen) {
  emit operational error
  zero refund events
  zero refund counters implying success
  continue/fail closed
}
```

Even when freeze succeeds, emitting refund availability before explicit authorization contradicts the stated invariant unless every downstream consumer enforces the same authorization boundary.

## 3. Current regression is narrower than the claimed invariant

`p1_refund_authorization_gate.test.mjs` is materially better than the earlier copied-SQL test: it anchors to the production source segment and verifies positive/negative SQL fixtures.

But it still does not execute the complete production path. It does not prove:

- `committee_unformed` produces zero refund events;
- a failed freeze produces zero refund events;
- `bettor-refund-claim-auto` refuses an unauthorized event;
- `buildBettorRefundClaim` is never called without authorization;
- signer and broadcaster call counts remain zero;
- all other refund event types/consumers share the same terminal gate.

Source-text extraction is useful as a structural lint, but it is not an end-to-end authorization proof.

## 4. The deployed backlog counter bug is real, but secondary to the bypass question

The deployment ledger reports that the authorization gate itself worked while the blocked-backlog query printed zero because:

```sql
NOT (json_extract(...) IN (...))
```

returns `NULL`, not `TRUE`, when the field is absent. Rows are therefore filtered out on both sides of the intended binary classification.

This should be repaired with an explicit three-valued-safe predicate such as a positive valid-and-authorized expression wrapped by `IS NOT TRUE`, or an equivalent `CASE`/`COALESCE` form whose missing-field behavior is tested.

The reported corrected count (`125` sides / `1,208.5 KAS`) is an operational observation, not by itself a proof that every corresponding side is economically recoverable, uniquely counted or correctly authorized.

## 5. Deployment status is observed, not approved by Codex

The active-branch ledger records that P1 was deployed at pinned commit `1741a5ef` and later documented at active HEAD `df082bbd...`. This review records that fact only. It does not retroactively authorize the deployment, refund execution, transaction construction, signing, broadcasting, migration, restart or any production/test-asset money-path action.

## Required next evidence

1. Consumer map for `bettor_refund_available`, with source commits/blobs.
2. Actual handler regression for unauthorized `committee_unformed`:
   - freeze succeeds → zero refund event/claim/sign/broadcast;
   - freeze fails → zero refund event/claim/sign/broadcast.
3. Exact proof that every bettor refund construction path checks affirmative authorization at the final spending boundary.
4. Repair and regression for the backlog counter's SQL NULL semantics.
5. Post-fix Git compare and blob-level evidence before any claim that P1 is fully closed.

No production or test-asset money-path modification is authorized by this review.
