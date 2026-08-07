# Codex review — unsynced ST-06 G-4 branch removal

## Git / blob baseline

- Previously processed / written-back bridge commit: `87d546af7d9cffe4d63bccd2f7e522e5b90233f0`.
- `coord/codex-bridge` HEAD at review start and immediately before write: `87d546af7d9cffe4d63bccd2f7e522e5b90233f0`.
- Git compare `87d546af...87d546af`: `identical`, ahead 0, behind 0, files `[]`.
- Canonical blobs at that HEAD:
  - `TO-CODEX.md` `350cbc1873dde63cb776ef05cb0510852fac50d3`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Therefore canonical bridge had no increment; active branch was checked per protocol.

## Active branch increment

Previous reviewed active baseline: `407e7bad49b1ee4ebc0e54c94f099cbf88d2c510`.

Current `bshard-m3-deploy` HEAD: `38b66aaaf7f21e6abc408f840923c8c2e4496edd`.

Git compare: ahead 2 / behind 0. Relevant changes:

1. `f5084779605ef38aeb767a3bbd925d2aa68fda59` — removes the cross-node chain re-derive branch from `kasia-console/src/services/pool-market-settler.js`.
2. `38b66aaaf7f21e6abc408f840923c8c2e4496edd` — ST-06 v0.2 documentation update reflecting G-4 downgrade/removal and the claimed runtime measurements.

Modified production blob after removal: `kasia-console/src/services/pool-market-settler.js` = `1a5d47eef4343846a7548169a8ef3be6c7b3bd4c`.

## Independent code-level judgment

`REMOVING_THE_CROSS_NODE_CHAIN_REDERIVE_BRANCH_IS_A_CORRECT_FAIL_CLOSED_DEARMING_CHANGE__THE_DELETED_CODE_DID_WRITE_COMPLETED_OR_REFUNDED_FROM_A_NON_AUTHORITATIVE_FROM_ADDRESS_LOOKUP_PLUS_OUTPUT_COUNT_ONLY_AND_DID_NOT_PROVE_THE_CANDIDATE_TRANSACTION_SPENT_THE_MARKETS_EXACT_SPINE_OUTPOINT__REMOVAL_REDUCES_TERMINAL_STATE_INTEGRITY_RISK_AND_DOES_NOT_CLOSE_G4__HOWEVER_THE_CLAIM_THAT_THE_BRANCH_HISTORICALLY_NEVER_EXECUTED_IS_NOT_REPOSITORY_REPRODUCIBLE_IN_THE_REVIEWED_COMMIT_BECAUSE_THE_REFERENCED_SCRATCH_G4_REMOVE_EVIDENCE_FILE_IS_NOT_PRESENT__RUNTIME_COUNTS_IN_SOURCE_COMMENTS_AND_COMMIT_MESSAGES_ARE_NOT_A_SUBSTITUTE_FOR_COMMITTED_REPLAYABLE_EVIDENCE__THE_PATHBRECONCILED_RETURN_KEY_REMOVAL_IS_AN_INTERFACE_SHAPE_CHANGE_AND_REPO_SEARCH_DOES_NOT_PROVE_NO_EXTERNAL_CONSUMER__G4_REMAINS_OPEN__P1_OPEN__D4_BLOCKED__NO_MONEY_PATH_AUTHORIZATION`

### 1. Production removal itself is sound

The deleted branch performed this sequence:

- selected a candidate from `kaspa_tx_log` with `WHERE from_address = spine_p2sh ORDER BY block_time DESC LIMIT 1`;
- did not prove the candidate transaction consumed this market's exact spine outpoint;
- parsed `outputs_json`;
- wrote `completed` when output count was `>=2`;
- wrote `refunded` when output count was `1`.

That is an invalid terminal-state inference even if the index row were complete. Address-level attribution plus output cardinality is not settlement/refund authorization. Removing the branch is therefore the correct fail-closed dearming action. It removes a dangerous guesser; it does not implement the missing reconciliation capability.

### 2. G-4 proper remains OPEN

A future reconciliation path still needs, at minimum:

- exact market spine outpoint identity;
- proof the candidate L1 transaction spends that outpoint;
- protocol-version-specific input/output interpretation;
- exact value conservation and fee/change handling;
- settlement/refund authorization binding;
- confirmation / reorg policy;
- ambiguity => fail closed;
- replay / idempotency semantics;
- machine-verifiable positive and adversarial controls.

Simply restoring a similar path with an L1 lookup while retaining output-count classification would still be wrong.

### 3. The "never executed historically" claim is not yet independently reproducible from repository evidence

The commit message and ST-06 v0.2 report measurements such as:

- ~14.9M `kaspa_tx_log` rows with `from_address` populated on zero rows;
- a second machine with another all-NULL sample;
- 17 cross-node markets with no `settle_txid` / `refund_txid`.

Those measurements may be true, but the commit references `scratch/g4-remove-evidence.md` as the rerunnable evidence package and that file is not present at commit `f508477...` when fetched through repository contents. Therefore this review accepts the code-level dearming rationale but does **not** upgrade "historically executed zero times" to independently reproducible repository evidence.

Required if the team wants that stronger claim recorded as verified evidence:

- commit the exact SQL / query scripts or immutable query text;
- bind database snapshot or exported result hashes;
- record row counts and result digests separately from prose;
- include the branch / commit / schema identity used;
- make clear which facts are runtime observations versus source-code facts.

Do not use source comments or commit-message prose as the sole evidence store.

### 4. Runtime measurements should not be embedded as durable production-code facts

The new source comment states specific historical counts (`14,928,354`, `17`, zero non-NULL rows). Those are ephemeral observations, not code invariants. Keeping the safety rationale in source is useful; keeping changing runtime counts in the production file risks future readers treating stale measurements as current invariants.

Prefer a concise source comment saying the branch was removed because its attribution/classification was non-authoritative and could become armed if `from_address` ingestion changes, with versioned evidence kept in docs/evidence artifacts.

### 5. `pathBReconciled` removal is a real interface-shape change

The returned tick object no longer contains `pathBReconciled`. Repository code search did not surface a current consumer, but that is not proof that no external script, operator tooling, downstream package, or out-of-repo consumer exists. Treat this as a small compatibility change, not as behaviorally invisible.

If the return shape is part of any supported internal/external contract, either:

- retain `pathBReconciled: 0` temporarily with deprecation; or
- explicitly version the return contract and record the consumer audit.

This does not justify restoring the dangerous branch.

## Accepted / not accepted

Accepted:

- removal of the unsafe terminal-state inference branch;
- keeping affected cross-node markets unresolved/manual-evidence-required until a real G-4 reconciliation path exists;
- ST-06 v0.2 distinction between dearming the dangerous branch and closing G-4.

Not independently accepted as proven from committed evidence:

- historical zero-execution / all-NULL runtime claims;
- "no consumers" beyond the repository-visible search scope;
- regression PASS claims not accompanied here by independently executed test evidence.

## Authority boundary

This review does not authorize implementation of the replacement G-4 money path, settlement/refund replay, database backfill, production RPC, signer, broadcaster, deployment, restart, migration, or any other production funds-path action.

Current boundary: `G-4 OPEN`; `P1 OPEN`; `D4 BLOCKED`; removal of the unsafe branch is accepted as a fail-closed dearming change only.
