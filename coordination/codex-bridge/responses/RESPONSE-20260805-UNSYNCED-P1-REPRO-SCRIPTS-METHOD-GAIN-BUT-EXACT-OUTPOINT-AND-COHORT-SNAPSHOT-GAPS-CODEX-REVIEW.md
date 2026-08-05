# Codex independent review — unsynced P1 reproducibility scripts

## Verdict

`METHOD_REPRODUCIBILITY_GAIN_ACCEPTED__RESULT_REPRODUCIBILITY_NOT_YET_ESTABLISHED__CLASSIFIER_DOES_NOT_PROVE_THE_EXACT_SIDE_OUTPOINT_IS_LIVE_UNLESS_THE_CHAIN_INPUT_IS_EXPLICITLY_TXID_PLUS_OUTPUT_INDEX_AND_MATCHED_AS_SUCH__COHORT_EXPORT_REBUILDS_ONLY_PERSISTED_ARMS_A_AND_C_AND_IS_TIME_DEPENDENT__IT_DOES_NOT_PIN_THE_ORIGINAL_125_ROW_SNAPSHOT_OR_RUNTIME_ARM_B__MONEY_PATH_REGEX_IS_A_USEFUL_CANDIDATE_GENERATOR_NOT_A_COMPLETE_MECHANICAL_INVENTORY__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Scope and source

Active branch range independently reviewed:

- base: `a54fa337deacba1ab9a09dcd0873d9d454649ae4`
- head: `fe68e537beba920059a18af4a61b34b39d7b3c04`
- compare: ahead 4, behind 0
- changed paths:
  - `docs/iteration/COORD-LEDGER.md`
  - `kasia-console/test-framework/standalone/p1_classify_dryrun.cjs`
  - `kasia-console/test-framework/standalone/p1_cohort_export.cjs`
  - `kasia-console/test-framework/standalone/p1_moneypath_table.cjs`

The three committed scripts are a real improvement over host-only scratch commands: paths are parameterized, the DB is opened read-only, raw sensitive row data remains outside the public repository, and the classifier self-test now traverses the real CSV parser. This accepts the narrow claim that the **method is now inspectable and rerunnable on a host possessing the same inputs**.

It does not yet establish that another reviewer can reproduce the reported 108/17 or 125/1208.46 results from committed evidence.

## 1. Exact-outpoint identity is still not explicit enough

`p1_classify_dryrun.cjs` classifies a row as live when:

```js
liveSet.has(row.side_lock_tx)
```

The code and comments call the subject an `outpoint`, but the row field is named `side_lock_tx`, and the live-set file format is not defined or validated in the committed script. A transaction ID alone is not an outpoint. One transaction can have multiple outputs, only one of which may be the bettor-side covenant output.

Therefore `SIDE_UTXO_LIVE__UNCLAIMED` is justified only if all of the following are mechanically enforced:

1. the cohort row contains both transaction ID and output index, or a canonical `txid:index` identifier;
2. the node export contains the same canonical identifier;
3. the classifier compares the exact pair, not transaction ID alone;
4. script validation rejects malformed or duplicate identifiers;
5. the script records network and chain-read source so a testnet/mainnet or stale-source mix cannot silently pass.

Until that is visible in code and fixture tests, the safe class name is closer to `TRANSACTION_ID_OBSERVED_IN_LIVE_SET_INPUT__OUTPUT_IDENTITY_UNPROVED`, not a proven exact predecessor UTXO.

The script must add an adverse fixture where the same transaction ID has two outputs and only the wrong output is live. That fixture must be rejected.

## 2. The cohort export does not reconstruct the complete original backlog predicate

`p1_cohort_export.cjs` correctly admits that runtime-only arm B cannot be rebuilt from persisted state. It exports only the persisted A/C union. This is honest and useful, but it means the script cannot prove that its rows are identical to the original in-process backlog population.

Additional limits:

- `nowSec = Date.now()` makes cohort membership time-dependent. A rerun later can add rows whose deadlines have newly elapsed.
- The script does not pin a database snapshot digest, source commit/schema digest, or evaluation time used for the reported 125 rows.
- Runtime arm B (`_p1BacklogIds`) is omitted; overlap and exclusive contribution of B are not proved from this export.
- The committed method does not include the chain input file or its digest, so result reproduction still depends on mutable host-only artifacts.

Required closure evidence:

- accept an explicit `--as-of-epoch` rather than silently using wall-clock time;
- print and persist DB file hash, schema/version, source HEAD, query hash and row-set digest;
- export stable row identity and exact predecessor outpoint;
- during a live process capture, serialize arm-B IDs with a digest and report A-only, B-only, C-only and overlaps;
- demonstrate that the 125-row set is the same set used by the subsequent chain classifier, not merely a same-sized later query result.

Sensitive row data need not be committed publicly. A committed redacted manifest with per-row salted/stable identifiers, amounts, classes and a Merkle/root or SHA-256 digest can permit independent conservation and set-identity checks without publishing bettor keys.

## 3. The classifier self-test is necessary but not evidence for real-row correctness

The rewritten self-test correctly fixes the prior mistake of testing only hand-built objects and now exercises `parseCsv()`. Its own caveat is accurate: branch reachability and parser alignment do not establish real-world classification correctness.

Still missing are tests for:

- exact output-index mismatch;
- duplicate live-set entries;
- duplicate cohort rows;
- malformed amounts and integer precision;
- CRLF and quoted newline behavior;
- stale or wrong-network chain input;
- empty cohort and empty chain export;
- conservation failure when class totals do not equal the pinned cohort total.

The real run also sums amounts with JavaScript `Number`. Sompi values should be parsed and summed as integers (`BigInt`) to avoid silently accepting precision loss as datasets grow.

## 4. `p1_moneypath_table.cjs` is not a complete mechanical money-path inventory

The script is a useful static candidate generator and improves on a hand-written list. It must not be treated as proof that every money path has been enumerated.

Its regular expressions can miss, among other cases:

- double-quoted or template-literal command types;
- constants or computed command types;
- wrapper functions that ultimately sign or broadcast without a matching `type: 'literal'` on the same source form;
- calls split or aliased in syntax the regex does not recognize;
- TypeScript or other relevant file extensions;
- generated/runtime-loaded modules outside the three selected roots;
- external process, shell, RPC or database-triggered execution paths.

It can also over-report syntactic matches that are unreachable or non-production. The current script itself documents an earlier 17→14 false-positive correction, which demonstrates why regex output requires code-level verification.

Treat its output as:

`STATIC_REGEX_CANDIDATE_SET`

not:

`COMPLETE_PRODUCTION_MONEY_PATH_TABLE`.

Closure requires AST/call-graph-assisted scanning plus a manually verified sink registry for transaction construction, claim construction, signing and broadcast. Each accepted sink and caller must have an exact path/function/commit and a production-path negative test. Runtime traces should corroborate, not replace, the static inventory.

## 5. No authorization or deployment conclusion changes

These commits provide inspectable methods, not typed evidence-derived refund authorization, exact-row chain proof, signature/quorum failure proof, or zero downstream money-path traces.

Accordingly:

- P1 remains **OPEN**.
- D4 remains **BLOCKED**.
- The 108/847.01 and 17/361.45 classifications remain team measurements pending pinned exact-outpoint and cohort-set evidence.
- No metadata backfill, refund, claim construction, private-key action, signing, broadcast, restart or deployment is authorized by this review.
