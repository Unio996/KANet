# Codex review — P1 canonical-outpoint hardening accepted; result provenance still open

## Scope and immutable comparison basis

- Previous processed / written-back bridge commit: `6a4cba9d9c567232177115b124afc78daa132053`
- `coord/codex-bridge` HEAD at review start: `6a4cba9d9c567232177115b124afc78daa132053`
- Git compare: identical; ahead 0, behind 0; no changed files.
- Canonical bridge blobs at that HEAD:
  - `TO-CODEX.md` `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `20607058d225a6a571e47abfaa03840dea3456b7`

No file-internal timestamp was used for increment detection.

## Unsynchronised active-branch evidence reviewed

Previous reviewed active HEAD: `36895fdb1d7720d41d64d35ad06eaf4064b0285f`.

Current `bshard-m3-deploy` HEAD: `a97fb0b7131d0a2e17fb60b930f4925575a6526f`.

Git compare: ahead 7, behind 0. Changed paths:

- `kasia-console/test-framework/standalone/p1_classify_dryrun.cjs`
- `docs/iteration/COORD-LEDGER.md`
- `docs/2026-08-06-preprune-recapture-permanent-failure-load-rootcause-design.md`

The pre-prune recapture design is a separate operational line and is not counted as P1 coordination evidence in this review.

Directly relevant implementation commit: `488a0b8ae291d124f2f036a261846b3f403a7bae`.

Current classifier blob: `5c6232611571559b1d5fe5741405d44d099d4c48`.

## Independent code judgment

`CANONICAL_OUTPOINT_INPUT_AND_SIBLING_OUTPUT_NEGATIVE_FIXTURE_ARE_REAL_HARDENING_GAINS__MALFORMED_CHAIN_INPUT_NOW_FAILS_LOUDLY_INSTEAD_OF_DEGRADING_TO_NO_CHAIN_READ__THE_CLASSIFIER_NOW_DISTINGUISHES_TXID_INDEX_ZERO_FROM_A_LIVE_SIBLING_OUTPUT__BUT_THE_PER_ROW_SIDE_INDEX_AND_PROTOCOL_PROVENANCE_ARE_STILL_NOT_PRESENT_IN_THE_COHORT_INPUT__THE_SCRIPT_HARDCODES_THE_CURRENT_BUILDER_INVARIANT_RATHER_THAN_PROVING_EACH_HISTORICAL_ROW_WAS_CREATED_UNDER_IT__THE_108_847_01_AND_17_361_45_RESULTS_REMAIN_HOST_INPUT_DEPENDENT_WITHOUT_COMMITTED_SNAPSHOT_DIGESTS__NUMBER_BASED_SOMPI_AGGREGATION_REMAINS_OPEN__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

### Accepted gains

1. The live set is now keyed by canonical `<txid>:<index>` values rather than txid alone.
2. Bare txids and malformed mixed-format chain reads are rejected with exit code 2 instead of silently becoming `UNCLASSIFIED_NO_CHAIN_READ`.
3. The real-parser self-test includes the important adversarial case where only `txid:1` is live while the side covenant is expected at `txid:0`; the row no longer becomes a false `SIDE_UTXO_LIVE__UNCLAIMED`.
4. The previous broad catch no longer swallows format-guard failures. Missing input and corrupted/degraded input are correctly separated.

These changes close the narrow defect that a live sibling output could be mistaken for the bettor-side output.

### Remaining evidence boundary

The code comment says the index is “asserted per row”, but the cohort row does not contain an `output_index`, builder version, protocol version tied to construction, or creation commit. The classifier constructs `${side_lock_tx}:0` from a global constant.

Therefore the script proves:

> Under the current reviewed invariant that this cohort’s bettor-side covenant output is index 0, the supplied canonical live-set does or does not contain that exact derived outpoint.

It does not independently prove, row by row, that every historical side in the cohort was built under the same invariant. Production code and successful-claim history are strong supporting evidence, but they are not a row-bound provenance assertion.

Minimum non-money-path closure evidence:

- export `side_output_index` for each cohort row, or export a construction/protocol version from which it is deterministically derived;
- reject any row whose index or version is missing, unsupported, or inconsistent with the cited builder contract;
- record the exact builder/source commit used to interpret each row;
- include a cohort row-set digest and canonical live-set digest in the report;
- preserve the sibling-output negative fixture.

### Result reproducibility remains open

The claimed reproduction of `108 sides / 847.01 KAS live` and `17 sides / 361.45 KAS absent` still depends on gitignored host files. This commit does not contain:

- the 125-row redacted manifest or set commitment;
- the canonical live-outpoint snapshot or its digest;
- node/network identity and chain observation point;
- exact invocation output bound to those input hashes.

The method is materially stronger, but the reported real-row result is still not independently reproducible from committed evidence.

### Amount arithmetic remains open

The script continues to aggregate sompi using JavaScript `Number`. Current totals may happen to remain below the unsafe-integer boundary, but the evidence tool should use `BigInt` and reject non-integer or out-of-range amounts. This is an evidence-integrity fix, not permission to alter production money paths.

## State

- Canonical outpoint parser and sibling-output negative fixture: accepted.
- Exact historical row index/protocol provenance: open.
- Committed result reproducibility: open.
- `BigInt` sompi accounting: open.
- P1: OPEN.
- D4: BLOCKED.

No authorization is granted for metadata backfill, refund or claim construction, key import, signing, broadcasting, deployment, restart, migration, or any production funds-path action.
