# Codex independent review — P1 C5 negative tests and bettor-side UTXO classification

## Git inspection basis

- Previously processed / written-back bridge commit: `6b9b335f9202dec02e1d331c1691a4040fa77389`
- Initial `coord/codex-bridge` HEAD: `6b9b335f9202dec02e1d331c1691a4040fa77389`
- Git compare: `identical` (`ahead_by=0`, `behind_by=0`)
- Canonical bridge files: no actual diff
- Canonical blobs:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`

No in-file timestamp was used for incremental detection.

## Unsynchronised active-branch increment

Compared active branch from previously reviewed `f8638df675065749ce5c3e75afcd715dd56cdfdc` to current `bshard-m3-deploy` HEAD `b2d7be08673a7113a6921557ff24e5792771b1cc`:

- ahead: 5
- behind: 0
- changed paths:
  - `docs/iteration/COORD-LEDGER.md` (+61)
  - `kasia-console/test-framework/cases/predictions/pool/p1_bypass_authorization_e2e.test.mjs` (+113)

Relevant source commits include:

- `912d400021512e719446df83e156bb78a23a3804`
- `f593e3b45755bafc2805f6cbf52eb87a265e4a53`
- `26c11dc683e6e0242e53a084f3deb3abb3bcc886`
- `75382bd51a069b356d15b25f94406cc84aa52510`
- `b2d7be08673a7113a6921557ff24e5792771b1cc`

## Determination

`C5_NEGATIVE_SIGNAL_TESTS_ARE_A_REAL_NARROW_GAIN__THEY_PROVE_OLD_STATUS_OLD_REFUND_TXID_AGE_OWNER_TRACE_NULL_METADATA_AND_THEIR_COMBINATION_DO_NOT_CURRENTLY_SATISFY_THE_PRODUCTION_HELPER__THEY_DO_NOT_PROVE_EVIDENCE_DERIVED_AUTHORIZATION__THE_POSITIVE_CONTROL_STILL_PASSES_A_WHITELIST_METADATA_LABEL__THE_NEW_C5_FIXTURES_HAVE_NO_BETTOR_SIDE_AND_THEREFORE_DO_NOT_EXERCISE_THE_AUTO_CONSUMER_OR_ZERO_DOWNSTREAM_MONEY_PATH__THE_108_SIDE_847_01_KAS_LIVE_UTXO_CLASSIFICATION_IS_MATERIAL_BUT_NOT_INDEPENDENTLY_REPRODUCIBLE_FROM_COMMITTED_EVIDENCE__17_SIDE_361_45_KAS_REMAIN_UNCLASSIFIED__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

### 1. Accept the six new C5 cases as a narrow regression improvement

The test now directly invokes the production `assertBettorRefundAuthorized` helper and separately checks that the following cannot authorize a refund:

- old `protocol_status`;
- populated historical `refund_txid`;
- age alone;
- Owner companion fields / narrative alone;
- a `NULL` metadata column;
- all of the above combined.

The fixture-inversion experiment is also useful: inserting a currently accepted authorization value into the combined negative fixture makes the negative assertion fail, so the assertion is connected to the real helper decision rather than a decorative condition.

This satisfies the narrow requested proposition: those legacy signals do not *currently* generate authorization by themselves.

### 2. Do not describe this as semantic authorization closure

The positive control remains:

```text
refund_authorization = "bettors_absent"
```

That proves the current whitelist label is accepted. It does not prove bettors are actually absent, that the label was derived from typed evidence, or that the authorization is bound to exact predecessor state, action, amount, nonce, expiry, revocation, and supersession.

The previously identified adverse fixture remains essential: a market carrying a `bettors_absent` label while a bettor side exists must become a forced rejection once an evidence verifier exists. Until then, a green positive control proves compatibility with the current metadata-label policy, not correctness of the refund fact.

### 3. The C5 additions do not exercise the production consumer path

The six new C5 markets deliberately contain no `pool_bettor_sides` rows and are tested only through the helper. That is reasonable for isolating the five legacy signals, but it means these cases do not prove:

- the automatic consumer handles the rejection outcome;
- a rejected row enters an explicit non-authorizing lifecycle state;
- zero refund object is constructed;
- zero claim is constructed;
- zero signer invocation occurs;
- zero broadcast occurs.

Therefore “Codex #5 closed” is acceptable only as shorthand for the narrow helper-level negative matrix. It must not be used as P1 closure, consumer-path closure, or money-path closure.

### 4. The bettor-side subject correction is important

The reversal from “54 refund transactions prove the bettor backlog was paid” is correct. The new ledger states that the examined refunds were maker-principal refunds and that 0/1510 refund transaction inputs spent bettor `side_lock_tx` outputs. Subject alignment is mandatory: maker-spine evidence cannot settle a bettor-side question.

Accordingly, the earlier landed-refund classification for the 125 bettor sides is withdrawn.

### 5. The 108 / 17 classification is material but not yet independently reproducible

The ledger now reports:

- 108 bettor sides / 847.01 KAS whose exact outpoints are currently live and unclaimed;
- 17 bettor sides / 361.45 KAS still unclassified;
- total 125 sides / 1208.46 KAS;
- 125/125 with no refund authorization.

This is directionally consistent with a frozen/unresolved cohort and it restores amount conservation. However, the cited row-level artifact is `scratch/j2-dryrun-classification.csv`, which is not part of the reviewed committed diff. No committed script output, exact query, CSV, node response, or row-to-outpoint table is available in this increment for independent replay.

Until reproducible evidence is committed or referenced by immutable digest, treat the numbers as a strong team measurement, not a repository-verifiable proof.

Required evidence should include, per side:

```text
market_id + side_id
→ side_lock_tx / output index
→ expected amount
→ current canonical UTXO result
→ claim/redeem/refund transaction if any
→ authorization state
→ classification reason
```

The classifier must fail on malformed column counts and its self-test must use the same parser as production input. The ledger says these safeguards were added, but the implementation and output are not in the reviewed commit range.

### 6. The 17-side cohort must remain non-authorizing and unresolved

For the 17 sides / 361.45 KAS, absence from the current UTXO view cannot distinguish:

- spent by a valid claim;
- spent by an invalid or unexpected transaction;
- never created;
- index/watch-scope blind spot;
- wrong outpoint derivation;
- historical reorg or data loss.

The correct state remains a non-authorizing unresolved classification. It must not trigger metadata backfill, Owner-derived refund authority, automatic retry-to-refund, claim construction, signing, or broadcasting.

### 7. Watched-address coverage is an observability repair, not authorization

Reading `_watchedAddresses` as a periodically refreshed configurable filter supports the revised conclusion that missing `side_p2sh` coverage is a configuration/coverage defect rather than absence of indexing capability. Adding side addresses may improve future auditability, but it cannot reconstruct historical observations already omitted and it must not be presented as evidence that any historical side should be refunded.

Any change to the live watched-address set, indexer load, or money-path-adjacent runtime remains subject to normal design, load, rollback, and evidence controls. This review does not authorize deployment or restart.

## Status

- P1: **OPEN**
- D4: **BLOCKED**
- C5 legacy-signal negative matrix: **accepted as narrow helper-level evidence**
- typed evidence-derived authorization: **not implemented / not proved**
- 108-side live-UTXO cohort: **material but not independently reproducible from committed evidence in this increment**
- 17-side cohort: **unclassified and non-authorizing**

No production refund, claim construction, signing, broadcasting, settlement, migration, metadata backfill, watched-address deployment, restart, or other money-path action is authorized by this review.
