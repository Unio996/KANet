# Codex review — unsynced review-ingestion and roadmap-authority evidence

## Git evidence basis

- Previously processed / written-back bridge commit: `3ea3174c6934f0158bdbf8a9ec6615479ce33a7d`.
- `3ea3174c...coord/codex-bridge`: `identical`, ahead 0, behind 0, no changed files.
- Canonical bridge blobs at the checked branch state:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- No file-internal timestamp was used for incremental detection.
- Active branch source HEAD at read time: `d6f0bde16fff0dbd7aa685d03ba346051bf44c91`.
- Active branch compare from prior reviewed cursor `e7306d88faaaf88f62e9c8f778de8778a40ab7ba` to `d6f0bde16fff0dbd7aa685d03ba346051bf44c91`: ahead 11, behind 0.
- Actual changed paths:
  - `docs/examples/kanet-external/README.md` (+107/-31)
  - `docs/examples/kanet-external/send-comm.mjs` (+6/-2)
  - `docs/iteration/COORD-LEDGER.md` (+222/-0)
  - `docs/iteration/HANDOFF-NOW.md` (+79/-4)
- Source blobs examined:
  - `send-comm.mjs`: `edd142cffa8ff16f5c63ba3607396f2900d43d9e`
  - `COORD-LEDGER.md`: `f8e5e89a37faaf265c9a06d3e34193638e452a84`
  - `HANDOFF-NOW.md`: `a5be3fd1393d9bd596d62d678595ea16055f60bd`

## Verdict

`BRIDGE_CANONICAL_FILES_UNCHANGED__ACTIVE_COORDINATION_STATE_CHANGED__REVIEW_INGESTION_LEDGER_REQUIRED__ROADMAP_AUTHORITY_SPLIT_CONFIRMED__NO_MONEY_PATH_AUTHORIZATION`

## 1. The active increment is coordination-relevant, not an unrelated documentation batch

The new ledger and handoff explicitly change the team's current operating model:

- external programs do not need inbound connectivity to the KANet host; they can use their own TN12 node and communicate over the shared chain;
- first-fee acquisition remains the practical onboarding gate;
- the current external action surface was not designed as an intentionally public capability surface;
- a receipt proving decryption must bind to plaintext-derived evidence, not merely echo a public txid;
- fabricated transaction claims and repeated paid auto-replies must be fixed before adding a positive receipt feature.

These points directly govern the external-access work previously reviewed through the Codex bridge. They are therefore valid unsynced collaboration feedback. They are not production authorization.

## 2. The team has identified a real review-ingestion control failure

`HANDOFF-NOW.md` states that multiple recent Codex responses exist under `coordination/codex-bridge/responses/`, while no repository object records, per response:

- who evaluated it;
- what technical conclusion was accepted or rejected;
- which commit, design change, test, or explicit non-applicability resulted.

This is not merely a reporting inconvenience. It breaks the feedback loop:

1. Codex can independently find a defect.
2. A source fix can later land.
3. No durable object proves whether the team read the review, independently validated it, or accidentally fixed the same symptom for another reason.
4. Future reviewers cannot distinguish unresolved findings from closed findings without re-performing the entire investigation.

A binary `read=true` register would be insufficient and gameable. The proposed direction is correct: one append-only row per response, with a required disposition artifact.

Minimum schema:

```text
response_path
response_blob_sha
reviewed_source_commit_or_range
reviewer
verdict = accepted | accepted_with_corrections | rejected | superseded | not_applicable
result_artifact = commit | design | test/evidence | ledger_entry
result_ref
residual_open_items
recorded_commit
```

Hard rule: `reviewed` must not be a standalone terminal state. A response is ingested only when `result_artifact` and `result_ref` exist, or when a reasoned rejection/non-applicability entry identifies the conflicting source evidence.

The register itself must use response blob SHA, not filename date or response prose timestamps, as identity and change detection.

## 3. The roadmap authority split is confirmed as a repository-state defect

The same pathname exists with incompatible authority claims on divergent branches:

`docs/2026-07-25-kanet-trunk-roadmap-modularization-and-external-access.md`

The active handoff records:

- bridge-side document: v1.2, `FROZEN-EXECUTING`, 1531 lines;
- working-branch document: a separately evolved current roadmap, roughly 300+ lines;
- the branches diverge and neither document is an update commit descended from the other document's authoritative history.

Independent repository comparison also shows `coord/codex-bridge` and `bshard-m3-deploy` are deeply diverged, with merge base `6cab93931369e2dd66530bf79960314481d8844d`. Therefore this cannot be treated as a simple stale checkout or a normal linear edit.

The defect is not that two drafts exist. The defect is that the same canonical path carries competing current-authority semantics while one text says multiple current drafts are prohibited.

Until Owner resolves the authority source:

- do not silently merge the two documents;
- do not overwrite either side based on recency, author identity, line count, or file self-description;
- do not allow a task to cite only the pathname without branch + commit + blob;
- any dispatch derived from this roadmap must identify the exact authoritative commit and blob;
- no money-path deployment may rely on an unresolved roadmap reference.

Required Owner decision should be narrow and explicit:

```text
AUTHORITATIVE_ROADMAP = <branch>@<commit>:<path>#<blob>
DISPOSITION_OF_OTHER = archive | extract-delta-for-review | supersede-with-reason
```

If useful material exists only in the non-authoritative copy, it should be extracted as a proposed delta against the selected authority, not merged by file concatenation.

## 4. External communication code changed only narrowly; previous send-readiness boundary remains

The current `send-comm.mjs` blob still says the `--to` path has only been exercised through node connection, not through full construction/submission/receipt verification. The code continues to:

- use `Address` for canonical parsing and network/type checks;
- manually extract payload bytes after canonical parse;
- create the ECDH recipient point as `0x02 || x-only-key`;
- require later TN12 broadcast and real receiving implementation evidence for send-readiness.

The +6/-2 source change does not supply the missing end-to-end evidence and must not be interpreted as closure of the prior interoperability finding. The active coordination increment correctly shifts the public model from “connect to our node” to “use your own node,” but that architectural correction does not prove this concrete sender implementation has completed a transaction and been decrypted by the production receiver.

Status remains:

`ARCHITECTURAL_CONNECTIVITY_MODEL_CORRECTED__CONCRETE_SEND_RECEIVE_E2E_STILL_OPEN`

## 5. Plaintext-derived receipt design is directionally sound, with required protocol bindings

Echoing a public txid proves observation, not decryption. A receipt containing a plaintext-derived value can prove the recipient accessed the encrypted content, provided the receipt commits to the correct context.

A bare plaintext hash prefix is not enough if replay across senders, networks, message types, or duplicate plaintexts is possible. The receipt commitment should bind at least:

```text
protocol_domain
network_id
sender_identity
recipient_identity
inbound_txid
message_sequence_or_nonce
hash(canonical_plaintext)
```

The receipt must also enforce one receipt per accepted inbound message through a persistent idempotency key. Since every reply costs funds, retry logic must distinguish:

- definitely not submitted;
- submission outcome unknown;
- submitted with txid.

This is a design acceptance only. It is not authorization to implement, sign, broadcast, or fund the receipt path.

## Required next evidence

1. A committed Codex-response disposition ledger using response blob SHAs.
2. Owner's exact roadmap authority selection with branch, commit, path, and blob.
3. A delta report from the rejected/superseded roadmap into the selected authority.
4. For external messaging: fixed source commit, TN12 txid, inclusion evidence, and production-receiver plaintext equality.
5. For receipt work: protocol-domain binding, idempotency design, submission-state model, tests, and a separate money-path authorization before deployment.

## Safety boundary

This review does not authorize production deployment, faucet funding, signing, broadcast, auto-reply activation, restart, schema migration, settlement, refund, or any movement of funds.

## Write commits

- Initial bridge response commit: `841baa49cf8d4c2b59d4a7c6a812a38ba73b248c`
- Final anchor update: this commit.
