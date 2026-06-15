# bshard unlimited-betting — Known Limitations (testnet demo scope)

> **Date**: 2026-06-15
> **Authors**: J2 + NWT + Bettor + J1 + KANet-UI (adversarial design review, 2026-06-15)
> **Scope**: testnet public demo ([[project-endpoint-testnet-public-not-mainnet]] — paradigm + technical validation,
> NO economic stake). These are honest, documented limitations — NOT bugs to hide (Bettor: 别埋). Each has a
> mainnet trustless/scale path noted as post-demo backlog.

The bshard design (rolling shards + trustless fold + self-claim via payoutRoot) is **trustless in aggregation**
(the fold covenant conserves localYes/No on-chain, zero committee) but carries the limitations below at the
payout/claim layer, fundamentally rooted in Kaspa SS constraints (i64 arithmetic, no reference inputs).

## L1 — Self-claim is SERIAL, not parallel (ref-input absent)

**Root**: Kaspa has no read-only / reference inputs (3-vantage source-confirmed: Bettor DECL/TUTORIAL + NWT
rusty-kaspa grep + J2 — standard UTXO, all inputs consumed; introspection reads a *consumed* input, not a
Cardano-style ref input). So N winners cannot concurrently *read* the one immutable spine close-commit.

**Demo behavior**: each `claim_winner` spends the current spine UTXO + recreates it byte-identical (spine
`claim_passthrough` entry: `require(closed==1)` + `validateOutputState` recreating the same `{closed, winningSide,
payoutRoot, fold_tmpl_hash, shard_count}`, no committee sig), reads its state to verify payout in the same TX,
and the next claim uses the new spine UTXO. → **K winners settle over ~K blocks (serialized)**. The off-chain
claim builder re-queries the latest spine outpoint before each claim and retries on a stale outpoint.

**Grief**: spamming `claim_passthrough` moves the spine outpoint → claimers retry (griefer burns fee; non-fatal).

**Mainnet path (post-demo)**: parallel via a read-tree / close-time fan-out (closeCommit copied into each
PoolSide at close) — a scale item, same as the original bshard sharding backlog.

## L2 — payoutRoot is committee-TRUSTED, not on-chain-enforced

**Root**: the parimutuel payout `stake × totalPool / winnerPool` cannot be verified or disputed on-chain — the
multiply overflows i64 (`OpMul` = `checked_mul`, hard-fails `NumberTooBig` — rusty-kaspa opcodes/mod.rs L769-773;
no mulDiv / 128-bit / bignum). So payouts are computed off-chain (BigInt) and committed as a merkle `payoutRoot`
in the spine close-commit, attested by the oracle/committee at close (the same entity + trust level that attests
the outcome). The payoutRoot is a **deterministic function** of (winningSide + fold-root globals + on-chain
stakes) → any node recomputes it byte-identical → a wrong root is publicly **detectable off-chain**, but **not
on-chain enforced** (the enforcement check is the overflowing multiply itself).

**= v07 committee-trust level.** Honest scoping: bshard = **trustless FOLD + committee-trusted PAYOUT**. Testnet
(no economic stake) acceptable; same class as the #31 committee-winner-attestation residual.

**Mainnet path (post-demo)**: optimistic-dispute. The fraud proof can recompute a challenged bettor's payout in
**canonical coarse units** (e.g. 0.01 KAS), which IS i64-safe (J2 measured: cap ≈ 30.4M KAS @ 0.01-KAS / 303M @
0.1 / 3.0B @ 1-KAS) → on-chain mismatch → slash. Trustless up to the coarse-unit pool cap; beyond cap = trust.

## L3 — Per-market winner cap (merkle depth)

payoutRoot merkle is variable-depth, `MAX_DEPTH = 16` in the SS climb → **65536 winners per market** (ample for
demo). Beyond → multi-root (post-demo scale).

## L4 — market_id binding (FIXED during review, recorded for provenance)

[pre-fix] The spine ctor declared `market_id` but did not use it → the compiler omitted it → it was absent from
the redeem AND the P2SH (J2 compile-probe: changing market_id changed neither the template hash nor the P2SH;
committee+deadline changed both). Consequence: two markets sharing committee+deadline → identical spine P2SH →
cross-market theft (a winner in market A presents market B's close-commit, same P2SH passes
`PoolSide.spineP2shHash`, with B's payoutRoot). committee is market-create-assigned (reusable) → real risk.
[fix] `market_id` is USED in `close_commit` redeem (require/sighash) → distinct redeem → distinct P2SH → markets
always distinct. NWT co-verify = recompile-probe: post-fix, changing market_id MUST change the P2SH.

---
*All four are testnet-acceptable per the demo scope; L1/L2 carry the load-bearing trust/liveness honesty. Mainnet
trustless+parallel = documented post-demo backlog.*
