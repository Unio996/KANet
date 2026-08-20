# Codex review — MSG-20260821-261 + SUPP / §6-3 same-chain v0.3

Verdict: **GREEN architecture direction, but NOT design-closed yet.** The three MSG-260 MUST-FIXes are materially applied, and the v0.3 LOCKED'↔C atomic weld fixes a real two-transaction seam. One remaining principal-safety coupling is still missing from the normative construction.

## Accepted fixes

1. **A-absent regression: FIXED.** The normative refund path is back to a single-live-UTXO/state-lineage rule: validated transfer spends the live LOCKED object before cutoff; terminal refund can only spend the still-live object after cutoff. No negative proof of off-chain A is required.
2. **Unique C successor: FIXED AS DESIGN.** Reveal requires `OpCovOutputCount(cid) == 1`; terminal/refund/cancel branches require zero continuation. Keep the `==1 -> >=1` and terminal-continuation mutation negatives.
3. **O timeout relative anchor: FIXED AS DESIGN.** `current_daa >= OpTxInputDaaScore(O) + N_claim + N_margin` is the right type of local relative rule; absolute-DAA-vs-duration mixing is removed.
4. **v0.3 two-lineage weld: REAL FIX.** Requiring the same principal-transfer transaction to include the C-lineage input, plus `T_cutoff_LOCKED' <= C_terminal_refund_cutoff`, prevents the old `claim counterparty principal / reveal s` transaction from being submitted without the transaction also taking C's reveal branch and creating O. The transaction-level negative test is appropriate; a statement-only mutation test would not detect this class.

## Remaining MUST-FIX — O availability window must be welded to the *other principal* refund window

The construction now guarantees roughly:

`first mover receives reactive principal -> same tx creates genuine O`

but it still does **not normatively guarantee**:

`genuine O exists -> reactive party has an unstealable principal UTXO available for >= N_claim + N_margin`

There are two different principal LOCKED objects in §2.5:

- reactive party principal `LOCKED'`, consumed by the first mover's reveal/transfer transaction; and
- first-mover principal `LOCKED`, which the reactive party is supposed to receive using O, or which the first mover can eventually terminal-refund.

The current v0.3 freezes `T_O` relative to O creation, and freezes the ordering between the reveal-side transfer cutoff and **C** terminal refund. I do not see a corresponding load-bearing inequality/state transition tying **first-mover-principal LOCKED's terminal-refund eligibility** to O creation.

Adversarial trace if that coupling is absent:

1. both principals are locked; C is live;
2. first mover waits until the latest legal reveal/transfer point;
3. one atomic tx consumes `LOCKED' + C`, pays first mover and creates genuine O — all current v0.3 welds pass;
4. first-mover-principal `LOCKED` is already refund-eligible, or becomes refund-eligible before `O_creation_daa + N_claim + N_margin`;
5. first mover spends/refunds its own `LOCKED` before the reactive party can land the O-gated principal claim;
6. result: first mover has already received counterparty principal **and** recovers own principal. O is genuine but economically useless because the principal it was meant to authorize has disappeared.

This is the same principal-theft property we have been trying to exclude; `T_O` alone does not protect it. O's lifetime and the protected principal's lifetime must be coupled.

### Required design invariant

Freeze one mechanically enforceable form. Two acceptable shapes:

**A. Static cutoff inequality (minimal):** if the principal LOCKED uses an absolute DAA refund cutoff, define a protocol latest reveal bound and require, before either leg locks,

`T_refund_firstMoverPrincipal >= T_latest_reveal + N_claim + N_margin`

all in the same DAA domain, with a configuration negative proving that violating the inequality makes the construction non-conforming. `T_latest_reveal` must itself be an enforceable chain bound, not a host estimate.

**B. Stronger state transition:** the transaction that creates O also atomically transitions the first-mover principal from `LOCKED` to an `O_AUTHORIZED` successor whose refund/recovery rule is anchored to the same O-creation DAA / session capability. This avoids relying on a precomputed worst-case absolute window, but requires a real transaction/state weld.

Either way the invariant to prove is:

`O_created_at d  => protected_principal cannot return to first mover before d + N_claim + N_margin`

and, once the counterparty principal has been paid to the first mover, the protected principal cannot disappear through an earlier independent refund path.

## Clarify the reactive claim transaction topology

§4(c) currently lists `checkSigFromStack(A)`, `H(s)==h`, and `OpInputCovenantId(O_in_idx)==cid`, while §2.5 says “reactive party spends O to receive LOCKED”. The normative construction should explicitly say whether §4(c) is a **branch of the principal LOCKED covenant** with O as a co-input. If yes, freeze that topology and weld the payout recipient/value/state in the same transaction. If §4(c) is merely an O-spend branch, then another two-transaction seam remains: O could be consumed independently of the principal.

Add a transaction-level negative:

- submit an O-spend without the exact protected-principal LOCKED input (or without its exact baked payout) -> **REJECT**;
- submit principal spend without the genuine O input -> **REJECT**.

This is not a new mechanism request; it makes the §2.5 prose topology mechanically unambiguous.

## Status

- cov_id-lineage provenance: **GREEN / pre-code proof gate remains**;
- A-absent removal: **PASS**;
- unique successor: **PASS AS DESIGN / mutation E2E pending**;
- relative O timeout: **PASS AS DESIGN / constants pending**;
- LOCKED' + C same-tx reveal weld: **PASS AS DESIGN**;
- **O-lifetime ↔ protected-principal-refund lifetime coupling: OPEN / MUST-FIX**;
- reactive O + protected-principal same-tx topology/output weld: **MUST-SPECIFY + transaction negative**;
- A2 `checkSigFromStack` full leg on canonical compiler/runtime: **OPEN hard pre-code gate**;
- durable consensus cov_id derivation evidence: **OPEN hard pre-code gate**;
- cross-chain finalized-reveal: **OPEN / out of this same-chain closure**;
- quorum independence: **HARD PRE-REAL-FUNDS DEPLOYMENT GATE** where committee authorization remains relevant.

No implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path authorization is granted by this review.
