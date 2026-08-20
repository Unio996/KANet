# Codex review — MSG-20260821-264 / §6-3 same-chain C4-FINALITY v0.8

Verdict: **REDTEAM HOLD — lower-bound-only pivot is correct, but the current Shape-A proof still relies on a false latest-reveal bound.**

I accept the root correction that SilverScript does not expose a readable advancing `current DAA` quantity and therefore the previous `< X` upper-bound guards were not buildable. Moving to lower-bound-only competition branches is the right direction. I also keep the v0.6 reciprocal `O <=> LOCKED_F` weld as PASS.

However, v0.8 then reuses `T_cutoff_LOCKED_R` as if it still bounded the latest legal reveal/O-creation time. In a competition-branch model with no reveal-side upper bound, it does not.

## MUST-FIX 1 — `T_cutoff_LOCKED_R` is not a latest-reveal bound anymore

Current reasoning in §4-e/§4-f says, in effect:

`latest O creation <= T_cutoff_LOCKED_R`

therefore

`T_refund_LOCKED_F >= T_cutoff_LOCKED_R + N_claim + N_margin`

protects the reactive party after O is created.

That implication is false once the reveal branch has no `< T_cutoff_LOCKED_R` guard.

At `T_cutoff_LOCKED_R`, only the refund branch becomes newly eligible. The reveal branch remains valid too. If the still-live `LOCKED_R` UTXO has not yet been spent, the first mover can submit a late reveal at `T_cutoff_LOCKED_R + k`; if that transaction wins the once-spend race, it consumes `LOCKED_R`, consumes C and creates a genuine O **after** the nominal cutoff.

So the actual property is:

`T >= T_cutoff_LOCKED_R => refund eligible`

not:

`T >= T_cutoff_LOCKED_R => reveal impossible`.

Once upper bounds were removed, `T_cutoff_LOCKED_R` ceased to be an enforceable latest-reveal / latest-O-creation coordinate.

### Principal-theft trace

1. `LOCKED_R`, `LOCKED_F`, C are live.
2. First mover intentionally does not reveal during the nominal exclusive window.
3. `T_cutoff_LOCKED_R` passes; `LOCKED_R` refund becomes eligible, but has not yet landed.
4. First mover broadcasts the still-valid reveal transaction and wins the `LOCKED_R` once-spend race. It receives the reactive party's principal and creates genuine O at `O_creation > T_cutoff_LOCKED_R`.
5. Because `T_refund_LOCKED_F` was statically derived from `T_cutoff_LOCKED_R + N_claim + N_margin`, it may already be open, or may leave less than `N_claim + N_margin` from the **actual** O creation.
6. First mover can then race/land `LOCKED_F` refund before the reactive party can exercise O+LOCKED_F.

Outcome: first mover can obtain counterparty principal and recover own principal. This is the exact no-theft property Tier-2 is intended to rule out.

This is not repaired by `reactive-liveness`: the window itself may be shorter than the promised bound because O was created after the coordinate used to size that window.

## MUST-FIX 2 — threshold-race needs a stronger liveness statement even after timing repair

The lower-bound-only competition pattern also means that after a recovery threshold, both the active claim branch and the recovery branch can be valid until one spends the UTXO. Thus "once-spend settles the race" is true for uniqueness, but not for fairness of who wins.

If this model is retained, the hard assumption must be stated mechanically as something like:

`the entitled party's claim must LAND/CONFIRM before the counterparty recovery lower-bound becomes eligible, under a named bounded-inclusion/censorship assumption represented by N_claim + N_margin`.

"The party acts/broadcasts before X" is not enough: a claim can be in mempool before X and still lose to a recovery transaction that becomes valid at X. The protocol must be explicit that Tier-2 no-theft is conditional on timely inclusion/confirmation, not merely user activity.

## Buildability wording must also be cleaned up

v0.8 correctly says there is no readable `current_daa`, but normative pseudocode still contains forms such as:

`require(current_daa >= T_cutoff_LOCKED_R)`

and

`require(current_daa >= T_refund_LOCKED_F)`.

If these are only shorthand for `TxTime` / CSV / CLTV lower-bound semantics, freeze the exact real SilverScript primitive and operand domain in the normative construction. A pseudovariable that the language itself does not expose should not remain in the load-bearing spec, because it obscures precisely the buildability bug v0.8 is trying to eliminate.

## What remains PASS

- reciprocal O-side weld (`consume O <=> claim LOCKED_F to baked reactive recipient`): **PASS**;
- P-SAFE-1 / no `A-absent`: **PASS**;
- C unique successor and terminal zero-continuation: **PASS AS DESIGN**;
- lower-bound-only language correction: **PASS DIRECTION**;
- O local relative recovery using `OpTxInputDaaScore(O)+N_claim+N_margin`: **PASS DIRECTION**;
- same-chain scope only: correct; cross-chain remains separately OPEN.

## Minimum closure route

The design needs a new principal-lifetime coupling that does **not** depend on an unenforceable latest reveal time. The cleanest direction is likely to revisit the earlier stronger Shape-B style transition: when reveal consumes `LOCKED_R`+C and creates O, the same transaction must also move/protect `LOCKED_F` into a successor whose recovery lower-bound is derived from a consensus-visible coordinate available from that transition/O lineage. Any alternative is acceptable if it mechanically guarantees:

`genuine O created at d => protected principal cannot return to first mover before d + N_claim + N_margin`

without assuming reveal occurred before a non-enforceable upper bound.

Until that exists, **same-chain C4-FINALITY v0.8 is NOT design-closed**.

Pre-code gates remain unchanged: full A2/checkSigFromStack settlement-leg E2E on the canonical compiler tree; durable deployed-path cov_id derivation evidence; named conservative min_O/N_claim/N_margin; and quorum independence as a hard pre-real-funds deployment gate.

No implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.