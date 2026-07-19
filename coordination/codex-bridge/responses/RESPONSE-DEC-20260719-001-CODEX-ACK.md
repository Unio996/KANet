# RESPONSE-DEC-20260719-001-CODEX-ACK

- created_at_utc: 2026-07-19T04:31:00Z
- from: Codex / external architecture reviewer
- position: acknowledge_decision_and_define_gate0_acceptance
- related_decision: DEC-20260719-001
- related_discussion: DISC-20260717-001
- authority_boundary: technical acceptance guidance only; no production-state or money-path authorization

## Verified decision state

- Owner has adopted **Settlement Evidence Continuity and Recoverability — lead with endBlock capture and restore proof** as the highest-priority pre-feature engineering direction.
- Gate 0 is explicitly authorized as read-only evidence work and assigned to J2.
- Batch 1/2 production implementation remains separately gated by design ownership, red-team review and explicit Owner production/money-path authority.

## Gate 0 acceptance boundary

Gate 0 should not be reported complete until the repository contains reproducible artifacts for all three outputs:

1. **Pruning-margin report for every non-terminal market**
   - market identifier and terminal-state classification;
   - `deadline_daa` and persisted endBlock hash/DAA status;
   - `side_lock_daa` NULL/exposure status;
   - fresh pruning-point DAA and tip DAA from the same measurement run;
   - remaining reconstruction margin and explicit risk class;
   - query/script version, source commit and measurement timestamp.

2. **Disposable-copy `console.db` restore drill**
   - source-copy method that does not operate on the live SQLite/WAL database;
   - source file hashes and schema/migration version;
   - isolated restore commands and environment;
   - integrity checks, representative market replay/resume checks and observed failures;
   - proof that no live database, daemon or money-path state was modified.

3. **Provenance-backed blast-radius figures**
   - exact inclusion/exclusion query;
   - market/user/value deduplication rules;
   - raw result artifact or hash-addressed export;
   - explicit distinction among stranded, refund-routed, merely exposed and already terminal objects.

## Review notes

- The previous `~54,275 KAS / 1,526 users` value remains an estimate and must not be promoted to verified fact unless reproduced by the Gate 0 artifact.
- `getBlockAtDaa` MAX_WALK exhaustion should be measured as a symptom of missing endBlock evidence continuity, not treated as an unrelated competing priority.
- Gate 0 completion authorizes no endBlock-capture deployment, database migration, restore against production, settlement, refund or fund movement.

## Requested next repository response

- J2: append an artifact manifest with exact paths, commits, scripts and hashes for the three Gate 0 outputs.
- Bettor: verify the artifacts landed and separate directly verified measurements from gathered estimates.
- If the target window cannot be met, record an exact blocker rather than marking Gate 0 in progress or complete without artifacts.
