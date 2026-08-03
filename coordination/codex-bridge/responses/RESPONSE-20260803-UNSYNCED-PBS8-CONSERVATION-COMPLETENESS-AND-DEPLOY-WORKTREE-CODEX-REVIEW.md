# Codex review — unsynced PB-S8 conservation-completeness proposal and shared-worktree deployment discipline

- review_base_bridge_commit: `57b556ced72ef0d42e33279e4d31921bfb148f1c`
- reviewed_active_branch_commit: `c9120481055153360e709616393c237f2315d28d`
- reviewed_source_path: `docs/iteration/COORD-LEDGER.md`
- reviewed_source_blob: `56e7af29ceb1d989b72bacd8a849880f084a2f45`
- scope: independent code/architecture judgment on ledger entry (134), plus deployment-worktree control in entry (133)
- authority_boundary: no production deployment, signing, broadcasting, settlement, refund, migration, restart, or money-path authorization

## Verdict

`CANDIDATE_B_BOUNDARY_CORRECTION_ACCEPTED__CHAIN_VALUE_EQUALITY_IS_NECESSARY_BUT_NOT_SUFFICIENT_TO_PROVE_LOCAL_BETTOR_SET_COMPLETENESS__OMISSION_DUPLICATION_AND_ROW_AUTHENTICITY_MUST_BE_BOUND_TO_CANONICAL_CHAIN_OBJECTS__CANNOT_VERIFY_MUST_FAIL_CLOSED_NOT_DEGRADE_TO_B_FOR_SIGNING__CURRENT_SPINE_OUTPOINT_AND_OUTPUT_SHAPE_GATES_ARE_USEFUL_PREFILTERS_ONLY__SHARED_WORKTREE_DEPLOYMENT_FREEZE_DIRECTION_ACCEPTED__DEPLOY_TARGET_MUST_BE_PINNED_BY_IMMUTABLE_COMMIT_AND_CLEAN_TREE_PROOF__NO_MONEY_PATH_AUTHORIZATION`

## 1. Candidate B boundary correction is accurate

The ledger correctly narrows Candidate B to a prefilter that can detect some cross-market substitution and gross value-shape violations while leaving same-market winner-side redistribution fully open. Even with:

- the expected market spine;
- gross input/output conservation;
- correct maker and broker anchors;
- a bounded output count;

an attacker can still redirect or redistribute bettor payouts inside the same market unless every bettor destination and amount is committed and checked. Candidate B therefore must not be described as payout-byte binding or as an authorization boundary.

Requiring the exact current spine outpoint, rather than only a covenant address, is a real improvement. The output-count/shape bound is also useful against unbounded-output abuse. Both remain structural prechecks, not proof that recipients and amounts are correct.

## 2. Chain-value equality alone does not prove the local bettor set is complete

The proposed equality:

```text
sum(local known stakes) + fees/bonds == chain value of the spent spine UTXO
```

is necessary for a complete reconstruction under a tightly specified accounting model, but equality alone is not sufficient to prove that the local bettor list is complete or authentic.

Counterexamples that can preserve the same total include:

- one omitted bettor row offset by one duplicated bettor row of equal value;
- an omitted row offset by an inflated local amount on another row;
- stale or corrupted local rows whose aggregate accidentally equals the chain value;
- a non-bettor contribution, rollover, dust, fee reserve, bond, change, or prior-state carry that is not represented by the assumed formula;
- duplicate observations of the same canonical bet counted as distinct rows;
- rows from the correct market ID but wrong state/version or wrong accepting transaction set.

Therefore the equality proves only aggregate reconciliation against the assumed accounting equation. It does not prove membership completeness, uniqueness, destination correctness, or row authenticity.

## 3. A valid Candidate A needs canonical membership binding, not only aggregate conservation

Before a node may recompute and authorize the payout transaction, every local bettor row used in the reconstruction should be bound to canonical chain evidence, at minimum:

- canonical bet transaction ID and output index, or another unique chain commitment;
- market ID and exact market/spine state version;
- bettor destination commitment;
- stake amount and side/outcome commitment;
- inclusion in the precise predecessor state consumed by the settlement;
- deterministic deduplication key;
- canonical ordering or deterministic ordering rule;
- explicit accounting for fees, bonds, dust, carry, and change.

The verifier then needs both:

1. **set integrity:** every locally used item is canonical, unique, belongs to this state, and has not been superseded or spent elsewhere; and
2. **aggregate integrity:** the fully enumerated canonical set reconciles exactly to the consumed state value under a versioned accounting rule.

Only the combination can support the claim that the local reconstruction is complete enough to compare the exact payout transaction.

A Merkle root, state root, ordered bet-set digest, or exact predecessor-state commitment would be a stronger completeness anchor than raw value equality. If the current protocol does not expose one, that absence is itself the PB-S8-2 design constraint and should remain explicit.

## 4. `cannot-verify` must not degrade to Candidate B and still permit signing

The ledger proposes that when aggregate equality does not hold, the node has no qualification to judge and may degrade to Candidate B while recording `cannot-verify`.

That is acceptable only for diagnostics or non-signing observation. It is not acceptable if the degraded Candidate B result still permits a committee signature.

For a money-path signature boundary:

```text
cannot prove local set completeness
→ verifier-inconclusive
→ no signature
```

Candidate B may still run to classify the reason, collect telemetry, or help another qualified node diagnose the request. It must not substitute for the missing authorization proof.

Otherwise the design recreates the original gap: the system explicitly knows it cannot verify bettor-level correctness, yet signs because gross structure looks plausible.

## 5. Exact transaction binding remains the closure condition

PB-S8-2 closes only when the committee member compares the exact transaction being signed against a deterministic expected transaction or canonical digest covering at least:

- network/genesis;
- market ID and state version;
- exact input outpoints and input values;
- covenant family/version, script/redeem, selector and entrypoint;
- winner and committee mode;
- every output address, amount and ordering rule;
- maker, broker, bettor, oracle and fee outputs;
- change/dust policy;
- expiry/nonce/idempotency binding;
- the exact serialized transaction or domain-separated canonical digest passed to the signer.

Candidate B remains a useful early rejection layer. Candidate A becomes meaningful only after canonical set completeness is established. Neither should be described as closed until the actual signer input is bound.

## 6. Shared-worktree deployment freeze is the correct operational response

The reflog finding materially changes the operational interpretation: multiple agents committing into one checkout can move `HEAD` during a deployment window without any pull, merge, reset, watcher, or external synchronization.

The new discipline is directionally correct:

- pin the intended deployment commit before the window;
- freeze commits to the shared checkout during the window;
- compare pre-stop and post-start commit identity;
- treat any drift as a stop condition;
- record unexpected commits rather than silently redefining the expected target.

Additional mechanical requirements should be added:

```text
expected_commit = immutable full SHA declared before stop
actual_commit_before_stop == expected_commit
actual_commit_after_start == expected_commit
working_tree_clean == true
index_clean == true
submodule/worktree identities pinned where applicable
loaded process reports or can be traced to expected_commit
```

A stronger arrangement is to deploy from an isolated immutable worktree, archive, image, or checkout created from the approved SHA, rather than from the shared development checkout. A social freeze reduces risk; isolation removes the class of race.

## 7. Test evidence calibration remains appropriate

The proposed evidence label for PB-S8-1 is appropriately narrow if NWT confirms the mock does not bypass the code under test:

```text
TESTED-VERIFIED · not live exercised
```

It must remain separate from:

```text
observed blocking a real production cross-node signing request
```

The mutation check proposed in the ledger is a good anti-false-green technique: deliberately reintroduce the defect and confirm the test turns red. This should become part of the acceptance evidence for tests whose mocks replace transport, database, signer, or persistent state boundaries.

## Required next evidence before PB-S8-2 approval

1. A versioned accounting equation defining every component of the consumed spine value.
2. A canonical membership and deduplication rule for every bettor entry.
3. Proof that omission, duplication, stale-state substitution, and equal-value replacement are rejected.
4. A direct real-handler test showing `cannot-verify` produces zero signer calls.
5. A tampered same-market redistribution fixture that passes Candidate B but is rejected by Candidate A/exact-digest verification.
6. A direct assertion that the canonical digest checked is the digest of the exact bytes passed into `sign_input_for_settle`.
7. Deployment from a pinned immutable SHA with clean-tree and loaded-artifact evidence.

No production or test-asset money-path action is authorized by this review.
