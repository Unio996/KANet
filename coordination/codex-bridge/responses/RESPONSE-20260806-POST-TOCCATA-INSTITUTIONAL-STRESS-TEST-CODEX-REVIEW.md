# Codex Review · POST-TOCCATA-INSTITUTIONAL-STRESS-TEST / BATCH-0

[TASK RECEIPT]
task_id: POST-TOCCATA-STRESS-TEST / ST-00..ST-07
agent: Codex
status: ACK
branch: coord/codex-bridge
base_commit: 532d9754cb51e8e0935014e2d62bab03027ee46c
source_commit_or_blob: d534af1591873b2fccc25320ed15b839780546e1 / 0e264fb859c99118a9fc1f38f8bd4c67cf530c6e
changed_paths: coordination/codex-bridge/OWNER-DIRECTIVE-20260806-POST-TOCCATA-INSTITUTIONAL-STRESS-TEST.md
non_doc_diff_count: 0
claims_verified: directive is docs/evidence-only; legacy-cleanup/ossification distinction; snapshot necessity-vs-sufficiency distinction; circuit/UTXO/covenant accounting separation; oracle institutional questions; indexer-not-authority rule
claims_downgraded: no protocol feature, snapshot property, permissionless-exit property, covenant semantic stability, or usable-infrastructure claim is accepted without exact source commit/blob and executable evidence
open_claims: exact post-Toccata protocol/source baseline; authenticated-snapshot implementation and availability; cross-SDK descriptor/covenant-ID behavior; operator-replacement and asset-exit path; historical rule/proving-key/data availability; L1-native money-flow reconstruction; oracle dispute/correction behavior
evidence_full_ids: bridge commit d534af1591873b2fccc25320ed15b839780546e1; directive blob 0e264fb859c99118a9fc1f38f8bd4c67cf530c6e
known_bypasses: treating repository activity as deployed capability; treating authenticated state reconstruction as asset exit; treating identical source text across two commits as semantic/version compatibility; treating indexer agreement as canonical L1 proof; treating a test design as a verified path
next_action: build ST-00 claim inventory first, with exact repository/ref/blob/runtime anchors; then derive ST-07 skeleton only from claims that have a named current implementation path
NWT_review_required: yes
Owner_action_required: no, unless BATCH-1 or money-path action is proposed

## Independent ruling

`DIRECTIVE_SCOPE_ACCEPTED__THE_NECESSARY_VS_SUFFICIENT_BOUNDARIES_ARE_SUBSTANTIVELY_CORRECT__BUT_POST_TOCCATA_AND_AUTHENTICATED_SNAPSHOT_MUST_NOT_BE_USED_AS_UNVERSIONED_PLATFORM_LABELS__ST00_MUST_FIRST_FREEZE_EXACT_REPOSITORIES_COMMITS_RUNTIME_BUILDS_AND_ARTIFACT_IDENTITIES__FAILURE_CORPUS_CASES_WITHOUT_A_NAMED_CURRENT_IMPLEMENTATION_PATH_MUST_BE_MARKED TARGET_OR_NOT_RUN_NOT CURRENT_FAILURES__NO_BATCH1_BATCH2_OR_MONEY_PATH_AUTHORIZATION`

### 1. The directive is correctly bounded

The new commit adds one documentation file only. It does not alter the five canonical bridge files, runtime code, tests, deployment configuration, database schema, covenant, signer, broadcaster, or money path. The stated BATCH-0 restriction is therefore internally consistent with the actual Git diff.

The five principal distinctions are accepted as review baselines:

1. code-path cleanup is not semantic ossification;
2. authenticated snapshot is not permissionless exit;
3. circuit qualification is not, by itself, transparent value conservation;
4. an oracle API is not a complete truth/dispute institution;
5. an indexer is not the canonical money-path authority.

### 2. ST-00 must begin with an exact technical baseline, not claims prose

Before classifying any outward claim, the inventory must identify the exact object being discussed:

- rusty-kaspa repository and commit;
- any Toccata/vProg repository and commit;
- SDK and wallet versions;
- compiler/circuit/descriptor versions and artifact hashes;
- node binary self-reported version and build identity;
- KANet branch/commit and deployed runtime identity;
- network and activation point.

“Post-Toccata”, “authenticated snapshot”, “covenant”, “vProg” and “permissionless exit” are too broad to function as evidence identities. A claim without exact source/runtime/artifact anchors must remain `NOT PROVEN`, even when its design logic is sound.

### 3. ST-07 must distinguish current-path failures from target-architecture failures

The twelve failure cases are useful, but not all are necessarily executable against the current KANet stack. Each case must carry one of:

- `CURRENT_PATH`: named code/runtime path exists now;
- `PROTOCOL_CAPABILITY_ONLY`: upstream machinery exists but KANet has not integrated it;
- `TARGET_ARCHITECTURE`: proposed future path only;
- `NOT_APPLICABLE_TO_CURRENT_BUILD`.

A failure case must not be reported as a failed current property merely because a future component is absent. Conversely, absence of a current path must not be reported as a passing test. It is `NOT-RUN` or `NOT PROVEN`.

### 4. Source-code agreement across commits is not cross-version semantic proof

The active branch separately records that two rusty-kaspa trees at different commits contain matching covenant-version checks. That is useful narrow evidence for those exact source snapshots. It does not establish:

- binary/runtime identity;
- full semantic equivalence across the commits;
- wallet/SDK serialization compatibility;
- historical or future hard-fork interpretation stability.

ST-01 therefore still needs byte-exact vectors and artifact identities. Matching lines in two source trees are supporting evidence, not semantic ossification.

### 5. Snapshot/operator tests must include asset control and data availability

ST-02 and ST-03 must not stop at successful SMT-root reconstruction. Every operator-replacement result must separately record:

- state acquisition without incumbent consent;
- L1-anchor verification;
- deterministic resume;
- availability of program, proving key, descriptor and historical rules;
- availability of the latest necessary data;
- an executable asset exit or migration path without incumbent signature.

Failure of the last two conditions means state portability may exist while economic sovereignty does not.

### 6. No implementation authorization follows from this ACK

This ACK accepts the BATCH-0 documentation/evidence task and the directive's reasoning boundaries. It does not authorize:

- harness or fixture implementation;
- SDK/wallet installation or upgrade;
- compiler, circuit, descriptor, covenant, indexer or runtime modification;
- proving-key generation or replacement;
- TN12 fault injection;
- refund, exit, claim, signing, broadcasting, restart, migration or deployment;
- any production or real-asset money-path action.

P1 remains open and D4 remains blocked under the existing bridge state.
