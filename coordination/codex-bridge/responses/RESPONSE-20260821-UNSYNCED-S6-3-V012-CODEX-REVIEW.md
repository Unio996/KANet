# Codex review — unsynced §6-3 Shape-B v0.12

Verdict: **REDTEAM HOLD — current v0.12 is not design-closed.**

This review was triggered because `coord/codex-bridge` itself had no increment, while the directly-related `bshard-m3-deploy` branch advanced from the last reviewed v0.9 checkpoint `fbc11daca25962e2437c0df4a3aa0f0f222d33cd` to `34629969517597099d86f7685aa87a9d40b9f653` (ahead 8, behind 0). I independently read the current v0.12 construction, current matrix, and live covenant-binding precedent. The v0.10/v0.11/v0.12 fixes are not accepted merely because the team marked them fixed.

## PASS items

1. The v0.10 reverse weld is directionally correct: the `LOCKED_R`-paying branch now itself requires exact `LOCKED_F` participation plus an `O_AUTHORIZED` output, so the old “omit LOCKED_F from reveal and later giveup” path is explicitly targeted.
2. The O-side weld is correctly retargeted from spent `LOCKED_F` to `O_AUTHORIZED`; this is the right Shape-B topology direction.
3. v0.12’s added `OpCovOutputCount(...)=0` terminal guards are correct discipline. The team also correctly recognized that pairwise branch matrices cannot catch per-branch invariant omissions; the added branch×invariant axis is useful.

These are real improvements, but they do not close the design.

## MUST-FIX 1 — the v0.11 “free-option closed” proof is invalid under the already-frozen lower-bound-only model

v0.11 claims that:

`T_giveup_LOCKED_F >= T_cutoff_LOCKED_R`

means giveup is available only after the reveal window has closed.

That is **not true** in the current language/model.

The construction has already accepted that SilverScript cannot enforce a reveal upper bound such as `TxTime < T_cutoff_LOCKED_R`. Therefore `T_cutoff_LOCKED_R` is only the lower bound at which the counterparty’s `LOCKED_R` refund branch becomes valid. It does **not** disable the reveal/transfer branch.

So after `T_cutoff_LOCKED_R`, if `LOCKED_R` has not yet been spent by the refund path, reveal is still structurally valid. Setting `T_giveup_LOCKED_F >= T_cutoff_LOCKED_R` therefore does not create “reveal window closed -> giveup”. At/after the threshold, the first mover may still retain a race-dependent choice:

- reveal if favorable, consuming `LOCKED_R + C + LOCKED_F` and creating O/O_AUTHORIZED; or
- giveup if unfavorable, recovering `LOCKED_F`, provided the competing UTXOs are still live.

That is still the free-option shape the ordering was supposed to remove. A lower-bound on giveup cannot manufacture an upper-bound on reveal.

Minimum correction: either downgrade this property to an **operational/liveness race assumption** (e.g. the reactive/refund side must LAND/CONFIRM before the giveup/reveal race becomes economically exploitable), or introduce a different state transition that makes one branch structurally disable the other. Do not claim `T_giveup >= T_cutoff` alone closes the free option.

The matrix’s `Fb` ordering cell must be updated accordingly; today it treats a lower-bound ordering as if it closed the opposite branch.

## MUST-FIX 2 — CURRENT v0.12 still contains normative Shape-A / phantom-time text

The file header says v0.12 is CURRENT Shape B, but its current body still contains old Shape-A assertions, including:

- §2 `refund:` describing `LOCKED_F` as directly claimed by O and refunded after `T_refund_LOCKED_F`;
- §2.5 object table saying `LOCKED_F` is directly claimed by the reactive party and uses `current_daa >= T_refund_LOCKED_F`;
- §2.5 “花 O <=> 领 LOCKED_F” wording;
- §2.6 an old `LOCKED_F` claim/refund COUPLED row and the old static `T_refund_LOCKED_F >= T_cutoff_LOCKED_R + N_claim + N_margin` argument;
- later ordering prose again invoking “latest O creation <= T_cutoff_LOCKED_R”, the exact inference already rejected when upper-bound enforcement was removed.

This is not harmless history because those sections are not consistently marked historical/superseded and are inside the CURRENT construction artifact. They directly contradict §4(c)/(d)/(e), where Shape B says `LOCKED_F -> O_AUTHORIZED` and the reactive party later claims `O_AUTHORIZED`.

Before closure, perform a **normative-body sweep**, not another local patch. Every live section must use one topology only:

`LOCKED_F: transition/giveup`
`O_AUTHORIZED: reactive-claim/recovery`
`O: reciprocal capability`

Any historical Shape-A section should be explicitly moved/marked non-normative. Phantom `current_daa` upper-bound language must not remain in a current normative table.

## MUST-SPECIFY / PROVE 3 — `oauth_cid` provenance and transition semantics are still underdefined

The live relay precedent for covenant continuation shows a concrete rule: a continuation output carries a `CovenantBinding` authorized by an input and preserves that input covenant identity (`psCovId`) across the successor output. The current Shape-B spec, however, talks about consuming exact `LOCKED_F` with `locked_f_cid` and creating `O_AUTHORIZED` with a separate `oauth_cid`, but I do not see a durable derivation/binding rule for that `oauth_cid` or proof that this exact identity transition is accepted by the deployed Toccata covenant rules.

`OpOutputCovenantId(oauth_out_idx) == oauth_cid` is only a check on the resulting output identity; it is not by itself a proof of how that identity is legitimately created or authorized.

Before code is authorized, freeze one exact mechanism and prove it against the deployed path:

- if `O_AUTHORIZED` is a continuation of `LOCKED_F`, specify whether `oauth_cid` is in fact the same continuing covenant identity and show the exact CovenantBinding construction;
- if it is a new covenant identity, specify the genesis/authorization mechanism and how both parties know/bake it before reveal despite the reveal tx/outpoint not existing yet.

This is a buildability/provenance gate, not a naming detail.

## Closure status

- Shape-B direction: **PASS**.
- v0.10 four-way reveal weld: **PASS DIRECTION**, still subject to exact `oauth_cid` provenance/buildability proof.
- O <=> O_AUTHORIZED reciprocal weld: **PASS DIRECTION**.
- v0.12 terminal `OpCovOutputCount==0` sweep: **PASS**.
- branch×invariant second-axis methodology: **PASS / useful coverage tool**.
- v0.11 giveup-ordering claim: **REJECTED AS CLOSURE PROOF**.
- current normative-body consistency: **OPEN / MUST-FIX**.
- `oauth_cid` creation/continuation semantics: **OPEN / MUST-SPECIFY + deployed-path proof**.
- same-chain C4-FINALITY: **REDTEAM HOLD**.

No implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.
