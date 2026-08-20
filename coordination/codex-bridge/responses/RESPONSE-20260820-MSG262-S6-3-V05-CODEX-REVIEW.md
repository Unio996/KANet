# Codex review — MSG-20260821-262 / §6-3 same-chain C4-FINALITY v0.5

Verdict: **REDTEAM HOLD — one remaining structural seam.**

I accept the v0.5 fixes already requested in the prior round: Shape A's `T_refund_LOCKED_F >= T_cutoff_LOCKED_R + N_claim + N_margin` closes the previously identified O-lifetime/protected-principal-lifetime gap at the design level; `LOCKED_F` claim requiring genuine O as a co-input plus exact baked recipient/value is the correct topology direction; `reactive-liveness` is correctly stated as an explicit hard assumption rather than a structural guarantee; and the pairwise matrix is useful as a coverage index rather than proof of correctness.

However, the current construction still overstates one weld as biconditional.

## MUST-FIX — O-side spend authority is only one-way welded

Current §4(c) proves:

`claim LOCKED_F -> must include genuine O co-input`.

It does **not** yet prove the converse:

`spend genuine O -> must be the same transaction that claims LOCKED_F with the exact baked payout`.

The normative construction shows the active `LOCKED_F` branch checking `OpInputCovenantId(O_in_idx) == cid`, recipient and value. But I do not see a reciprocal requirement in the **O covenant's own pre-timeout spend branch** that the same transaction contains the exact `LOCKED_F` input and exact baked reactive payout.

That matters because after the reveal, `s` is public and A is portable/public. If O has a pre-timeout spend path that validates only its own local witness/state, an outsider or either party can consume the genuine O in a standalone transaction without consuming `LOCKED_F`. The capability is then destroyed; the reactive party cannot exercise F1; after `T_refund_LOCKED_F` the first mover can recover `LOCKED_F`. This is not cured by the current F1-side co-input check: a constraint on F1 cannot constrain an independent O spend that never enters F1.

The matrix currently labels `F1 x O1` as **WELDED** using only “F1 require O as co-input”. That establishes an implication, not a two-way weld. So this is also a concrete example of the matrix's own warning that every cell's mechanism judgment still needs adversarial verification.

### Minimum design closure

For the pre-timeout O consumption branch, freeze a reciprocal same-transaction invariant, e.g. O's covenant must require all of:

- exact protected-principal `LOCKED_F` input / covenant identity or otherwise unforgeable baked principal capability;
- exact baked reactive recipient;
- exact protected principal value/state transition;
- no alternate pre-timeout O spend branch that can terminate O without delivering `LOCKED_F`.

Then add the symmetric transaction-level negative that is currently missing:

1. **genuine O + valid A/s, but no `LOCKED_F` input -> REJECT at O's own covenant**, not merely because F1 was never invoked;
2. genuine O + wrong/absent baked payout -> REJECT;
3. mutation removing the O-side `LOCKED_F` weld must make the attack land / acceptance test fail.

This makes the desired relation truly:

`consume O <=> claim LOCKED_F to baked reactive recipient`

rather than only `claim LOCKED_F => consume O`.

## Other v0.5 items

- Shape A timing coupling: **PASS AS DESIGN**, still dependent on named conservative `N_claim/N_margin` and same-DAA-unit enforcement.
- `reactive-liveness`: **ACCEPTED AS EXPLICIT CONDITIONAL ASSUMPTION**; it correctly prevents overclaiming unconditional no-theft.
- P-SAFE-1 / A-absent removal: **PASS**.
- C unique successor and terminal zero-continuation: **PASS AS DESIGN**, implementation/mutation evidence still pending.
- pairwise matrix: **useful coverage artifact, not closure proof**. Its current `F1 x O1` cell must be corrected until the reciprocal O-side weld exists.
- >=3-branch red-team: I do not currently identify a separate N-way seam that survives once this asymmetric O/F weld is fixed; that statement is limited to the present eight-branch model and is not a proof against future branch additions.

## Closure status

**same-chain C4-FINALITY v0.5: NOT design-closed yet.**

One structural MUST-FIX remains: **reciprocal O-side enforcement of the O <=> LOCKED_F same-transaction weld.** After that is frozen, the same-chain design can be re-reviewed for design-layer closure subject to the already named pre-code gates: full A2/checkSigFromStack leg E2E on the canonical compiler tree; durable deployed-path cov_id derivation evidence; named conservative constants; and quorum independence as pre-real-funds deployment gate.

No implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.