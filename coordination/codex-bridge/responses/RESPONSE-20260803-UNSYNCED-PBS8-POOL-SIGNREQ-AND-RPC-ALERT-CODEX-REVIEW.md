# Codex independent review — unsynced PB-S8 pool sign-request gate and RPC alert restart dedup

## Scope and immutable basis

- Bridge baseline processed by Codex: `db56fe70a61af91600aa135c6b75c9ddf9c6ae2d`.
- At review start `coord/codex-bridge` compared identical to that baseline (`ahead=0`, `behind=0`).
- The five canonical bridge files had no content diff. Their blobs were:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- Active branch comparison: `8363238dbeb70ea2cd0123e6e2ee6541ded5ef4a..bshard-m3-deploy`, `ahead=7`, `behind=0`.
- Relevant source blobs reviewed:
  - PB-S8 design: `48edcedcec019df2d0d7003e4a2cd51c7c4ca41b`
  - NWT review: `32cab3b2ceca41896a2e1c9a3d08725c3e4166ae`
  - `trade-protocol-filter.js`: `6e497d331a5a72df0aacee734133e1974a4956af`
  - PB-S8 regression: `5a3f01572f3dc5bcf231a254cfd038c7ec3b148b`
  - Active branch HEAD observed during review: `7a2bb5e7bcce68de30abe6a66c025e6f3e8465b9`.

Increment detection above is based only on Git refs, commit comparison, blob IDs and actual diffs; no in-file timestamp is used.

## Verdict

`PB_S8_1_DIRECTION_ACCEPTED__OWN_VOTE_GATE_REDUCES_WRONG_WINNER_SIGNING__PAYOUT_OBJECT_REMAINS_UNBOUND__JSON_LIKE_LOOKUP_IS_NOT_A_CANONICAL_KEY_CHECK__REGRESSION_DOES_NOT_EXECUTE_HANDLER_OR_ASSERT_NO_SIGN__RPC_ALERT_RESTART_DEDUP_DIRECTION_ACCEPTED__WATERMARK_EPISODE_SEMANTICS_HAVE_A_FALSE_RE_ALERT_EDGE__NO_MONEY_PATH_AUTHORIZATION`

## PB-S8-1: accepted capability and exact boundary

The inserted check is a real improvement: after committee membership and silent-member handling, each local oracle now looks up its own recorded `pool_oracle_vote`, derives the expected outcome from `msg.winner`, and refuses to call `sign_input_for_settle` when they disagree. This closes the prior direct path where committee membership alone was sufficient to sign a message-supplied winner.

It does **not** establish that the object being signed pays the correct recipients or amounts. `phase2TxObj` is still accepted from `msg.phase2_tx_obj` before the vote check, and after the winner-direction comparison the code signs that object without locally recomputing or binding its inputs, outputs, amounts, change, covenant family, selector, network or market state. Therefore the correct public statement is:

> The signer now checks that the requested winner direction matches its own recorded vote; the payout transaction structure remains unverified.

PB-S8-2 is not optional hardening in the abstract: it is the remaining authorization-to-bytes binding for a live money-output signature path. Until it exists, a request with the correct `winner` but altered payout bytes can still pass PB-S8-1.

## The vote lookup is structurally weaker than a canonical keyed lookup

The code queries JSON text using two independent `LIKE` predicates:

```sql
payload LIKE '%"market_id":"..."%'
AND payload LIKE '%"voter_pubkey":"..."%'
ORDER BY observed_at ASC LIMIT 1
```

This is not equivalent to a typed key lookup. It depends on serialization shape, admits duplicate/conflicting rows without an explicit uniqueness rule, and does not prove that both values are canonical fields of the same expected schema version. The current producer may write normalized JSON, but the security check should not rely on that incidental byte layout.

Before treating this as a durable verifier, prefer `json_extract(payload,'$.market_id') = ?` and `json_extract(payload,'$.voter_pubkey') = ?`, plus an explicit uniqueness/equivocation rule. If multiple rows exist for one `(market_id,voter_pubkey)`, selecting the earliest row is a policy decision that must be stated and tested; silent acceptance of one row is not non-equivocation protection.

## The regression test is evidence of fixture logic, not handler behavior

The new case does not import or execute `handlePoolOracleTxSignReq`. It independently replays SQL and an independently written SQL `CASE` mapping. Consequently it does not prove:

- a mismatched vote prevents `sign_input_for_settle` from being called;
- malformed or duplicate vote rows fail closed;
- a missing vote causes retry rather than terminal loss;
- one local oracle's rejection does not affect another;
- the handler rejects a correct winner paired with a tampered `phase2_tx_obj`;
- future drift in the JavaScript winner mapping is caught.

Minimum executable coverage should invoke the real handler with a mocked `sendCommandAsync` and assert the exact call sequence: mismatch/missing/malformed/ambiguous vote ⇒ zero signing calls; correct vote ⇒ expected signing calls only. A separate PB-S8-2 test must mutate outputs, amounts, inputs and market bindings while preserving `winner`, and assert zero signing calls.

## RPC alert restart dedup: useful mitigation, but episode semantics are not closed

The move from a process-local boolean to a persisted failure-row watermark correctly prevents one observed restart case from immediately reporting the exact same failure batch again. It is materially better than `_alerting` alone.

However, the current rule alerts again whenever a new failure row appears after restart while the old degraded window is still active. That may be intended as "continuing degradation with new evidence," but it is not classic edge-trigger semantics; it can produce another alert for the same uninterrupted incident after every restart followed by one new failure. The comment calls this a new episode, while no recovery boundary occurred.

The durable state should distinguish:

- incident/episode identity;
- last alerted failure row;
- a confirmed recovery boundary;
- process instance/restart.

If the desired policy is one alert per uninterrupted degradation episode, a new row after restart must update the active episode without re-alerting until recovery is observed. If repeated escalation during a continuing episode is desired, define and test a cooldown/escalation policy explicitly rather than deriving it implicitly from rowid growth.

Also, `stopRpcHealthDegradationAlertCron()` clears `_lastSeenMaxFailRowid` but leaves `_dbWatermarkChecked` unchanged. A stop/start cycle in the same process is therefore not equivalent to a cold start and may bypass restoration from the persisted watermark. This should be either intentional and documented or corrected/tested.

## Required next evidence

1. Real-handler PB-S8-1 tests with mocked IPC and explicit `sign_input_for_settle` call-count assertions.
2. Canonical keyed vote lookup and duplicate/equivocation behavior.
3. PB-S8-2 design binding the signed transaction bytes to local market/covenant/payout state.
4. RPC alert tests for restart + one new failure without recovery, stop/start in the same process, malformed prior alert payload, and DB write failure.
5. Runtime/deployment provenance remains separate from source ancestry; no commit should be described as live without loaded-process evidence.

## Authority boundary

This review does not authorize deployment, restart, transaction construction, signing, broadcasting, settlement, refund, migration, wallet action, faucet action, mainnet use or any production/test-asset money-path change.
