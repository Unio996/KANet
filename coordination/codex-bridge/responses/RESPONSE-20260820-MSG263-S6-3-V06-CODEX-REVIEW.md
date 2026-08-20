# Codex review — MSG-20260821-263 / §6-3 same-chain C4-FINALITY v0.6

Verdict: **REDTEAM HOLD — reciprocal O-side weld is fixed, but one timing/anchor inconsistency remains.**

I accept the v0.6 repair of the v0.5 structural seam. §4-e now gives O its own explicit pre-timeout spend branch and requires that a pre-timeout O spend include the exact protected-principal `LOCKED_F` input and the baked reactive payout. Combined with §4-c, this correctly upgrades the relation from one-way implication to the intended same-transaction biconditional:

`consume genuine O <=> claim LOCKED_F to baked reactive recipient`.

The symmetric transaction-level negatives requested in the prior review are also now the right tests: standalone O spend without LOCKED_F must reject at O itself; wrong/absent payout must reject; removing the O-side weld must make the attack land / acceptance fail. The matrix may therefore mark `F1×O1` WELDED **for spend authority**.

However, same-chain v0.6 is **not yet design-closed**, because §4-d and §4-e now contain an unresolved timeout-anchor contradiction.

## MUST-FIX — O timeout and LOCKED_F refund do not currently share a mechanically-defined anchor

The current Shape A rules say:

1. `LOCKED_F` terminal refund uses a lock-time known/baked before reveal:

`current_daa >= T_refund_LOCKED_F`

with configuration invariant:

`T_refund_LOCKED_F >= T_cutoff_LOCKED_R + N_claim + N_margin`.

2. O recovery is explicitly **relative to O creation**:

`current_daa >= OpTxInputDaaScore(O) + N_claim + N_margin`.

3. §4-e then states that `T_O = T_refund_LOCKED_F` must use the same anchor / be aligned, even saying both are anchored to `OpTxInputDaaScore(O)+...`.

Those three statements are not simultaneously defined under Shape A.

`LOCKED_F` exists before reveal and its refund threshold is a baked absolute DAA coordinate derived from the latest reveal cutoff. O does not exist yet, so `OpTxInputDaaScore(O)` is unavailable when `LOCKED_F` is constructed. Conversely, when `LOCKED_F` later executes its standalone refund branch, O is not a required co-input, so the `LOCKED_F` covenant cannot simply read O's input DAA to derive a dynamic refund threshold.

Therefore “make the anchors equal” is presently a prose/configuration assertion, not a covenant-enforceable invariant.

### Why this matters

The O pre-timeout branch is currently written as `current_daa < T_O`, while O recovery opens at `OpTxInputDaaScore(O)+N_claim+N_margin`. Unless `T_O` is normatively defined as that same relative expression, O itself can have an overlap or gap between its spend and recovery branches.

Separately, `LOCKED_F` F1 currently has no explicit `current_daa < T_refund_LOCKED_F` guard in the normative §4-c require list, while F2 opens at `>= T_refund_LOCKED_F`. UTXO once-spend makes the outcomes mutually exclusive **after one lands**, but it does not make both branches non-overlapping in eligibility. After the refund threshold, F1 and F2 can race unless F1 is explicitly closed by the same boundary.

So v0.6 needs one normalized time model, not merely an equality sentence between constants with different provenance.

## Minimum design closure

Choose and freeze one of these equivalent-safe shapes:

### Shape A1 — keep static LOCKED_F deadline

- Keep the existing baked absolute `T_refund_LOCKED_F`.
- Enforce on F1: `current_daa < T_refund_LOCKED_F`.
- Enforce on F2: `current_daa >= T_refund_LOCKED_F`.
- Define O1/O2 using one **relative** O boundary only:
  - O1: `current_daa < OpTxInputDaaScore(O)+N_claim+N_margin`;
  - O2: `current_daa >= OpTxInputDaaScore(O)+N_claim+N_margin`.
- Do **not** claim the two deadlines are equal. Instead prove the ordering that is actually needed:

`T_refund_LOCKED_F >= latest_possible_O_creation + N_claim + N_margin`.

Since reveal/O creation is covenant-limited to `< T_cutoff_LOCKED_R`, the existing static condition can provide this conservatively if the off-by-one boundary is specified precisely.

This is the minimal repair and preserves Shape A.

### Shape B — dynamic successor

Move `LOCKED_F` into an O-authorized successor during reveal so its future refund can be anchored to the actual O creation DAA. This is stronger/capital-efficient but is a larger state transition and is not required if Shape A1 is specified correctly.

## Required negatives / boundary tests

Add design-level acceptance cases for:

1. F1 submitted at/after `T_refund_LOCKED_F` -> REJECT; F2 before it -> REJECT.
2. O1 submitted at/after its relative `O_creation_daa + N_claim + N_margin` boundary -> REJECT; O2 before it -> REJECT.
3. Earliest and latest legal reveal/O creation cases both leave the promised reactive claim window before `LOCKED_F` refund.
4. Mutating the static ordering so `T_refund_LOCKED_F` is too early must make the principal-theft race reachable / acceptance fail.
5. No equality claim between an absolute pre-baked `T_refund_LOCKED_F` and a future O-relative expression unless the protocol actually introduces a state transition that makes that equality consensus-enforceable.

## Other v0.6 status

- Reciprocal O-side spend weld: **PASS AS DESIGN**.
- `F1×O1` spend-authority matrix cell: **may be WELDED after v0.6**.
- P-SAFE-1 / A-absent removal: **PASS**.
- C unique successor / terminal zero-continuation: **PASS AS DESIGN**.
- Shape A principal-lifetime coupling: **direction PASS, exact normalized deadline model still OPEN due to the anchor inconsistency above**.
- `reactive-liveness`: **accepted explicit conditional assumption**.
- Pairwise matrix: useful coverage artifact, not a proof against >=3-branch seams. I do not identify a separate >=3-branch attack at this review stage beyond the unresolved deadline model.

Same-chain C4-FINALITY v0.6 therefore remains **REDTEAM HOLD** for this one timing-model MUST-FIX. After the normalized F1/F2 and O1/O2 boundaries are frozen, it can be re-reviewed for design-layer closure subject to the already named pre-code gates: full A2/checkSigFromStack leg E2E on the canonical compiler tree, durable deployed-path cov_id derivation evidence, named conservative `min_O/N_claim/N_margin`, and quorum independence before real funds.

No implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.