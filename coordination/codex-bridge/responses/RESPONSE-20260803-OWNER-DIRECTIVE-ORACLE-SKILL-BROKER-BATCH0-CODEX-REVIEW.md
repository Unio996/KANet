# Codex review — OWNER-DIRECTIVE-20260803-ORACLE-SKILL-BROKER-BATCH0

## Verdict

`DOCS_ONLY_SIDECAR_DIRECTION_ACCEPTED__THREE_LAYER_DIGEST_CHAIN_ACCEPTED__PUBLIC_CLAIMS_REMAIN_EVIDENCE_GATED__NON_EQUIVOCATION_AND_EXECUTION_BINDINGS_MUST_BE_ADDED__DOCS_ONLY_BATCH_CANNOT_SELF_CREATE_MISSING_NEGATIVE_TEST_EVIDENCE__NO_MONEY_PATH_AUTHORIZATION`

## Source authority

- branch: `coord/codex-bridge`
- source path: `coordination/codex-bridge/OWNER-DIRECTIVE-20260803-ORACLE-SKILL-BROKER-BATCH0.md`
- source blob: `4f637c7f769b1614c07aa3592267b06f205273e1`
- review scope: docs-only task-card semantics and its evidence/authorization boundaries; no code, deployment, schema, configuration, database, signing, broadcast, refund, claim, grant, wallet, relay, mainnet, or production action is authorized by this response.

## Accepted directions

1. `BATCH-0-DOCS-SIDECAR` is correctly separated from the frozen trunk execution order and explicitly limited to approved Markdown paths.
2. Splitting `FactReceipt`, `ConditionReceipt`, and `SettlementAuthorization` into separate objects, with parent-digest binding, is materially stronger than a single mutable metadata object.
3. Moving policy interpretation out of `FactReceipt` and into `ConditionReceipt` is correct.
4. The Broker v0 identity boundary is honest: one Kaspa address is one v0 identity; address change is a new identity; database or operator mapping cannot manufacture protocol-level continuity.
5. The distinction between one successful real distribution and adversarially proven enforcement is correct and must remain visible in all public wording.
6. Track A and Track B separation, plus Owner final approval over exact publication blobs, are appropriate controls.

## MUST-FIX before TC-01 terminology approval

### MF-1 — Digest chaining alone does not prevent equivocation

`correction_ref` permits a new receipt to point to an old receipt, but the current field sketch does not define who has authority to correct/revoke, how competing successors are ordered, or how a verifier detects two valid-looking children of the same receipt.

The terminology/interface freeze must define at least:

```text
issuer_or_verifier_authority_ref
receipt_sequence_or_state_version
supersedes_digest
correction_reason_code
revocation_authority
non_equivocation_rule
conflict_resolution_rule
```

For committee paths, specify whether the successor requires the same committee epoch, a later authorized epoch, or a separate governance authority. Without this, two contradictory `ConditionReceipt` objects can both bind the same `FactReceipt` and remain syntactically valid.

### MF-2 — SettlementAuthorization needs exact execution-domain and value bindings

The current description binds a condition digest, input state, allowed transition/output structure, conservation, time, and replay boundary. It must additionally freeze:

```text
network_id / genesis_or_chain_id
asset_id and unit/decimals
execution_domain / covenant_family / version
exact input outpoints or state-root authority
recipient and amount commitments
fee policy and who may pay/change it
change-output rule
builder/entrypoint/selector binding
request_id / nonce / idempotency receipt semantics
```

Otherwise a valid condition can be replayed across a different network, asset unit, covenant family, selector, fee policy, or change-output construction.

### MF-3 — Time semantics require an explicit comparison authority

Allowing wall-clock, DAA, and block anchors is not enough. The interface must define which verifier supplies the canonical comparison point, whether anchors must be monotonic, the tolerated reorg/finality depth, and whether two different time bases may ever be compared.

Default rule should be: no implicit conversion between wall-clock, DAA, block height/hash, or external timestamps. Cross-basis conversion requires a separately identified authority and evidence reference.

### MF-4 — Evidence availability and pruning need a closure rule

A digest can preserve integrity of previously obtained evidence after pruning, but it does not prove that the evidence was ever available, complete, canonical, or independently retrievable.

Each `availability_class` must define:

- retrieval authority/location class without embedding secrets;
- retention expectation;
- minimum verifier set that actually obtained the evidence before expiry/pruning;
- what remains independently verifiable after loss;
- when status must degrade from `VERIFIED` to `PARTIAL` or `UNVERIFIABLE`.

### MF-5 — Docs-only batch cannot manufacture missing negative-test evidence

TC-03 correctly requires negative tests before claiming protocol-enforced resistance to deletion, fee reduction, or impersonation. This batch simultaneously prohibits test diffs.

Therefore the publication rule must be explicit:

> Existing immutable negative-test artifacts may be indexed. Missing negative tests cannot be created inside this batch and the corresponding claim must remain `PARTIAL` or `OPEN`; prose review, successful-path transactions, or helper-code inspection cannot upgrade it to `VERIFIED`.

The same rule applies to committee slash claims, Broker fee enforcement, and any claim that a malformed authorization is rejected.

### MF-6 — Permissionless enrollment is not identity uniqueness or anti-Sybil protection

Track B must distinguish:

- permissionless admission;
- control of an address;
- continuity/rotation;
- uniqueness;
- reputation/history;
- anti-Sybil or bond requirements.

A chain-derived address set can prove control/admission but cannot by itself prove one-human/one-entity uniqueness or prevent disposable Broker identities. Public text must not imply otherwise.

### MF-7 — The sidecar boundary needs mechanical Git enforcement, not receipt self-report

`non_doc_diff_count: 0` in a task receipt is self-reported. Each delivery receipt must be generated from an actual compare against its recorded `base_commit`, with:

```text
head_commit
merge_base
changed_paths
per-path status/additions/deletions
allowed-path evaluation
canonical file blob SHAs
```

Any changed path outside the approved Markdown allowlist is an automatic batch failure. This check must use Git tree/diff data, not document timestamps or a manually entered count.

### MF-8 — “Condition money already exists” must be path/version scoped before publication

TC-05 is correct to prevent promotion of a local success into a system-wide claim. The final wording should name the exact proven path/version and separately list known incomplete paths, including the unresolved `claim-complete` false-success class and the 41 shard-blind call sites until their evidence-backed closure.

A single ZK transaction or committee settlement proves occurrence for that path and artifact set; it does not prove generic Oracle Skill correctness, all-market availability, committee outcome correctness, or universal Broker enforcement.

## Required receipt additions

Add these fields to the common receipt:

```text
head_commit:
merge_base:
canonical_blob_shas:
actual_git_diff_summary:
allowed_path_gate: PASS / FAIL
claims_downgraded_for_missing_tests:
conflicting_or_superseded_receipts:
publication_blob_pending_owner_approval:
```

## Status judgment

- Owner directive: `GREEN-WITH-MUST-FIX` for docs-only execution.
- TC-01 may begin with the fixes above incorporated into the terminology draft.
- TC-02/TC-03 publication remains blocked on exact-blob Owner approval and evidence grading.
- No statement in this review authorizes implementation, deployment, asset movement, signing, broadcasting, refund, claim, grant, wallet, relay, mainnet, or production actions.
