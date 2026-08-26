# Codex review — MSG-271 / MSG-272 + unsynced §6-3 gate (d)

Verdict summary:

- **P1(g) toolchain/artifact provenance: CLOSED for the frozen primitive/compiler-evidence scope.** Reading 甲 is sufficient; a fresh rebuilt-A on-chain cycle is not required for closure.
- **gate (h): CLOSED AT DESIGN LAYER.** H1/H2 are now frozen correctly; implementation acceptance remains pending the real covenant and zero-skipped/zero-inconclusive mechanical execution.
- **gate (d): OPEN / PROVISIONAL.** The current bounds proposal is useful and directionally conservative, but two quantitative-proof issues remain in addition to NWT's min_O model correction.

No part of this review authorizes covenant BUILD, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or any production money-path action.

## 1. P1(g) — Reading 甲 accepted; gate closed for the frozen scope

The newly durable evidence chain is sufficient for the narrow gate I left open.

What is now durably established:

1. The exact 2026-08-20 ctor is preserved.
2. Rebuilt artifact A and authoritative compiler C produce the same probe artifact from that ctor.
3. The A/C probe artifact is byte-identical to the artifact recorded as used by the 2026-08-20 TN12 runner: same 40-byte script, SHA-256 `21fa272f00ed96d9b37ab5e925d8fb961611131942bca39adea2537d94e0d50f`.
4. The frozen negative arms are preserved as exact sig/digest vectors.
5. The durable 2026-08-20 run evidence records six script-layer REJECT outcomes and two PASS txids, with no inconclusive outcome in that run.
6. The rebuilt-A offline run reproduces the frozen expected vector outcomes with zero mismatch and zero inconclusive.

The missing serialized bodies of the rejected transactions do **not** force a fresh on-chain rerun for this narrow provenance/runtime-primitive gate. The reason is important: the preserved rejection reasons are explicitly script-verification failures (`failed to verify the signature script`, including the V4 `script ran, but verification failed` arm). Those transactions therefore reached the script-verification layer; the evidence is not merely "RPC rejected for some unknown transaction-level reason". Combined with the preserved exact witness vectors and the byte-identical script, the missing unrelated input/output/fee/lockTime bytes do not create a material ambiguity about the primitive behavior being evidenced.

So the closure claim is deliberately narrow:

> **The durably reconstructible rebuilt compiler A has been tied to the exact script bytes already exercised on TN12, and the frozen primitive vector family has durable positive/negative runtime evidence.**

A fresh rebuilt-A on-chain rerun remains a useful regression/forensic hardening exercise after node sync, especially if it persists every submission body, but it is **not required to keep P1(g) open**.

This does **not** give closure credit to A2-whole receipt verification, Shape-B money topology, or any real settlement covenant.

## 2. gate (h) — CLOSED AT DESIGN LAYER

H1 is now fixed correctly. The transaction-level composite cases have been split into independent arms so that each attack transaction omits exactly one weld while satisfying the others:

- `TX-4WAY-OMIT-C`
- `TX-4WAY-OMIT-LOCKED_F`
- `TX-4WAY-OMIT-OAUTH`
- `TX-O-WITHOUT-OAUTH`
- `TX-OAUTH-WITHOUT-O`
- `TX-OAUTH-WRONG-LINEAGE`
- plus the already separate `TX-SPLIT-WELD`

The crucial acceptance rule is also correct: each arm must be rejected at its **declared target weld**, not merely "rejected somewhere". That prevents an earlier guard from masking an untested downstream weld.

H2 is also fixed correctly. `CFG-UNIT-DOMAIN` is now an independent configuration mutation rather than prose hanging off the ordering tests. This is the right separation: `CFG-GIVEUP-ORDER`/`CFG-CUTOFF-ORDER` ask whether numbers on one ruler are ordered correctly; `CFG-UNIT-DOMAIN` asks whether they are still on the same ruler at all.

Therefore:

> **gate (h) = CLOSED AT DESIGN LAYER.**

Carry-forward conditions remain exactly load-bearing:

1. re-anchor every ID to the real `.sil` branch/file:line when implementation exists;
2. mechanically execute all load-bearing statement/transaction/configuration arms with **zero skipped / zero inconclusive**;
3. any branch-set change invalidates this table and the pairwise matrix and requires regeneration/re-review;
4. `N_claim` / `N_margin` concrete values remain gate (d), not gate (h).

This is design-layer closure of the acceptance contract, **not implementation acceptance**.

## 3. Unsynced gate (d) review — useful proposal, but numerical gate remains OPEN

I reviewed the active-branch conservative-bounds proposal and NWT red-team because they are directly downstream of MSG-267 and materially affect §6-3 readiness.

I agree with several findings already recorded there:

- `N_claim` and `N_margin` are audit decompositions; the covenant enforces their sum.
- using DAA relative deltas for recovery is directionally correct for a same-chain bound.
- `N_claim=3600` is only provisional: the 149s datum is one funding-path observation, not the final two-covenant-input claim shape and not depth-20 evidence.
- NWT's `min_O` observation is real: the current rationale assumes O is the sole fee source, but the present design does not mechanically forbid an extra ordinary fee input. Before `min_O` is frozen, choose one model explicitly: either enforce the no-extra-fee-input topology, or price `min_O` from the storage/value obligation rather than silently charging all claim fees to O.

I add two quantitative-proof corrections.

### D-MUST-FIX-1 — do not claim N_claim underestimation is "absorbed by N_margin" without unallocated slack

The current decomposition sets approximately:

- `M_observe = 55,200`
- `M_reorg = 400`
- `M_congest = 1,800`
- `N_margin = 57,600`

That margin is already allocated to named risks. Saying a weak `N_claim` estimate is safe merely because `N_margin` is numerically much larger double-counts the same safety budget unless the proof explicitly shows one of the following:

- those risks are mutually exclusive and the bound is a `max`, not a sum; or
- there is a separately named **unallocated slack** term available to absorb N_claim model error; or
- the final bound is recomputed from a joint worst-case trace in which observation delay, claim landing delay, reorg and congestion are composed without double counting.

At present the document explicitly **sums** the margin components, so there is no free 57,600-DAA reserve left over simply because the number is large. `N_claim` therefore remains independently weak until the real claim-shape/depth data are collected.

This does not mean 61,200 is necessarily too small; it means the current proof for why N_claim weakness is harmless is not valid yet.

### D-MUST-FIX-2 — wall-clock impairment -> DAA conversion needs an observed/conservative network-DAA-rate envelope, not target 10 BPS alone

`M_observe` converts a 91-minute local impairment window to ~54,600 DAA using 10 BPS. For a recovery deadline expressed in DAA, the dangerous case is the **maximum network DAA advance while the claimant is impaired**. Ten BPS is a target/nominal rate, not by itself a hard upper bound on DAA accumulation over every operational window.

So post-sync re-sampling should record, for each lag/stall interval, both wall-clock duration and **network/reference DAA advance over that same interval**. `M_observe` should be derived from the observed/conservatively capped DAA advance directly, or from a separately justified upper operating envelope. Do not infer the safety bound from `minutes × target-BPS` alone.

The same point applies if watchtowers are introduced: best-of-N observation can legitimately reduce the effective unavailability window only if the watchtowers are actually independent enough in node/RPC/failure domain and the payout remains non-redirectable. That is an architecture/operating-envelope decision, not a free numerical haircut.

## 4. Current gate state after this review

- same-chain Shape-B design spec: **CONDITIONALLY CLOSED** (unchanged)
- **P1(g): CLOSED** for the frozen compiler/probe provenance-runtime scope
- **gate (h): CLOSED AT DESIGN LAYER**; implementation execution still pending
- gate (b): **OPEN** — real A2-whole receipt-verifying settlement covenant still absent / Owner-code-gated
- gate (d): **OPEN / PROVISIONAL** — real claim-shape depth data, post-sync operating envelope, fee-source model, and the two proof corrections above still required
- gates (a)/(c): remain open buildability/provenance gates
- gate (e): remains hard pre-real-funds quorum-independence gate
- cross-chain: remains separate future scope

Again: no implementation or production-funds authorization is granted by this review.
