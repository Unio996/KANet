# bshard post-fold payout-commit design (finding-1 + finding-2 fix) — J2

> **Date**: 2026-06-15
> **Author**: J2 (payout / settle / MASS / overflow domain)
> **Drives**: Bettor finding-1 (outcome not bound) + finding-2 (on-chain i64 parimutuel overflow) — bound together
>   in ONE spine close-commit. Bettor ruling: post-fold payout-proof; verify ①no on-chain big multiply ②payout
>   commit trustless ③claim still independent self-claim.
> **Status**: design for review (@Bettor 审 / @J1 SS / @NWT co-verify). Reuses `src/lib/pool-payout-root.mjs` (#31).

## 0. Why (the two findings)

- **finding-1** (Bettor, 致命): `settlementWinner` was a free witness → YES-bettor passes 0, NO-bettor passes 1, both
  pass `require(direction==settlementWinner)` → both sides drain the pool. The fold-root carries only the two-side
  **totals** (globalYes/No), NOT *who won*. "Who won" = the oracle resolution (a post-close, 1-bit value).
- **finding-2** (Bettor, my #31 domain): `payout = stake × totalPool / winnerPool` computed **on-chain** overflows
  i64 (`int` = i64, TUTORIAL L235). Measured: `stake×r` (remainder term of any overflow-safe ordering) exceeds i64
  once the winning side > **30.37 KAS** (`winnerPool² > 9.2e18`). So pure on-chain parimutuel is infeasible at any
  real scale. SS has no mulDiv / 128-bit intermediate (Bettor doc-checked; #31 confirmed). → **must avoid on-chain
  multiply entirely.**

## 1. Design — post-fold payout-commit (payoutRoot in spine close-commit)

One **spine close-commit** binds both findings (written at pool close, after fold completes):

```
closeCommit = { winningSide, payoutRoot, fold_tmpl_hash, shard_count }   // committed to the shard's spine at close
```

- `winningSide` (1 bit) — oracle/committee resolution (finding-1: the bound outcome).
- `payoutRoot` — merkle root over each winner's EXACT payout (finding-2: no on-chain multiply).
- `fold_tmpl_hash`, `shard_count` — the post-close fold-binding values (the earlier timing-deadlock fix).

### 1.1 Off-chain payout computation (at close, BigInt — no overflow)

After fold gives `globalYes, globalNo` (trustless on-chain values) and `winningSide` (oracle):
```
totalPool   = globalYes + globalNo            // BigInt
winnerPool  = winningSide==YES ? globalYes : globalNo
for each winning-side bettor w:
    payout_w = stake_w * totalPool / winnerPool   // BigInt, no overflow
```
Losers are NOT in the set (no leaf → no valid proof → cannot claim; defense-in-depth with the `direction==winningSide` gate).

### 1.2 payoutRoot (reuse pool-payout-root.mjs #31 pattern)

`leaf_w = blake2b(bettorPk_w ‖ serializeI64(payout_w, 8))` — EXACTLY `payoutLeaf()` in `pool-payout-root.mjs`
(serializeI64 = source-verified LE sign-magnitude, byte-match 7/7). `payoutRoot` = position-aware merkle root.
**Generalize to variable depth** (current lib is fixed depth-8 = 256 cap; bshard global winner set can exceed 256 →
depth = ceil(log2(numWinners)); claim provides depth + siblings; SS climb loop bounded by MAX_DEPTH).

### 1.3 claim_winner (per winner, independent — no on-chain multiply)

```
1. read spine close-commit (readInputStateWithTemplate / spine ref-input);
   verify spine input.scriptPubKey == PoolSide.spineP2shHash   (NWT req-3, hash compare not P2SH-reconstruct)
2. require(direction == winningSide)                            (finding-1, now bound — defense-in-depth)
3. merkle-prove leaf = blake2b(bettorPk ‖ serializeI64(payout,8)) ∈ payoutRoot   (climbProof, depth siblings)
4. output payout to bettorPk; PoolSide UTXO spent-once          (independent self-claim)
```
**No multiplication on-chain** — `payout` is merkle-PROVEN, not computed. ✓ finding-2.

## 2. Trustless (the load-bearing constraint — Bettor ②)

`payoutRoot` is a **deterministic function** of: `winningSide` (committee, in close-commit) + `globalYes/No`
(fold-root, on-chain trustless) + every bettor's `stake` (on-chain in PoolSide UTXOs). → **any node recomputes the
identical payoutRoot**. So a settler cannot forge it undetectably:
- **testnet (current endpoint)**: oracle/committee attests `closeCommit` (same entity + trust level as the outcome
  it already attests; a wrong payoutRoot is publicly recomputable → reputation/abort). = #31 committee-attested-root
  trust, accepted for testnet (no economic stake, per project-endpoint).
- **mainnet (backlog)**: optimistic-dispute — `closeCommit` posted with a bond + challenge window; any verifier
  recomputes, challenges a mismatch → revert + slash. Removes committee trust (zero-committee for value).

## 3. Satisfies Bettor's 3 verify conditions

| # | Condition | How |
|---|-----------|-----|
| ① | on-chain no big multiply (i64 overflow) | payout merkle-PROVEN, never computed on-chain — zero multiply |
| ② | payout commit trustless | payoutRoot deterministically derivable (winningSide + fold globals + on-chain stakes); committee-attest (testnet) / optimistic-dispute (mainnet) |
| ③ | claim independent self-claim | each winner reads close-commit + own merkle proof + spends own PoolSide; no settler push |

## 4. Division of labor

| Who | Part |
|-----|------|
| **J2** | this design; off-chain BigInt payout + variable-depth payoutRoot builder (extend pool-payout-root.mjs); spine close-commit single-source builder (winningSide + payoutRoot + fold_tmpl_hash + shard_count); merkle-proof builder for claim |
| **J1** | SS: PoolSide claim_winner reads close-commit + climbProof(payoutRoot) + spent-once + direction gate; spine close-commit covenant |
| **NWT** | co-verify ①②③ + payoutRoot determinism (recompute byte-match) + dispute (mainnet) |
| **Bettor** | 审 design + integration ruling |

## 5. Open / mainnet backlog
- Variable-depth merkle: fix MAX_DEPTH for SS climb (e.g. depth-14 = 16384 winners/market; >that → multi-root).
- Optimistic-dispute mechanism (bond/window/slash) = mainnet; testnet uses committee-attest.
- payout dust/rounding: BigInt floor → Σpayouts ≤ winnerPool×ratio; remainder (< numWinners sompi) handling (burn / maker), documented.
