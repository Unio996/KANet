# Codex independent review — unsynced P1 refund-event bypass persists + FactReceipt v0.6

## Git/Blob/Diff basis

- Last processed / written bridge commit: `aca850d3cdce6aa005709a4015a6cf8b7feaa734`
- Initial `coord/codex-bridge` compare against that commit: `identical`, ahead 0, behind 0, no file diff.
- Canonical bridge blobs:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active-branch compare basis: `df082bbd12d3abc0dc88cb96d9f11e6f06cca566...bshard-m3-deploy`
- Compare result: ahead 14, behind 0.
- Directly relevant changed paths:
  - `kasia-console/src/services/pool-market-settler.js` (`d5410f755dfee87256473054751d0a8b6af143f1`)
  - `docs/2026-08-04-fact-receipt-typed-schema-and-domain-digest-design.md`
  - `docs/iteration/COORD-LEDGER.md` (`4b0f116f967d74e80e2561aedaf973c1deb00f8d`)

No increment decision used document timestamps.

## Verdict

`P1_FREEZE_GATES_EXPANDED_IN_MULTIPLE_TIMEOUT_PATHS__COMMITTEE_UNFORMED_BETTOR_REFUND_EVENT_BYPASS_STILL_PRESENT__FREEZE_RESULT_STILL_NOT_CHECKED_BEFORE_EVENT_EMISSION__EVENT_CONSUMER_REMAINS_THE_REAL_MONEY_PATH_BOUNDARY__FACTRECEIPT_V06_TEST_COVERAGE_MAPPING_IS_A_MEANINGFUL_DESIGN_GAIN__DESIGN_ONLY_STATUS_CORRECT__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. P1 coverage has expanded, but the previously identified bypass remains in executable code

The active source now freezes several evidence-inconclusive paths instead of directly dispatching refund, including dispute-grace expiry, quorum timeout and collecting-signatures watchdog timeout. This is the correct direction: elapsed time, local missing signatures and unknown quorum cause are not affirmative refund evidence.

However, the `committee_unformed` path still does the following after calling `freezeAwaitingAuthorization(...)`:

1. enumerates all `pool_bettor_sides` for the market;
2. inserts one `bettor_refund_available` event per side;
3. explicitly labels the event for `PoolSide_v07 entry 2 refund_market_cancelled`;
4. documents that `bettor-refund-claim-auto` will sweep and dispatch it;
5. increments `refund` and continues.

Therefore the money-adjacent signal is still emitted outside the legacy refund SQL authorization gate. The source itself states that the consumer may turn this event into an entry-2 claim. This remains a second potential money path until every consumer is independently proven to require the same affirmative authorization at its final build/sign/broadcast boundary.

### 2. The freeze return value is still ignored

The code does not capture or branch on the result of `freezeAwaitingAuthorization(...)` before emitting refund events. Consequently, DB write failure, guarded-update miss or unexpected market state can still be followed by `bettor_refund_available` publication.

Required invariant:

```text
freeze failed or not proven successful
→ zero refund-available events
→ zero claim construction
→ zero signer calls
→ zero broadcast
```

Even when the freeze succeeds, event emission before affirmative refund authorization should remain prohibited unless the event is renamed/retyped as non-actionable telemetry and all consumers reject it as authority.

### 3. The current terminal SQL gate cannot close this path by itself

The legacy refund builder's affirmative SQL predicate is useful but not sufficient, because this event-driven path can bypass that query entirely. Closure requires code-level tracing of all consumers of:

- `bettor_refund_available`;
- `buildBettorRefundClaim`;
- PoolSide entry-2 claim construction;
- downstream signer and broadcaster calls.

The minimum regression must execute the real producer and consumer chain and assert exact zero counts for event creation, claim build, signature request and broadcast for:

- `committee_unformed` without affirmative authorization;
- freeze returning false;
- malformed/missing authorization;
- unknown authorization values;
- restart/replay of a pre-existing unauthorized event.

A source-text SQL test cannot prove these properties.

### 4. FactReceipt v0.6 is a meaningful design-quality improvement, not implementation closure

The v0.6 document correctly adds dedicated rejection cases for previously untested quorum-envelope checks and introduces a useful self-audit rule: every normative criterion must map to at least one executable test case. It also preserves the earlier important separations:

- `policy_version` outside FactReceipt;
- separate `QuorumEnvelope` for threshold proof;
- algorithm-prefixed digest fields;
- strict unknown-key rejection;
- exact-transaction binding reserved for `SettlementAuthorization`.

The document explicitly remains design-only and states that D-012 prerequisite ① stays OPEN until schema implementation and real red/green tests exist. That status is correct and should not be promoted based on document completeness alone.

## Required next actions

1. Remove or hard-gate `committee_unformed` refund-event emission behind a checked affirmative authorization result.
2. Treat `freezeAwaitingAuthorization(...) !== true` as fail-closed and abort all refund signaling.
3. Trace and review every `bettor_refund_available` consumer to the final transaction/sign/broadcast call.
4. Add real end-to-end zero-call regressions for unauthorized and freeze-failure cases.
5. Keep FactReceipt v0.6 design-only until implementation and executable test vectors are independently reviewed.

## Authority boundary

This review does not authorize deployment, restart, migration, refund, claim construction, signature, broadcast, settlement or any production/test asset money-path action.
