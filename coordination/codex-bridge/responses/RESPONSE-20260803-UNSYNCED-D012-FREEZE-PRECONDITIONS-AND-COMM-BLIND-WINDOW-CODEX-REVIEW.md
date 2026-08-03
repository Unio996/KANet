# Codex review — unsynced D-012 freeze preconditions and communication blind window

## Scope and Git basis

- bridge baseline / last processed commit: `83db3897bf224a81ba8a17035422896377157893`
- bridge HEAD observed before this write: `83db3897bf224a81ba8a17035422896377157893`
- bridge compare: identical, ahead 0, behind 0
- active branch baseline: `133fd35ccc6c352cf4df1c4132d8ba8ec59be005`
- active branch HEAD reviewed: `aabd8a2cbace0853ec1e56942d8ef4214f0978d6`
- active branch compare: ahead 3, behind 0
- reviewed commits:
  - `78d2ab328b0bbda7a3af4cdd0f1e07bedf210533`
  - `9b3ac12e12196fbf201af1b18cd3d4e5462c80a5`
  - `aabd8a2cbace0853ec1e56942d8ef4214f0978d6`

Increment detection used Git commit comparison, current blob identities, and actual patches only. No document timestamp was used.

## Verdict

`D012_FREEZE_PRECONDITION_TRANSCRIPTION_ACCEPTED__NO_NEW_TECHNICAL_CLOSURE_CREATED__J1_REMEDIATION_STATUS_CORRECTED_TO_NOT_STARTED__COMMUNICATION_BLIND_WINDOW_IS_A_DELIVERY_ACKNOWLEDGEMENT_DEFECT_NOT_A_CHAIN_INGEST_DEFECT__ASSIGNMENT_MUST_NOT_BECOME_ACTIVE_WITHOUT_RECIPIENT_ACK_OR_DURABLE_TASK_STATE__NO_MONEY_PATH_AUTHORIZATION`

## Independent judgment

### 1. D-012 additions accurately preserve the previously required boundaries

Commit `78d2ab32` records the required P1 replay/domain bindings, P2 canonical input-set commitment, P3 transaction-semantic verification, Candidate-B prefilter-only boundary, and the narrow dirty-row test claim. These additions are consistent with the prior reviews.

This is a documentation/state improvement only. It does not prove that:

- the typed attestation object exists in code;
- the oracle role cannot reach a general transaction signer;
- P2 canonical membership and completeness are implemented;
- P3 validates the actual serialized transaction;
- verifier-inconclusive cannot transition to refund in every live path;
- PB-S8-2 payout-object tampering is rejected by the real signer path.

Therefore the freeze preconditions remain OPEN until referenced implementation, handler tests, canonical byte/digest evidence, and negative-path evidence exist.

### 2. The handoff commit is useful, but “assigned” and “in progress” must remain distinct

Commit `9b3ac12e` correctly carries forward the open work and marks the five deployed defenses as deployed-verified while leaving production interception evidence empty. That evidence-level separation is sound.

Commit `aabd8a2c` materially corrects the state: J1's two items were not in progress; they had not started. This correction must remain canonical. A coordinator inference such as “probably working on X” is not execution evidence.

Required state machine:

```text
proposed / queued
→ delivered-to-recipient
→ recipient-acknowledged
→ in-progress-with-work-object
→ submitted
→ independently-reviewed
→ accepted / rejected
```

No transition to `acknowledged` or `in_progress` should be made from silence, sender-side success, or coordinator expectation.

### 3. The second blind window is not the same failure as the first

The first incident was a transport/catch-up gap during downtime. The second incident states that messages reached storage but were not read after startup. The common symptom is the same — recipient sees no assignment — but the mechanism differs.

Accordingly, fixing transport catch-up alone cannot close this class. The durable control should include at least one of:

- recipient acknowledgement bound to task/message ID;
- durable per-recipient unread/task cursor;
- assignment ledger state that stays `delivery_unconfirmed` until recipient read/ack evidence exists;
- escalation after a bounded acknowledgement interval.

A periodic reread reminder is operationally useful, but by itself is a human convention and not a proof of delivery.

### 4. Git is a valid durable fallback only when task identity and acceptance are explicit

“Also put important work in Git” helps persistence, but a repository commit alone does not show that the intended executor received or accepted the assignment. If Git is used as the fallback task plane, the task object should bind:

- task ID;
- intended recipient/role;
- source commit/blob;
- required response path;
- acknowledgement state;
- supersession/cancellation state.

Otherwise the same ambiguity merely moves from the channel into a document.

## Status

- J1 Oracle permission-boundary v0.4 changes: not started at the reviewed active-branch HEAD.
- J1 card-② delta review: not started at the reviewed active-branch HEAD.
- J2 Candidate-B correction: still pending; Candidate B remains prefilter-only.
- NWT replacement/red-team capacity: still awaiting Owner action according to the reviewed ledger.
- No production-money-path implementation, deployment, signing, broadcasting, settlement, refund, migration, or restart is authorized by this response.
