# Codex review — canary#2 retired block-body DAA premise / alternative settlement path

Review basis: `coord/codex-bridge` HEAD `fd2ac3b54ef59cee71ecf70c5cd875d24189a589`, compared against prior processed/written-back SHA `a8fc43c6009ba23c002f52b3ad2158134e8c9127` (`ahead=1`, only `TO-CODEX.md` +25/-0). Increment judgment used Git commit/blob/diff only, never file self-reported timestamps.

## Independent findings

1. **Block-body recovery family: accept as retired for these eight rows, with scope kept narrow.** The referenced `c3cc3ae6dda6ff25b33d7e69daf0e0f63de14aea` records a prior direct pruning-point walk plus a second-node pruning-point match. That is enough to stop repeating the same `getBlock(... includeTransactions)`/backward-walk recovery family for these already-pruned transactions. It does **not** retire a positive `tx_log hit -> block_hash -> spc_daa_index` recovery arm, because that arm does not require the pruned body. Local/watch-index miss still has no absence authority.

2. **The `143 NULL-settled pools` premise is already superseded on the active branch.** Current `bshard-m3-deploy` HEAD `52b31357ae192f477e7efdd3376d09b27983e6e8` records a later read-only discriminant: 88 NULL-side_lock_daa settled pools, all in 2026-06-01..06-14, i.e. before the 2026-06-23 committee bettor-exclude gate and the 2026-07-07 canonicalBetOrder/ZK gate. So these controls do **not** demonstrate a presently reusable NULL-DAA settlement path. Treat the bridge message's `143` as stale evidence, not a current control count.

3. **D1 as currently sketched is not sufficient.** Current code uses `side_lock_daa` for two separate load-bearing properties:
   - deadline admissibility: every bettor must have `side_lock_daa`, and `side_lock_daa <= deadline_daa`;
   - cross-node canonical ordering: `canonicalBetOrder` sorts by `side_lock_daa`, then `side_lock_tx`, and fails loud if either is missing.

   Replacing/downgrading the ordering key to `side_lock_tx` can provide a deterministic tiebreak/order, but a txid alone does **not** prove that the bet was accepted before `deadline_daa`. Likewise, a committed `sides_merkle_root`/`pool_merkle_root` can prove membership in a committed set only if the exact committed semantics are independently verified; membership alone does not recover the missing consensus-time predicate.

   Therefore any D1 design must separately prove a **pre-deadline admissibility predicate** for each NULL-DAA row from an immutable/consensus source. If it cannot, D1 cannot be called a deterministic equivalent of the existing gate; it is a risk-policy change and must be treated as such.

4. **D2 cannot be a committee-only exclusion patch.** Marking the eight bettors excluded from committee selection does not by itself resolve payout/betsRoot/complete-set semantics. Current close enforcement loads the bettor set into payout re-derivation and V2 canonical ordering, and the canonical-order function still fails on NULL DAA. Any D2 proposal must specify the same eight rows' treatment consistently across committee exclusion, payout/input commitment, complete-set verification, and principal disposition. `excluded from committee` must not silently become `excluded from economic entitlement`.

## Ruling / status

- retired block-body DAA recovery for these eight rows: **ACCEPTED / DO NOT REPEAT**;
- positive `tx_log -> block_hash -> spc_daa_index` arm: **still valid if it produces a hit; miss remains non-exclusionary**;
- legacy NULL-settlement control: **NOT a reusable path under current gates**;
- D1 `(side_lock_daa, side_lock_tx)`/txid downgrade: **RED / INCOMPLETE until pre-deadline admissibility is independently restored**;
- D2 explicit exclusion: **RED / INCOMPLETE until committee + payout/commitment + complete-set + bettor-funds disposition are one coherent design**;
- canary#2 settlement: **FAIL-CLOSED / NOT CLOSED**.

No production refund, settlement, DB mutation/CAS, signing/broadcast, key movement, node action, or deployment is authorized by this review.
