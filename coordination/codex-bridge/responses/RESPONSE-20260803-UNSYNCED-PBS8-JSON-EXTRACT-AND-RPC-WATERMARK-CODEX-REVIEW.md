# Codex independent review — unsynced PB-S8 JSON lookup and RPC alert watermark hardening

## Review basis

- bridge base / initial HEAD: `c99f775184cd9506c76ebe80daaf78552f560e97`
- bridge compare: `c99f775184cd9506c76ebe80daaf78552f560e97...coord/codex-bridge` = identical, ahead 0, behind 0
- active-development compare: `7a2bb5e7bcce68de30abe6a66c025e6f3e8465b9...bshard-m3-deploy` = ahead 19, behind 0
- canonical bridge blobs:
  - `TO-CODEX.md` `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `20607058d225a6a571e47abfaa03840dea3456b7`
- reviewed source blobs on `bshard-m3-deploy`:
  - `kasia-console/src/services/trade-protocol-filter.js` `45076ae5143757c331d642640df076055bc74092`
  - `kasia-console/src/services/pool-market-settler.js` `fd3470cd7f2b177a22a33fcc1df5a376adf4802e`
  - `kasia-console/test-framework/cases/predictions/pool/pbs8_signreq_byzantine_check_regression.test.mjs` `20adcda1a91eb2cc949eb0e5815eafab6fdc6d68`
  - `kasia-console/src/lib/rpc-health-degradation-alert.mjs` `714da9bf9cc05ab0243dbdfe0c1c101e9f920b32`

Increment determination used commit compare, blob identity and actual path diff only. Embedded timestamps were not used.

## Verdict

`EXACT_JSON_KEY_LOOKUP_DIRECTION_ACCEPTED__JSON_VALID_AND_ORDER_CLAIM_IS_NOT_A_PORTABLE_EVALUATION_GUARANTEE__CONSENSUS_QUERY_FAILURE_MUST_NOT_BE_CLASSIFIED_AS_ORACLE_MALFORMATION_OR_FORFEIT__FIRST_ROW_POLICY_REMAINS_TIE_AND_EQUIVOCATION_UNSAFE__SIGNING_QUERY_ERROR_FAILS_CLOSED_LOCALLY__REGRESSION_STILL_DOES_NOT_EXECUTE_REAL_HANDLER_OR_ASSERT_ZERO_SIGN_CALLS__RPC_STOP_START_STATE_RESET_FIX_ACCEPTED__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. Replacing textual `LIKE` with typed JSON-key lookup is directionally correct

The new `(market_id, voter_pubkey)` lookup avoids substring collisions and serialization-format dependence present in the prior `LIKE '%\"key\":\"value\"%'` form. Parameter binding is also preferable to interpolating JSON fragments.

### 2. `json_valid(payload) AND json_extract(...)` must not be described as a guaranteed left-to-right safety boundary

The code and comments rely on the claim that SQLite evaluates the `AND` terms left-to-right and therefore always runs `json_valid` before either `json_extract`. SQL optimizer evaluation order is not an authorization invariant and should not be relied upon as a portable guarantee.

The safer expression is to make invalid JSON structurally incapable of reaching extraction, for example with a `CASE` expression or an equivalent explicitly safe extraction helper, then test against the exact SQLite build used in production. A test that happens to pass on the current build proves observed behavior for that build, not a permanent query-language ordering contract.

This is not merely style: both reviewed readers are money-adjacent. One gates committee signing; the other determines consensus and forfeit/refund behavior.

### 3. A local query-engine failure is not oracle malformation and must not create economic blame

`handlePoolOracleTxSignReq` handles a lookup exception conservatively: that local oracle does not sign and other oracles continue. This is a sound fail-closed local behavior.

`decideConsensusV06`, however, maps a query exception to `malformedCount++` and `malformedSet.add(i)`, with comments stating this becomes silent-equiv / forfeit. That classification is not justified. A database exception, unavailable JSON function, corrupt index, busy/IO error, or query-plan failure is evidence that the local verifier could not determine the vote. It is not evidence that the named oracle emitted a malformed vote.

Required behavior: return `pending` / verifier-inconclusive, emit an operational event, and avoid settlement, refund or stake/reputation consequences until the authoritative vote can be read. Infrastructure failure must not be converted into participant fault.

### 4. `ORDER BY observed_at ASC LIMIT 1` is not yet a complete non-equivocation rule

Choosing the earliest row may be an intentional policy, but the current implementation does not fully define or enforce it:

- equal `observed_at` values have no deterministic secondary order;
- a replayed/backfilled row may have a local observation time unrelated to canonical chain order;
- conflicting outcomes are silently reduced to one row rather than recorded as equivocation;
- the signing reader and consensus reader can diverge if node-local observation ordering differs.

A canonical rule should bind the selected vote to chain ordering / tx identity, define tie-breaking, and explicitly surface multiple distinct outcomes for the same `(market_id, voter_pubkey)` rather than silently hiding them behind `LIMIT 1`.

### 5. PB-S8-2 remains open

The own-vote check binds only `msg.winner` to the local oracle's recorded direction. It still does not independently verify that `phase2_tx_obj` pays the authorized recipients and amounts, uses the expected inputs/outpoints, covenant family, selector/entrypoint, fees/change and network. A correct winner paired with a modified payout object can still reach `sign_input_for_settle`.

No generalized money-path safety claim is warranted until the actual transaction object or its canonical digest is reconstructed and checked against authoritative market state before signing.

### 6. The updated regression is useful but remains source-shape/data-query coverage

The fixture now covers malformed JSON preceding a valid row and demonstrates the guarded query's observed behavior on the test SQLite build. It still does not call `handlePoolOracleTxSignReq`, does not mock `sendCommandAsync`, and does not assert that signer/broadcast invocation count is zero under mismatch, missing vote or query failure.

Minimum handler-level coverage remains:

- mismatch -> `sign_input_for_settle` calls = 0;
- missing vote -> calls = 0 and retry-safe outcome;
- query exception -> calls = 0 while later local oracles continue;
- matching winner + altered payout object -> rejected once PB-S8-2 lands;
- duplicate/conflicting votes -> deterministic fail-closed/equivocation result.

### 7. RPC alert stop/start reset change is accepted, with existing episode caveat retained

Resetting both `_lastSeenMaxFailRowid` and `_dbWatermarkChecked` in `stopRpcHealthDegradationAlertCron()` correctly makes same-process stop/start emulate a fresh monitor lifecycle instead of retaining a half-reset state.

The broader rowid watermark design still defines a new higher-rowid failure during continuous degradation as alert-worthy. That may be intentional escalation, but it is not the same as a formally defined incident episode. Recovery boundary, cooldown/escalation cadence and repeated-failure semantics should remain explicit in monitoring policy.

## Required follow-up

1. Replace reliance on `AND` evaluation order with structurally safe JSON extraction.
2. Change consensus lookup exceptions from participant `malformed/forfeit` to verifier-inconclusive `pending`.
3. Define canonical vote ordering, deterministic ties and explicit equivocation handling.
4. Add real handler tests with signer/broadcast call-count assertions.
5. Complete PB-S8-2 transaction-object authorization binding before treating the committee signature path as closed.

This review does not authorize deployment, restart, schema migration, transaction construction, signing, broadcasting, settlement, refund, wallet/faucet activity, mainnet action, or any production/test asset money-path change.
