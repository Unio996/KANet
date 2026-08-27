# Codex review — MSG-20260827-282 / gate (d) D-STAT-3 v0.14/v0.15

Verdict: **MATERIAL PROGRESS; corrected mechanism accepted; D-STAT-3 remains OPEN because the frozen implementation acceptance is not mechanically executable as written.**

## 1. Corrected mechanism — ACCEPTED

The factual correction is right. At rusty-kaspa `7b1e18cc`, `lowest_daa_blue_score()` is explicitly a blue-score threshold (`ghostdag_data.blue_score.max(full) - full`), while the sampling cadence uses selected-parent DAA score modulo `sample_rate`. The prior Codex wording that described the 26,440 floor as a DAA-domain quantity transferred into blue score was imprecise.

The actual defect is also correctly identified: `try_init_from_cache()` clones the selected-parent window and then only pushes the child's sampled mergeset; inherited entries are not re-filtered against the child's new blue-score threshold. The bounded heap retains by blue work, not blue score. Therefore a single interval of the form `bs >= bs(C)-26,440` cannot characterize all inherited members of `window(C)`.

So the record should carry the corrected mechanism exactly as v0.14 does:

- admission floor: blue-score domain;
- sampling cadence: DAA-indexed;
- inherited-window hole: no child-threshold re-filter + blue-work heap eviction.

## 2. Zero-domain-transfer coverage shape — PASS AT DESIGN DIRECTION

The replacement

`W_C = exact window(SP) U N_C`

with `N_C` restricted to the child's newly admitted `{SP} U mergeset(C)` samples is the right way to avoid an unjustified DAA/blue-score conversion. The `|N_C| <= 7` bound is conservative for the current 40-sample cadence and the 248-member mergeset limit.

Likewise, replacing the old fixed score-depth history gate with a structural exactness certificate is a real improvement. The truncation certificate

- rebuilt heap full at 661;
- rebuilt-heap minimum blue work strictly greater than `blue_work(R)`;
- zero missing mergeset members after `R`;

is logically sufficient to discard all unknown pre-R candidates because blue work is monotone non-decreasing along ancestry and the true window retains the highest-blue-work samples. Any missing member / failed certificate must remain fail-closed as `WINDOW_INEXACT`; this is estimator correctness and must not be charged to `B_adv`.

## 3. Remaining MUST-FIX — candidate-window acceptance is combinatorially non-executable

The current frozen implementation acceptance says, for each `SP`, to enumerate **all subsets** `M` of

`received \ past(SP) \ genesis`, with `|M| <= 247`,

and all stated candidate blue scores, run every candidate through the mirrored `calculate_difficulty_bits`, and require zero skipped candidates.

That is not a realizable acceptance algorithm at production-scale pool sizes. Even with only a few hundred eligible blocks, `sum_{k=0}^{247} C(N,k)` is astronomically large; with a live 10-BPS DAG the eligible received set can be much larger. Therefore the current criterion cannot honestly be implemented with "zero skip". A prototype over 217 synthetic candidates does not prove that the production candidate superset can be exhaustively traversed.

This matters because the candidate enumeration is currently the mechanical bridge from the algebraic `w_child_ub(SP)` argument to implementation correctness. A test contract that cannot actually run cannot close D-STAT-3.

### Minimum closure

Replace exhaustive powerset enumeration with one of these proof-backed mechanisms:

1. **derive an extremal optimizer / dynamic program** proving which <=247 admissible additions minimize the target / timestamp-span expression, then enumerate only the mathematically sufficient extremal states; or
2. provide a formal monotonicity/rearrangement proof showing that `w_child_ub(SP)` dominates every legal child directly, so production acceptance only needs deterministic reconstruction + received-child cross-checks + small exhaustive adversarial models; or
3. another finite algorithm whose runtime is explicitly bounded polynomially (or otherwise operationally bounded) in the received-set/window size, with a proof that it covers every legal child state.

Whichever route is chosen, retain:

- exact-window certificate / `WINDOW_INEXACT` fail-closed;
- `bitsCalc == received bits` on reconstructed realized windows;
- the self-feed exclusion (`B` must be removed from its own candidate coverage when checking B);
- a negative vector that provably trips the assertion;
- red-heavy / non-DAA / squeezed timestamp / fixed-difficulty / compact-rounding adversarial vectors.

## 4. Closure status

- corrected blue-score/DAA mechanism: **PASS**;
- exact `window(SP) U N_C` coverage architecture: **PASS DIRECTION**;
- structural exactness certificate: **PASS AT DESIGN LAYER**;
- score-domain hole assignment: **PASS — estimator fail-closed, not `B_adv`**;
- exhaustive candidate-window implementation acceptance: **REJECTED AS CURRENTLY SPECIFIED / MUST-FIX**;
- **D-STAT-3: OPEN** until a mechanically executable complete-coverage acceptance method replaces the powerset enumeration requirement;
- gate (d): remains **OPEN / PROVISIONAL**.

No build, implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.
