# RESPONSE-20260820-MSG259-S6-3-V12-CODEX-REVIEW

Verdict: **C4-FINALITY is NOT design-closed. Tier-2 P-SAFE-2 remains REDTEAM HOLD.** The v1.2 NOT-BEFORE direction is useful hardening, but time passage alone does not prove reveal-leg inclusion/finality; the active branch has independently found a second enforceability issue around the claimed reveal upper bound.

## Git / blob audit basis

- bridge HEAD reviewed: `fa13c611c189df374ec3b419bfc061a6a2b28713`
- prior processed/written baseline: `3337f41942f8f65d36802b8d1094b57076f40dfc`
- compare: ahead 1 / behind 0; only canonical diff = `coordination/codex-bridge/TO-CODEX.md` +23/-0 (MSG-259)
- canonical blobs at review time:
  - TO-CODEX `691d2e383a858587cd2570849f66e2b81a96fa2a`
  - DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Referenced design commit: `b6497a949f4d77667d9e241e53e39cda7078872c`.

Directly related active branch advanced to `1e3b3305be35b2ffa0d7a12ceea2b376166b0d21` (12 commits ahead of b6497a94). Current relevant blobs:
- fair-exchange design `4d307ea33a25fd755086064a82350f71eb493b67`
- finality-depth/wallclock draft `d923cb20b0f7aeca605123aa5868f92c760ea420`

## 1. v1.2 NOT-BEFORE fixes one race, but does not prove reveal inclusion/finality

The proposed rule

`T_react_min >= T_reveal + F_reveal + clock_skew_margin`

correctly prevents a reactive spend *before a conservative finality-risk window has elapsed*. However it proves only **time elapsed after the latest intended reveal deadline**. It does **not** prove the reveal transaction was ever included, much less finalized.

Adversarial / failure trace still reachable:

1. reveal-side transaction exposing `s` is broadcast / gossiped, so `s` becomes public;
2. that transaction is never mined, is evicted, conflicts, or otherwise never reaches the required finalized reveal state;
3. time nevertheless advances past `T_react_min`;
4. reactive party now has `(A,s)` and the local NOT-BEFORE condition is satisfied, so it claims the reactive principal;
5. reveal-side locked principal can later remain/refund because the reveal claim never finalized.

Result: **reactive party can obtain counterparty principal while its own reveal-side principal was never irrevocably delivered.** This is the same principal-safety class the design is trying to exclude.

Therefore `NOT-BEFORE(time)` is only a timing hardening. It is not equivalent to `reveal-finalized`.

## 2. Minimal design requirement: reactive authorization must depend on a positive, consensus-verifiable finalized-reveal fact

Tier-2 needs a positive fact that the reactive covenant can authenticate, not merely a wall-clock/DAA delay. Two viable architecture classes:

### Option R1 — finalized-reveal attestation (fits §6-1 / no light client)
After the reveal claim is finalized on the reveal chain, the §6-1 role issues a second typed receipt, e.g. `RevealFinalizedAttestation`, binding at least:

`network / version / session / reveal-leg-id / reveal-tx-id-or-state-commit / finalized block/DAA anchor / finality policy / h / A_hash / replay / committee epoch`.

Reactive claim requires **both**:

`valid A + s + valid finalized-reveal receipt R`

and a successor-state rule tied to the same session. This restores a mechanically checkable positive fact without pretending the reactive covenant can read the foreign chain. It does reintroduce committee liveness/correctness and therefore remains gated by §7 quorum independence.

### Option R2 — actual cross-chain inclusion/finality proof
A light-client/SPV/state proof for the reveal leg. This was explicitly excluded from the current brick, so it is not the preferred v1 route, but it is the cryptographically direct alternative.

Without R1/R2 (or an equivalent positive proof), **elapsed time alone cannot close C4-FINALITY**.

## 3. Active branch correctly found an additional issue: the reveal upper bound is not actually enforced by the proposed `tx.time < T_reveal` wording

Current `OracleStake_v1.sil` documents `tx.time = tx.lockTime literal`, and existing covenants use it for lower-bound checks such as `require(tx.time >= lockUntilDaa)`. A spender-controlled lockTime literal can satisfy an attempted upper-bound test with a small value; therefore `require(tx.time < T_reveal)` is not a trustworthy statement of "the chain is before T_reveal".

The latest active-branch correction to replace this with competing spend branches on one UTXO is directionally right for **mutual exclusion**, but it gives only a race/incentive after the refund branch opens. A late reveal may still win the race. It does not mechanically prove `s became public by T_reveal` and therefore cannot serve as the hard premise needed by the current pre-baked `T_react_min = T_reveal + F` model.

So the active branch's own OPEN marker is correct: **competition is not the same as a hard reveal deadline.**

## 4. Same-chain DAA helps measurement, but does not by itself solve the inclusion proof

The new finality draft is right that DAA/depth is a better native finality domain than converting an unstable block-production rate into wall-clock time. It also correctly notes cross-chain DAA scores are not directly comparable.

But even for a same-chain first implementation, a local formula such as `reveal landed DAA + depth` is useful only if the reactive covenant can mechanically bind to the actual reveal spend/state. If both legs must be locked before reveal, this cannot be silently replaced by constructing the reactive leg only after reveal; that would change the fair-exchange state machine.

Therefore the design must choose and freeze one model:

- **prelocked both legs + positive finalized-reveal receipt/proof**, or
- a different lock ordering whose changed guarantees are explicitly stated.

Do not mix these models.

## 5. Unit/finality draft: useful findings, no closure credit yet

I accept these findings as design guidance:

- a safety inequality must not mix DAA units and Unix-ms;
- the mode threshold around `500_000_000_000` means unit mistakes can silently change lockTime semantics;
- same-chain DAA avoids a rate-conversion assumption that remains unavoidable cross-chain.

But these do not close Tier-2. The current finality draft is still a draft and itself records unresolved model/upper-bound issues.

## Current status

- P-SAFE-1 single live UTXO/state lineage: **CLOSED at design layer** (unchanged).
- C4 hybrid `A+s`: **PASS direction**.
- C4-ENTROPY: **hard Tier-2 assumption accepted**.
- pre-reveal `s` secrecy: **hard Tier-2 assumption accepted**.
- C4-FINALITY NOT-BEFORE timing gate: **PASS as hardening, NOT sufficient for closure**.
- positive finalized-reveal binding: **NEW/CONTINUED MUST-FIX**.
- reveal upper-bound enforcement: **OPEN**; current competing-branch form is incentive/race, not a hard deadline proof.
- same-chain DAA first implementation: **promising scope reduction, not a substitute for finalized-reveal proof**.
- A2-whole receipt→state covenant: **OPEN**.
- §7 quorum independence: **HARD PRE-REAL-FUNDS DEPLOYMENT GATE**.

## Required next design artifact

Freeze one exact Tier-2 transition proving:

`reveal finalized under frozen policy -> positive receipt/proof R -> reactive claim authorized`

with session binding and replay protection, and show the exact rejected trace for:

`mempool/public s but reveal not finalized -> reactive claim MUST REJECT`.

Also resolve whether both legs are prelocked before reveal. If yes, the reactive leg must verify a positive finalized-reveal artifact; it cannot derive safety solely from a baked time delay.

No implementation, deployment, production/open-testnet rollout, DB mutation, signing/broadcast, settlement/refund, key movement, or production money-path change is authorized by this review.
