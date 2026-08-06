# Codex review — P1 input anchors and fail-loud parser hardening

## Verdict

`INPUT_IDENTITY_ANCHORS_AND_NEGATIVE_INPUT_FIXTURES_ARE_REAL_EVIDENCE_QUALITY_GAINS__FOUR_SILENT_INPUT_FAILURES_ARE_NOW_EXPLICITLY_REJECTED__THE_REPORTED_125_SIDE_1208_46_KAS_RESULT_IS_NOW_BOUND_TO_SPECIFIC_PRIVATE_INPUT_BYTES_AND_A_SPECIFIC_CLASSIFIER_BLOB__THIS_ESTABLISHES_RESULT_IDENTITY_NOT_INDEPENDENT_RESULT_CORRECTNESS__HOST_PRIVATE_ROWS_AND_CHAIN_SNAPSHOT_REMAIN_UNAVAILABLE_FOR_EXTERNAL_REPLAY__PER_ROW_HISTORICAL_BUILDER_PROVENANCE_REMAINS_UNPROVED__NUMBER_BASED_SOMPI_ACCOUNTING_REMAINS_OPEN__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

## Scope checked

Active branch compare base: `a97fb0b7131d0a2e17fb60b930f4925575a6526f`

Active branch reviewed head: `36ef74793268a69a8379262e54ea072fbd459f53`

Directly relevant committed artifacts:

- `kasia-console/test-framework/standalone/p1_classify_dryrun.cjs`
  - blob: `e7957f695ed7dca40d940d6549397167150a329b`
  - principal implementation commit in this interval: `64b1f7a4ae950942503e3a4f78e3434385d46bb0`
- `docs/2026-08-06-p1-evidence-input-anchors.md`
  - blob: `6248086e2f4d8ba0d6be2cf55e7fa40fd4127028`

The other active-branch changes concerning pre-prune recapture/root-cause design are operationally separate and are not treated as P1 bridge evidence here.

## Independent code-level findings

### 1. Four previously silent evidence-input defects were real, not merely hypothetical missing tests

The current classifier now rejects or detects:

1. CRLF header contamination that could make the final column unreadable on every row;
2. duplicate cohort rows and duplicate `side_lock_tx` money identities;
3. duplicate live-set outpoints that `Set` previously collapsed silently;
4. empty cohorts that previously exited successfully with a misleading zero-result report.

The negative fixtures are materially useful because they test the refusal path, not only successful input. This is a real hardening gain for the evidence tool.

The controlled CRLF finding is especially important: a column such as `auth` could otherwise appear NULL by parser construction rather than by data. The current code strips trailing CR and checks LF/CRLF equivalence. The repository record also states that the actual cohort used for the reported result was LF, so this discovered bug does not by itself invalidate the previously reported `125/125 authorization NULL`; it shows that the prior tool lacked a guard against a future or alternate CRLF input.

### 2. The anchor document materially improves byte-identity and result-binding

The committed anchor document binds the reported run to exact SHA-256 values for:

- the 125-row cohort CSV;
- the 158-entry canonical live-outpoint input;
- the generated classification CSV;
- the classifier git blob;
- the observed network/DAA context.

This closes an important ambiguity: a later export can no longer be casually treated as the original cohort if its bytes differ. It also records that the same 158-entry live-set file hash was independently calculated on two machines.

This supports the narrow statement:

> The reported `108 sides / 847.01 KAS live`, `17 sides / 361.45 KAS absent`, total `125 sides / 1208.46 KAS`, and `125/125 authorization NULL` are associated with the specifically hashed private inputs and classifier blob recorded in the anchor document.

### 3. The anchors do not prove that the private input contents are correct

The document correctly states its own limitation. A hash proves identity of bytes, not truth of the rows or completeness/correctness of the chain observation.

External independent replay still lacks the private row-level cohort and full chain snapshot. Therefore the following remain unproved from committed public evidence alone:

- that all 125 exported rows are the exact intended runtime cohort;
- that each row's `side_lock_tx` and stake amount are correct;
- that the 158 observed outpoints are complete for the relevant addresses and observation point;
- that every historical row was created under the current index-0 builder convention;
- that the classification output can be independently regenerated without access to the private inputs.

The correct status is therefore:

- method reproducibility: improved;
- input/result identity: established for the recorded run;
- independent result reproducibility: not established;
- semantic correctness of every private row: not established.

### 4. Historical per-row output-index provenance remains inferred globally

The classifier still derives each side outpoint as `side_lock_tx:0` using a global constant and current production builder source. The cohort input does not carry a per-row `output_index`, builder version, or construction commit.

The canonical-outpoint and sibling-output guards prevent txid-only false positives. They do not independently prove that every historical cohort row was created under the same index-0 convention. A future evidence closure should bind each row to its construction convention or explicitly export the recorded/derived output index with provenance.

### 5. Sompi aggregation still uses JavaScript `Number`

The real-run code still converts `stake_amount` with `Number` and aggregates sompi using floating-point numbers. The present total may be below the unsafe-integer threshold, but an evidence tool should not rely on cohort size to preserve exactness.

Required hardening remains:

- parse integer sompi with `BigInt`;
- reject non-integer, negative, malformed, or out-of-range stake values;
- perform conservation in `BigInt`;
- format KAS only at the presentation boundary.

### 6. No money-path authority follows from these findings

The new evidence concerns classification integrity and reproducibility only. It does not create typed refund authorization, prove a valid refund predicate, locate a lawful signer, or authorize claim construction, signing, broadcast, migration, metadata backfill, deployment, or restart.

## State

- parser/input fail-loud hardening: **accepted**
- byte-level input/output anchors: **accepted as identity evidence**
- reported result bound to recorded private inputs and classifier blob: **accepted narrowly**
- independent replay from committed evidence: **open**
- per-row historical builder/index provenance: **open**
- exact `BigInt` sompi accounting: **open**
- P1: **OPEN**
- D4: **BLOCKED**

No production money-path modification or deployment is authorized by this review.
