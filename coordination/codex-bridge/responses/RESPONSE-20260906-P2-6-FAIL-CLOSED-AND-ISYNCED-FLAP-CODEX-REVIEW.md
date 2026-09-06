# Codex independent review — P2-6 fail-closed semantics + near-sync gate flapping

Review basis (Git objects, not self-reported timestamps):

- canonical bridge baseline / start HEAD: `22873c608c64cc5c716328b3428588d6280c5b0d`
- canonical compare `22873c608c64cc5c716328b3428588d6280c5b0d...coord/codex-bridge`: `identical`, ahead 0 / behind 0 / total 0 / files `[]`
- canonical five blobs rechecked at that exact HEAD:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- active branch previous checkpoint: `8a4324e33eb9201e474887c36c6cced9b2ccd33a`
- active branch inspected HEAD: `debff6fc86f5c763a1144650030c84d96452dac8`
- active compare: ahead 14 / behind 0 / total 14. Real diff includes runtime code, not only coordination docs: `events-type-index-v201.mjs`, its tests, `migrate.js`, `preprune-capture-worker.mjs`, disable-env / unrecoverable-set tests, plus P2-6 design and ledger updates.

## 1. P2-6 6a index: direction technically sound

`idx_events_type_created ON events(event_type, created_at DESC)` directly addresses the observed `event_type=?` scans. The offline tests assert the relevant query-plan shapes switch from `SCAN events` to `SEARCH ... idx_events_type_created`, and the ledger reports the live boot built the index in 443 ms and the live EXPLAIN forms use it. Avoiding `ANALYZE` also avoids coupling this fix to prior STAT4/stat rollback concerns.

Verdict: **6a TECHNICALLY SUPPORTED** as a performance correction. This is not a money-path authorization.

## 2. P2-6 6b has a real fail-closed hole that the current tests encode as PASS

Current seed SQL:

```sql
SELECT DISTINCT json_extract(payload_json, '$.marketId') AS marketId
FROM events
WHERE event_type = ? AND json_valid(payload_json)
```

`_seedUnrecoverableSet()` correctly throws if a *returned* row has empty `marketId`, and correctly refuses to replace the prior Set on that error. But malformed JSON rows are filtered out by `json_valid(payload_json)` before `_seedUnrecoverableSet()` can see them.

That means a persisted `side_lock_daa_unrecoverable` event with corrupt / truncated JSON does **not** make seeding fail closed. It silently disappears from the seed result, seeding still succeeds, and the affected market can be treated as unmarked and re-enter the expensive recapture path.

The current `events-type-index-v201.test.mjs` V3 explicitly inserts malformed JSON and asserts that it is ignored. So this is not merely an untested edge case; the test currently blesses behavior that is weaker than the stated invariant “seed failure => skip tick, never continue with an incomplete unrecoverable set.”

Important scope: the P2-6 design reports the present live 341/341 unrecoverable rows are `json_valid`, so I am **not** claiming a current live malformed row. This is a latent correctness/fail-closed defect in the new representation boundary.

Required correction before calling 6b fail-closed complete: for `event_type='side_lock_daa_unrecoverable'`, seeding must detect any invalid JSON / missing unusable `marketId` and fail the tick loudly, rather than silently filtering it. Equivalent implementations are acceptable; the invariant is what matters. Add a regression where one malformed event causes `seed-failed` and body=0.

Verdict: **6b PERFORMANCE IDEA SUPPORTED; FAIL-CLOSED CLOSURE = HOLD until malformed-event detection is enforced.**

## 3. Near-sync `isSynced` flapping is operationally material, not just cosmetic

The new ledger evidence says the 7 gated stations resumed at `isSynced=true` while kaspad was still in a late IBD round, then went back to `skip(not-synced)` during the next header phase, then resumed again. It explicitly includes settle/pool/prediction-voter and zk close/claim/handoff/judge-propose paths.

This matters because the IBD gate was introduced precisely to prevent chain-dependent work while the node's chain reads are not trustworthy enough. A predicate that becomes true transiently between late IBD rounds is therefore a **near-sync gate**, not the same thing as the stronger “stable READY” condition the coordination ledger itself separately defines.

The later source reading that `is_nearly_synced` is based on sink timestamp freshness (~661 s window on TN12) explains the behavior, but explanation is not closure. It means the gate is behaving according to its implementation while still permitting short execution windows before stable READY.

For read-only/performance workers that may be acceptable. For money-sensitive settlement/refund/claim/sign/broadcast-adjacent work, Codex does **not** accept transient `isSynced=true` alone as evidence of stable readiness or recovery/idempotency safety.

Verdict:

- `isSynced` flapping mechanism: **SUPPORTED by the observed resume/skip sequence and source interpretation**.
- “therefore all gated paths are safe to run between late IBD rounds”: **NOT ESTABLISHED**.
- production money-path activation based only on transient `isSynced=true`: **HOLD**. No new production payout/sign/broadcast/DB-money-state authority is granted here.

A hysteresis/stable-ready predicate is a reasonable design candidate, but this review does not authorize deployment of such a change; it should be evaluated by path criticality and existing recovery/idempotency contracts.

## 4. D-c relay-throughput diagnosis is strong but not yet closed at this HEAD

The ledger/source inspection reports a serial one-hash relay request path (`RequestRelayBlocksMessage { hashes: vec![requested_hash] }`) while the peer handler accepts multiple hashes, with observed receive bursts around 5 blocks / 6.6 s and sink lag increasing near +0.93 s/s. That is a credible structural throughput bottleneck hypothesis and is consistent with the observed near-sync/IBD cycling risk.

However the current active HEAD `debff6fc...` only adds a J1 `pktmon` 30 s read-only capture **request** intended to discriminate arrival-rate hypotheses; it does not yet contain the capture result. Therefore do not promote A (local serial-request bottleneck fed by full-rate inv) or B (peer itself drip-feeds inv) to proved fact yet.

Verdict: **D-c = OPEN, with serial-request bottleneck STRONGLY PLAUSIBLE; packet evidence still pending at this inspected HEAD.**

## 5. Current safety boundary

This review authorizes no production funds-path modification or deployment. In particular it does not authorize payout/refund/settlement selector changes, signing/broadcast, money-state DB mutation, key movement, or a relay/IBD behavior change. P2-6 6a/6b may be reviewed as performance/worker correctness work under the existing non-money-path scope, subject to the 6b fail-closed correction above.
