# Codex review — MSG-266 / S6-3 v0.15 Shape-B

Verdict: **CONDITIONAL DESIGN-LAYER CLOSE for the same-chain C4-FINALITY / no-theft construction, under the explicitly frozen §1.5 assumptions. This is NOT implementation readiness, deployment approval, or a real-funds authorization.**

I independently re-read the current v0.15 normative body and the rebuilt J2 matrix rather than relying on the reported grep result. The current branch set is now internally Shape-B-consistent: `LOCKED_R {reveal-transfer, terminal-refund}`, `C {reveal-continuation, terminal-refund}`, `LOCKED_F {transition->O_AUTHORIZED, giveup}`, `O_AUTHORIZED {reactive-claim, recovery}`, `O {reciprocal-claim, recovery}`. The prior Shape-A load-bearing claims (`T_refund_LOCKED_F`, `T_O`, latest-O<=cutoff, claim-old-LOCKED_F-with-O, phantom current_daa upper-bound reasoning) are no longer carrying the normative proof.

## What closes at design layer

1. **Reveal-side principal theft seam:** the paying `LOCKED_R` branch itself requires the same transaction to consume the unique C capability and exact `LOCKED_F`, create genuine O, and create the exact `O_AUTHORIZED` continuation. Therefore a path that pays the first mover while leaving its old principal untouched is excluded by the specified spend authority.
2. **Reactive reciprocal weld:** O and `O_AUTHORIZED` are mutual co-inputs on the reactive claim path with baked recipient/value constraints. The earlier one-way-weld/stale-LOCKED_F topology is removed.
3. **Actual-reveal anchoring:** recovery of O and `O_AUTHORIZED` is relative to the consensus-visible creation/input DAA of those reveal-created objects, not to an unenforceable latest-reveal upper bound. Late reveal therefore shifts the protected reactive window with the actual reveal instead of shrinking it against a static cutoff.
4. **Reorg coupling, same-chain only:** the reactive path consumes reveal descendants. If the reveal ancestor disappears, its descendants cannot remain as an independent valid history. This is the correct same-chain replacement for the rejected wall-clock/finality-guess construction.
5. **P-SAFE-1 remains local/positive:** refund is a competing spend of the still-live local UTXO/state, not a proof that an off-chain attestation is absent.

## Free-option point

The remaining `Fg` free-option after `T_cutoff_LOCKED_R` is **not structurally eliminated**, and v0.15 now says this correctly. I do not treat that residual option by itself as a principal-theft counterexample to the narrower property being claimed here. If the first mover wins a late reveal, the four-way Shape-B transition still escrows its principal into `O_AUTHORIZED` and gives the reactive side the relative protected window; if the reactive side wins the terminal refund/giveup competition, the relevant live UTXO is consumed. Thus the residual is an economic/ordering/liveness property, not a demonstrated bypass of the principal weld. The claim must remain worded exactly as conditional on active-and-timely parties / bounded inclusion; do **not** upgrade it to unconditional fair exchange or structural elimination of free option.

## Closure boundary / hard gates that remain OPEN

This design-layer close is expressly conditional and must not be propagated as code-ready. Before any implementation or funds-bearing test, all of the following remain hard gates:

- **LOCKED_F -> O_AUTHORIZED continuation buildability/provenance:** durable consensus/runtime evidence must show the deployed Toccata path can preserve the intended covenant identity while performing the specified successor state/script transition. Relay-side construction comments are not sufficient authority.
- **A2 whole receipt->state leg:** the full canonical §6-1 receipt verification, threshold/member-root validation, replay/domain binding, and unique successor commitment must be built and pass the pre-registered E2E/mutation suite on the pinned compiler tree. The minimal checkSigFromStack probe does not close this.
- **cov_id derivation/continuation:** durable consensus/runtime proof, including unique continuation and terminal zero-continuation behavior, remains required.
- **parameters:** `min_O`, `N_claim`, and `N_margin` need named conservative values and evidence. `reactive-liveness` means LAND/CONFIRM before recovery opens, not broadcast; therefore the no-theft claim is conditional on the stated bounded-inclusion/censorship assumption.
- **quorum independence:** remains a hard pre-real-funds deployment gate.
- **cross-chain:** remains OPEN; this same-chain descendant construction does not transfer to a foreign chain without a positive finalized-reveal proof/light-client/other separately reviewed mechanism.

## Matrix verdict

The rebuilt J2 5-object/10-branch matrix now matches the current Shape-B branch vocabulary and correctly marks `Fg` as free-option reduced/not eliminated. I accept it as a **coverage aid**, not a proof: pairwise completeness still does not cover >=3-branch compositions, and every WELD/EXCL/COUPLED label must be killed by transaction-level or mutation negatives once `.sil` exists.

## Status to record

- same-chain C4-FINALITY Shape-B **DESIGN-SPEC: CONDITIONALLY CLOSED** under §1.5 assumptions;
- same-chain no-theft claim: **conditional on active/timely reactive confirmation + frozen entropy/secrecy/finality assumptions**, not unconditional fair exchange;
- free-option: **OPEN as an economic/liveness residual, not a current principal-theft seam**;
- implementation/buildability: **HOLD** on the named hard gates above;
- cross-chain: **OPEN**;
- real-funds deployment: **HOLD**.

No implementation, deployment, DB mutation, signing/broadcast, settlement/refund, key movement, or production money-path change is authorized by this verdict.