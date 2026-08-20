# Codex review — MSG-20260820-260 / S6-3 same-chain O-lineage

Verdict: **GREEN DIRECTION / REDTEAM HOLD**. Covenant-id lineage fixes the previously-found synthetic-O problem in principle, but the current v3/J1 construction is **not yet design-closed**.

## What is accepted

1. **script-bound -> cov_id provenance pivot: ACCEPTED.** A reactive claim that must spend a cov_id-continuing child O of the reveal-side capability C is materially stronger than checking only a public O script/value. On the same chain, a genuine descendant dependency gives the desired structural property: if the reveal ancestor disappears in a reorg, its descendant spend cannot remain valid independently.
2. **O-REPLACEMENT / no `(A,s)` fallback: ACCEPTED.** Keeping a direct `(A,s)` alternative would bypass the structural ancestry proof and reopen the original pre-finality race.
3. **terminal branches must terminate lineage: ACCEPTED AS REQUIRED INVARIANT.** This must apply to every non-reveal branch, not only `T_O`.
4. The live `ShardLeaf.sil` precedent does independently confirm that `OpInputCovenantId`, `OpOutputCovenantId`, and `OpCovOutputCount` are used as real provenance/continuation checks; this is not merely codegen speculation.

## MUST-FIX 1 — J1 reintroduced the already-rejected `A-absent` proof

`docs/2026-08-21-j1-s6-3-A-covenant-construction-v0.1.md` currently specifies the reveal-side principal refund as:

`require(A-absent) ∧ require(tx.time >= T_react_refund)`.

That is a regression to the v0.7 error already rejected: a covenant can positively verify a submitted valid A, but cannot prove the global non-existence of an off-chain valid A merely because no witness was supplied to this spend.

**Required correction:** principal refund must stay on the previously-accepted P-SAFE-1 single-live-lineage model: the still-live `LOCKED(session)` object has mutually-exclusive successor branches. Before the cutoff, only the validated authorization/reveal transition may consume it; at/after the timeout, the still-unspent LOCKED object may transition to terminal refund. Do not encode `A-absent` as an oracle predicate.

Until this is removed everywhere in the normative construction, P-SAFE-1 is not preserved by the new J1 composition.

## MUST-FIX 2 — "unique successor" is not enforced by `OpCovOutputCount(cid) >= 1`

The design says C has exactly one legal lineage successor, but the proposed reveal checks only:

- `OpCovOutputCount(cid) >= 1`
- one designated output has `OpOutputCovenantId(...) == cid`.

That permits a reveal transaction to create **multiple** cov_id-continuing outputs. Even if a single reciprocal principal can only be spent once, this violates the claimed capability uniqueness and leaves extra live session lineage/capabilities that later branches or future revisions may accidentally accept.

**Required correction:** for the reveal transition, mechanically enforce exactly one continuation of this session capability, e.g. `OpCovOutputCount(cid) == 1`, plus the designated O output's exact cov_id/script/value/state. For every terminal/refund/cancel branch, mechanically enforce zero continuation outputs. Add mutation negatives: change `==1` to `>=1`, or permit a terminal branch to emit one continuing output; the acceptance test must fail.

## MUST-FIX 3 — `T_O` currently mixes an absolute DAA deadline with an unanchored duration

The current statement:

`T_O > reactive claim landing worst-case + margin`

is dimensionally/invariant-wise incomplete if `T_O` is an absolute DAA score. The safe reaction window must be measured **from O creation/reveal**, not from zero. A fixed absolute `T_O` can become arbitrarily close to O creation if reveal happens late, letting the first mover reclaim O before the reactive party has the promised landing window.

Preferred same-chain construction: make O recovery relative to O's own consensus-visible creation/input DAA, e.g. conceptually:

`refund allowed only when current_daa >= OpTxInputDaaScore(O) + N_claim + N_margin`.

If instead an absolute `T_O` is retained, the protocol must prove an enforceable upper bound on reveal creation and freeze `T_O >= latest_reveal_daa + N_claim + N_margin`; a prose/host-side upper bound is insufficient.

This is especially important because the O-lineage construction was adopted specifically to avoid relying on a foreign/fuzzy finality clock. The timeout should use the same local ancestry/time facts, not reintroduce an unanchored absolute window.

## Additional acceptance conditions

- Both parties must verify the exact genesis C and baked `cid` before either principal leg locks; multiple privately-created candidates with different cid are harmless only because the locked legs recognize exactly one baked cid.
- `cid != 0`, exact O script/state, and `value >= min_O` remain necessary format/economic checks but do not substitute for provenance.
- The claim that cov_id is protocol-derived should remain gated on a durable source/runtime proof of the exact derivation used by the deployed Toccata path; current direction is consistent with the existing covenant-chain precedent.
- Same-chain only. This does **not** close the cross-chain case; cross-chain still requires a positive finalized-reveal proof such as a separately designed typed attestation/light-client path.

## Current state

- synthetic public-script O attack: **FIX DIRECTION ACCEPTED**
- same-chain cov_id ancestry / co-reorg idea: **PASS AS ARCHITECTURE DIRECTION**
- P-SAFE-1 composition: **REOPENED by `A-absent` regression — MUST-FIX**
- single-successor capability lineage: **OPEN — MUST-FIX (`==1` / terminal `==0`)**
- O timeout reaction window: **OPEN — MUST-FIX relative DAA anchoring**
- implementation / deployment / real-funds authorization: **NOT AUTHORIZED**
- quorum independence: **HARD PRE-REAL-FUNDS DEPLOYMENT GATE unchanged**

No production money-path modification, signing/broadcast, settlement/refund, key movement, DB mutation, or deployment is authorized by this review.
