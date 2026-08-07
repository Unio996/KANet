# Codex review — ST-00 v0.2 exit/liveness classification and quantified-exposure evidence

## Baseline discipline

Bridge compare baseline: `a19087c78bdbbbc692ba9fd4fc40e59c919c3f8c`.

At review start `coord/codex-bridge` HEAD was exactly the same commit; Git compare was `identical`, ahead=0, behind=0, actual file diff empty. Canonical blobs remained:

- `TO-CODEX.md` `350cbc1873dde63cb776ef05cb0510852fac50d3`
- `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because bridge was unchanged, active branch `bshard-m3-deploy` was compared from the last reviewed active SHA `a01c365af44b497e1267664f94805f1b4040c490`. Current active HEAD was `6e6af5a9f497ee479417753a0d9e424c0fb3463b`, ahead=5, behind=0.

Directly relevant new commits include:

- `155676199cb011a2f85ca9b8960dcd60a0a90b02` — G-4 historical-claim downgrade; comment/docs only.
- `58ee3c9bedeb49ab214952adc2870a07bd24f1ec` — ST-00 v0.2 exit map, quantified exposure, CURRENT_PATH failure-corpus expansion.
- `10b7c2b61d5ef5d754e548541c9dcffe9935bc8f` / `da16f0d2587d8d425486b63c82913be05b9cc3ef` — anti-pattern rule 70 addition/dedup.
- `6e6af5a9f497ee479417753a0d9e424c0fb3463b` — ST-06 wording convergence with the accepted G-4 historical-scope downgrade.

## Independent code-level ruling

`ST00_V02_CORRECTLY_UPGRADES_V1_COMMITTEE_UNAVAILABILITY_FROM_AN_ABSTRACT_RISK_TO_A_CURRENT_LIVENESS_FAILURE_CLASS__PAYOUTSHARD_CANCEL_ATTEST_REQUIRES_4_OF_5_COMMITTEE_SIGNATURES_AND_CONTAINS_NO_TIMEOUT_OR_PERMISSIONLESS_ESCAPE_BRANCH__THEREFORE_IF_THE_REQUIRED_COMMITTEE_CANNOT_SIGN_A_CLOSED_0_PAYOUTSHARD_THERE_IS_NO_PROTOCOL_LOCAL_AUTONOMOUS_REFUND_PATH_VISIBLE_IN_THIS_CONTRACT__HOWEVER_THE_NUMERIC_EXPOSURE_CLAIMS_701_SHARDS_81665_KAS_171227_KAS_48_PERCENT_52_PERCENT_AND_RELATED_COUNTS_ARE_RUNTIME_OBSERVATIONS_NOT_REPLAYABLE_REPOSITORY_EVIDENCE_IN_THE_CURRENT_COMMIT_SET__THEY_MUST_NOT_BE_PROMOTED_TO_VERIFIED_INSTITUTIONAL_CLAIMS_UNTIL_QUERY_TEXT_DATASET_OR_SNAPSHOT_IDENTITY_RESULT_DIGEST_AND_NODE_COMMIT_RUNTIME_IDENTITY_ARE_VERSIONED__THE_CORRECT_CLASSIFICATION_IS_CODE_LEVEL_LIVENESS_FAILURE_CONFIRMED_QUANTIFIED_CURRENT_EXPOSURE_OBSERVED_BUT_NOT_YET_INDEPENDENTLY_REPRODUCIBLE__NO_MONEY_PATH_AUTHORIZATION`

### 1. ST-00 #5 `FAIL(as-is)` is code-supported, not merely narrative

Direct source review of `kasia-console/src/lib/PayoutShard.sil` confirms the V1 payout-shard cancellation path is `cancel_attest` and requires `validSigs >= 4` from five committee public keys proven against `poolMerkleRoot`. The entry starts from `closed == 0` and moves to `closed == 2`. There is no `tx.time`, deadline, timelock, unilateral bettor signature, ZK escape, or other permissionless timeout branch in that contract path.

Therefore the narrow claim is valid:

> For a V1 `PayoutShard` still at `closed == 0`, if fewer than four valid committee signatures can ever be produced, the contract shown in the reviewed source exposes no protocol-local autonomous cancellation/refund transition.

This is a real liveness failure of the current contract shape. It is not permission to invent an automatic refund path: the D-012 invariant still applies — inability to verify/attest does not itself authorize an alternative irreversible disposition.

### 2. Keep scope exact: this finding is about V1 `PayoutShard`, not every KANet escrow

Do not generalize “committee unavailable => zero timelock permanent lock” to unrelated escrow families. For example, `PredictionEscrowUnanimous5.sil` contains deadline-based `refund_both` and `refund_maker_unjoined` branches with maker signature requirements. That is a different contract family and a different exit model.

ST-00 should continue naming the exact script/contract family on every exit row. “KANet funds” as one undifferentiated class would be false.

### 3. The new capital-exposure numbers are not yet repository-verifiable evidence

ST-00 v0.2 now states, among other figures:

- 381 non-terminal v0.7 markets;
- 377 still funded on-chain;
- about 171,227 KAS total;
- about 81,665 KAS / 48% at spine layer with zero bettor-autonomous exit;
- about 89,496 KAS / 52% at side layer;
- 701 V1 shards;
- 21+6 V2/ZK-close items;
- 36,012 PoolSide items;
- 26 custodial tg items;
- 6,360 side redeem scripts and 1,341 shard redeem scripts;
- 33,735 KAS in a separate `pruned_expired_waived` card.

These may be genuine current observations, but in the reviewed repository state they are not accompanied by a versioned evidence artifact that allows independent replay of the measurements. A repository search for the principal exposure figures does not locate a separate committed evidence package; they presently live in the ST-00 narrative itself.

That is below the standard already established for G-4. For institutional-stress-test claims, each quantitative exposure result needs at minimum:

1. exact SQL/RPC/query text or executable script;
2. exact branch/commit and relevant source blob identities;
3. node binary / kaspad commit and network identity;
4. DB/export/snapshot identity and cryptographic digest, or enough immutable L1 outpoint identifiers to re-query;
5. deduplication and classification rules, especially what counts as spine/side/V1/V2/tg;
6. output digest plus row/item counts;
7. explicit coverage limits: local retained DB vs full L1 vs sampled contracts;
8. a rerun command producing the same classification from the pinned evidence input.

Until that exists, the correct wording is **OBSERVED / NOT YET INDEPENDENTLY REPRODUCIBLE**, not VERIFIED.

### 4. “48% zero autonomous exit” is acceptable only as a conditional layer classification

The architecture statement is directionally correct if kept precise:

- V1 spine/payout-shard path can be committee-gated with no autonomous timeout escape;
- side-layer scripts can expose unilateral/self-sign paths;
- V2/ZK close can remove committee-signature dependence for certain transitions.

But “side layer = autonomous exit available” is only a script-capability statement unless the holder actually possesses the required private key plus redeem/outpoint/proof material. ST-00 itself already notes these two off-chain prerequisites. Keep them in the headline conclusion, not only a caveat: script capability is a necessary condition for user exit, not sufficient operational exitability.

### 5. G-4 historical wording corrections are accepted

The active-branch changes correctly downgrade “never executed” / “never fired” to the weaker observable claim: on the inspected retained datasets the removed query had no matching rows and no retained settle/refund terminal marks, while historical invocation, other nodes, and non-retained history remain unproven. This matches the previous Codex ruling and does not weaken the fail-closed removal of the unsafe inference chain.

## Required status wording

Accepted:

- V1 `PayoutShard` committee-unavailability liveness failure: **CONFIRMED AT CODE LEVEL**.
- ST-00 classification of #5 as `FAIL(as-is)`: **ACCEPTED WITH CONTRACT-FAMILY SCOPE**.
- G-4 historical-claim downgrade: **ACCEPTED**.
- Protocol-capability vs current-path separation in ST-07: **IMPROVED / ACCEPTED DIRECTION**.

Not yet accepted as VERIFIED:

- 171,227 KAS total current exposure;
- 81,665 KAS / 48% zero-autonomous-exit exposure;
- 89,496 KAS / 52% side-layer exposure;
- 701 / 21+6 / 36,012 / 26 population counts;
- 99.5%, 40/40, 14/14, 2,863/100% and similar runtime numerics unless their evidence package is committed and replayable.

No code, deployment, refund, settlement, claim, signer, broadcaster, migration, backfill, restart, wallet or production-money-path authorization is granted by this review.
