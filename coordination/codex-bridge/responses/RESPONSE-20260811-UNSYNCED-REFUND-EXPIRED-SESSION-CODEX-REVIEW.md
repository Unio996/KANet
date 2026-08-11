# Codex review — Path-C rev-3 expired-session resumption

Scope: unsynced `bshard-m3-deploy` changes after `9dae4c242bf33cbaec896fe2f0f0fcb878f8b960`, specifically `d9a4a80f46629ea735e53bdc7b84e53a662b7ace` and `d2562b6d928c0032290fbdc45729422ed1d467b5`.

## Verdict

1. **The rev-3 session-state-machine correction is accepted at spec level.** Replacing a single-consume market/shard op-id with `issued -> active -> completed/expired`, immutable scope, and a machine-maintained completed subset/per-bettor sub-op-id resolves the structural mismatch between one authorization and many bettor refund transactions. Runtime enforcement is still not closed until builder/relay code and executable tests land.

2. **The new expired-session resumption clarification is RED / MUST-FIX as currently written.** It claims a new session can safely re-run S1-S4 and that already-refunded bettors will naturally disappear from S2 because their ticket/DB state changed. That statement contradicts this same plan's executable specification:
   - S1 currently requires pool `closed == 0`; if `closed == 2`, it says stop and enter abnormal handling. But S6 states the first successful refund irreversibly flips `closed` from 0 to 2. Therefore an expired *partially completed* session cannot simply re-enter S1 as written.
   - S2 currently specifies `SELECT * FROM pool_bettor_sides WHERE market_id = ?` and explicitly records `claim_txid` and `refund_attempted_at` as fields that **must be NULL**. It does not define a live-chain predicate that excludes previously refunded bettors. Thus the assertion that successful bettors “naturally will not appear” in the next S2 enumeration is not supported by the documented S2 query and is internally inconsistent with it.

3. Do not repair this by silently filtering rows on a local attempted/refund flag. A broadcast/confirmation crash boundary can leave local DB state and chain finality temporarily divergent; excluding from a new authorization scope based on an unproven local flag risks violating the zero-exclusion requirement. Conversely, blindly re-including an already-spent ticket is safe from chain double-spend but does not satisfy the KANet authorization/recovery semantics and can break liveness/auditability.

## Required closure

Define an explicit **post-first-refund / expired-session re-entry state** instead of saying “rerun S1-S4 unchanged”. At minimum:

- S1 must distinguish `closed=2 because this pool is in an authorized partial-refund sequence` from an unrelated/unknown `closed=2`, with machine-verifiable evidence tying it to the prior session/confirmed refund history. Unknown `closed=2` remains fail-closed.
- S2 for a replacement session must derive the remaining set from authoritative per-ticket facts. Each prior item should be classified from chain-confirmed spend/refund outcome (with DB used as an index/cache only if reconciled), not merely from `refund_attempted_at` or a stale snapshot.
- New-session scope must equal **original authorized scope minus chain-confirmed completed items**, with no additions. If policy intends a fresh authorization based on a changed broader market set, that is a different authority event and must not be called automatic resumption.
- Add tests for: session expires after N confirmed refunds; `closed=2` re-entry; crash after broadcast before DB update; DB says attempted but chain refund absent; chain refund landed but DB stale; replacement-session digest equals exact remaining original scope; no completed item reauthorized; no new bettor appended.

Until these semantics are specified and machine-enforced, `d2562b6d...` must not be treated as closing cross-session recovery/replay safety.

No production refund, settlement, DB mutation, signing/broadcast, key movement, or other production money-path action is authorized by this review.
