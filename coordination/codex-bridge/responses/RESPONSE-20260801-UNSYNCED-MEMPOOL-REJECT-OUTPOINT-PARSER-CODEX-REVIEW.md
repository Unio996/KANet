# Codex review — unsynced mempool-reject outpoint parser fix

## Authority and scope

- bridge baseline: `8109b5c65dbb4937d09f5c1857bb49202fb2e1ab`
- active source branch: `bshard-m3-deploy`
- source commit reviewed: `4c6759dc9aa2cb2f50ce78083172ee4e9cacf6d6`
- changed source blob: `kasia-relay/src/relay.mjs` = `8e26c6d88ce7759ca496600df59159a881997c09`
- related tracker blob: `kasia-relay/src/lib/transaction.mjs` = `03b6790750f1932d9c11e99408a58cd2ca713904`

No production deployment, restart, signing, broadcast, settlement, refund or other money-path action is authorized by this review.

## Decision

`REAL_FORMAT_MISMATCH_CONFIRMED__PATCH_FIXES_REPORTED_COMMA_FORMAT__REGRESSION_IS_SOURCE_SHAPE_TEST_NOT_RUNTIME_RETRY_PROOF__PARSER_REMAINS_OVERPERMISSIVE_AND_CONTEXT_FREE__TTL_AND_RESTART_GAPS_REMAIN__NO_MONEY_PATH_AUTHORIZATION`

## Independent findings

### 1. The original parser did not match the reported kaspad format

The old expression accepted `(txid)`, `(txid0)` and `(txid:0)`-like forms but not the reported `output (<txid>, 0) already spent ...` form. Therefore, for that exact error string, `m === null` and `markUtxoSpentByOutpoint()` was skipped. The new expression does match the supplied comma-and-space example and preserves colon/bare compatibility.

This code fact is accepted.

### 2. The new test does not prove the retry path works end-to-end

The added test reads `relay.mjs` as text, extracts a regex literal, and tests that literal. It does not execute the actual broadcast catch path and does not prove that:

- `isMempoolReject` routes the runtime exception into the intended branch under the real error object shape;
- the dynamically imported function is called with the expected txid/index;
- the pending map changes;
- the next generator pass excludes the rejected outpoint;
- a different UTXO is selected;
- the retry succeeds or exits deterministically;
- the behavior survives process restart.

The test is useful as a narrow format regression, but its result must not be reported as runtime recovery proof.

### 3. The replacement regex is broader than the stated protocol grammar

Current pattern:

```js
/\(([a-f0-9]{64})[,:]?\s*(\d*)\)/i
```

It is not anchored to `output` or `already spent`, and both the separator and index are optional. It can therefore accept unrelated parenthesized 64-hex tokens elsewhere in a mempool error and silently default the index to zero. It also accepts malformed separator/index combinations that are not demonstrated node formats.

Prefer a parser constrained to the actual semantic phrase and explicit alternatives, for example conceptually:

```text
output (<64hex>, <digits>) already spent
output (<64hex>:<digits>) already spent
output (<64hex>) already spent
```

The parser should reject ambiguity rather than marking a guessed outpoint.

### 4. The 60-second TTL remains a separate unresolved liveness defect

`markUtxoSpentByOutpoint()` writes the same 60-second in-memory expiry used by normal pending tracking. If a conflicting mempool transaction remains present longer than 60 seconds, the same outpoint becomes eligible again. The parser patch can turn a four-immediate-retry loop into temporary exclusion, but it does not establish recovery from an 80-minute mempool conflict.

A durable solution needs one of:

- node/mempool-backed exclusion until the conflict disappears;
- expiry extension driven by observed conflict state rather than a fixed timer;
- per-outpoint backoff/quarantine with explicit reconciliation;
- deterministic alternate-UTXO selection plus a bounded retry receipt.

### 5. Restart loses all exclusion state

`_pendingSpentUtxos` is process memory. A relay restart discards both normal pending marks and mempool-reject marks. The comments describe restart races, but this implementation does not preserve the exclusion across restart. That residual must remain explicit.

### 6. Operational claims remain host-reported

The commit message's 90-minute outage, 3,447 UTXOs, four repeated selections, and manual `4/4 PASS` are useful leads, but no immutable runtime log bundle, command receipt, before/after selected-outpoint trace, or CI run is attached in this commit. Codex accepts the static parser defect and the narrow test logic, not the full operational causal chain as independently reproduced.

## Required evidence before closing the defect

1. Refactor parsing into an exported pure function rather than scraping a regex from source text.
2. Add table tests for accepted real formats and rejected ambiguous/malformed formats.
3. Add a runtime-level test that injects the real RPC error, observes `markUtxoSpentByOutpoint(txid,index)`, then proves the next selection excludes that outpoint.
4. Add a fixture where the conflict persists beyond 60 seconds and specify the expected recovery policy.
5. Add restart/reconciliation behavior or explicitly classify restart as loss of protection.
6. Produce an immutable receipt mapping the reported failed outpoint, retry selections and final successful/failed tx result.

## Authority boundary

This review does not authorize deploying commit `4c6759dc9aa2cb2f50ce78083172ee4e9cacf6d6`, changing the TTL, restarting the relay, constructing/signing/broadcasting transactions, or modifying any production/test asset money path.
