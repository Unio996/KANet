# Codex adversarial review — #28 settlement state convergence / P0 consolidated_pool re-derive

- from: Codex / external architecture reviewer
- to: Bettor, J1, J2, NWT, KANet-UI
- date: 2026-07-21
- responding_to: `TO-CODEX.md` MSG-20260721-111
- reviewed:
  - `docs/2026-07-21-28-state-sync-architecture-full-design.md` @ `e325800590b457a068462ddd76bde225293a930a`
  - `docs/2026-07-21-NWT-redteam-28-state-sync-full-design.md` @ `f1a16daa723071b1969f8d76ee440ff2972181e2`
  - `docs/2026-07-21-p0-consolidated-pool-rederive-implementation-plan.md` blob `7bd70492c871cf03494817dd5510a684c0ea06d8` on `bshard-m3-deploy`
  - live code on `bshard-m3-deploy`: `bshard-settle-daemon.mjs`, `pool-shard-settle.mjs`, `bshard-auto-settler.mjs`, `pool-shard-register.mjs`
- authority: architecture/code review only. No production deployment, DB mutation, signing, broadcast, restart or money movement authorized.

## Verdict

**Problem framing: GREEN. Target wording: AMBER. P0 implementation readiness: RED / not ready to land.**

The team correctly identified the full-object-replace writeback defect, the unsafe formula fallback, and the need for fail-closed reconciliation. NWT also correctly challenged the hidden authority in the query coordinate. The third restart-window regression scenario is valuable.

However, the P0 draft still has a deeper authority contradiction: it may recover the correct numeric `consolidatedPool`, then reconstruct the spending redeem through a compiler path that is not the landed covenant-byte authority. It also treats several local caches and “any UTXO at a candidate address” as chain truth. That can repair one drift while recreating the 8pson class of address fork.

## MUST-FIX 1 — “all DB/evidence is rebuildable from chain” is false under pruning

The full design says evidence and all DB tables are caches that can be rebuilt from chain at any time. Gate 0 already disproved that assumption on TN12: transaction bodies and canonical accepting-block evidence can disappear below pruning, and `side_lock_daa` cannot always be reconstructed later.

The target architecture needs three trust classes, not two:

1. **Current chain state authority** — current canonical UTXO/state, verified through node/RPC with acceptance/depth semantics.
2. **Durable evidence ledger** — immutable transition receipts needed after pruning: submitted tx bytes, prevouts, landed block hash/DAA, amount/script, covenant family/template pin, state hash and business-object binding.
3. **Rebuildable operational cache** — `settle_evidence`, convenience columns and indexes.

Some off-chain semantic preimages are also not recoverable from a chain commitment alone. Therefore “DB = disposable cache” must be narrowed field by field. Do not design P0/P2 around an impossible chain-only replay guarantee.

## MUST-FIX 2 — Tier 1 is local-index corroboration, not independent chain truth

The proposed Tier 1 obtains `psOutpointTxid/psIdx` from `payout_shards`, then reads `kaspa_tx_log.outputs_json` from the same local database. That is useful consistency evidence, but it is not independent chain observation and cannot establish canonicality, freshness or reorg safety.

Required correction:

- name it accurately as **local-index corroboration**;
- for a money-path verified result, bind the exact outpoint to a direct current-node/RPC receipt or the existing `check_utxo_landed` path;
- enforce the same minimum-depth/canonicality policy used by consolidate landing (`REORG_SAFE_MIN_DEPTH=20`) before the recovered state can drive close/claim construction;
- persist the block/DAA/depth receipt in the durable evidence layer.

A local tx-log row may be stale, noncanonical, incomplete or pruned independently of the current UTXO set.

## MUST-FIX 3 — `autoDetectConsolidateResume` is a candidate generator, not a truth oracle

Current code:

- starts from DB `payout_redeem_hex`;
- reads the initial pool from fixed byte offset 2;
- accumulates DB `market_shards.current_leaf_state.pool_value`;
- accepts the first UTXO found at a derived address;
- returns `null` both when genesis has any UTXO and when no candidate is found;
- uses `utxos[0]` without requiring uniqueness, expected amount, lineage, covenant id, confirmation depth or exact transition ownership.

This is vulnerable to false positives. A third party or test artifact can fund a covenant address with dust; multiple live UTXOs can exist at one address; a stale family/layout can generate syntactically valid but wrong candidates. “An address has a UTXO” is not enough to identify the live stateful-covenant tip.

Required contract:

- return a discriminated result such as `verified_tip | genesis_live | no_match | ambiguous | incoherent` rather than overloaded `null`;
- require exactly one acceptable candidate or fail closed;
- verify candidate amount equals the candidate state amount;
- verify exact script/address, covenant identity/lineage and expected transition shape;
- enforce confirmation depth;
- reject multiple candidates, dust-only matches and unexpected outpoints;
- record the matched candidate redeem bytes and receipt, not only the numeric pool.

Add negative tests for dust poisoning, two UTXOs at the same candidate address, shallow/reorged UTXO, missing index row and multiple matching steps.

## MUST-FIX 4 — P0 currently violates active K-18 authority at the final byte step

`consolidateAndBuildPsState` currently finishes by calling:

`compilePayoutShardRedeem({ poolMerkleRoot, predicateCommit, consolidatedPool, closed: 0 })`

and returns those newly compiled bytes as the spending redeem.

That directly conflicts with active `DEC-20260718-001`, which states:

> continuation authority = landed redeem + deterministic splice; recompilation from DB columns is validation only.

This is not theoretical. 8pson proved that a correct logical state plus the wrong compiler family/template produces a different P2SH address.

P0 must therefore:

1. make K-18 family/coherence classification a prerequisite for the row being recovered;
2. generate candidates by deterministic state splice from the verified landed/genesis redeem bytes and declared family/layout;
3. have the recovery helper return the exact matched `redeemHex`, address, family and outpoint;
4. use those matched bytes for the next spend;
5. run pinned-family recompilation only as a byte-equality assertion, never as runtime authority.

Recovering the right pool but recompiling the wrong redeem is still an unsafe recovery.

## MUST-FIX 5 — proposed self-heal is incomplete and race-prone

The draft updates only `payout_ps_outpoint`. It leaves `payout_redeem_hex`, family/pin and evidence provenance potentially stale, so the next tick can repeat the same mismatch. The write is also unconditional, with no compare-and-set against the stale outpoint and no single atomic receipt.

Required behavior:

- either keep P0 strictly read-only and return a verified recovery object to the caller;
- or atomically reconcile `outpoint + exact matched redeem + family/pin + consolidated_pool/state hash + observed block/DAA/depth` in one transaction;
- use compare-and-set on the expected old outpoint/version so concurrent ticks cannot overwrite a newer recovery;
- emit an immutable before/after recovery receipt;
- never swallow reconciliation errors.

A one-column best-effort repair is not state convergence.

## MUST-FIX 6 — P0 cannot be deployed while the same execution path still presence-trusts line 423

The plan correctly identifies `settleMarketLive` line 423 as another consumer that trusts `priorEvidence.consolidated_pool` merely because it exists, then defers it to a second PR within 24 hours.

That is an organizational schedule, not a safety boundary. If P0 is deployed alone, the recovered state can immediately flow into a downstream consumer that still trusts stale evidence.

Required sequencing:

- either include both call sites in the same reviewed money-path package;
- or merge P0 code dark but do not activate/deploy it until the line-423 consumer is converted to the same verified-state helper and the end-to-end close→claim path passes.

The acceptance unit should be the complete value-consumption path, not the first function that discovers the value.

## Additional challenge — P1 `preserve-merge` is not automatically non-money-path

A generic object spread fixes field deletion but can preserve stale fields indefinitely or let an older writer overwrite a newer observation. Because settlement later consumes this evidence, persistence semantics can affect the money path indirectly.

P1 should include:

- field ownership and merge rules;
- schema/evidence version;
- source outpoint/txid, block/DAA and observed depth per critical value;
- monotonic compare-and-set or writer sequence;
- tests for concurrent/stale writers and rollback/reorg;
- shadow-mode verification before production activation.

Do not label P1 safe merely because it “only writes JSON.”

## Required revised DoD before P0 money-path approval is requested

1. K-18 coherence/family gate is enforced for every P0 row.
2. Verified-state helper returns exact matched covenant bytes, outpoint, amount, family and canonical receipt.
3. No runtime recompile authority remains after recovery; recompile is assertion only.
4. Exact candidate uniqueness, amount, lineage and D=20 checks pass.
5. Tier 1 is explicitly cache corroboration; authority comes from node/current UTXO evidence.
6. Recovery writeback is atomic/CAS or P0 remains read-only.
7. Both `consolidateAndBuildPsState` and the line-423 claim consumer use the same helper before activation.
8. Negative tests cover dust poisoning, duplicate UTXOs, wrong family/incoherent bytes, indexer gap, shallow/reorg state, concurrent ticks and Tier2 ambiguity.
9. The architecture document distinguishes current chain state, durable post-pruning evidence and disposable cache.
10. NWT re-reviews the actual implementation diff and tests. Owner money-path authority is requested only after these artifacts exist.

## Final assessment

The direction is worth pursuing, but the current draft should **not** be green-lit for implementation/deployment as written. The correct next move is a v0.2 design that unifies #28 with K-18 and Evidence Continuity rather than building another parallel “truth” path.

No production or money-path action is authorized by this review.