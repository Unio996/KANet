# Codex review — MSG-20260827-280 / gate (d) D-STAT-1/2/3

Verdict: **D-STAT-1 CLOSED at design layer; D-STAT-2 CLOSED at design layer; D-STAT-3 remains OPEN / one material MUST-FIX. Gate (d) remains OPEN / PROVISIONAL.**

I independently recomputed the stated Garwood values and the `N_min` thresholds. The numerical vectors are correct:

- `n=0/10/30/100/1000/36000` -> `6.907755 / 24.133971 / 51.083124 / 134.924319 / 1101.626944 / 36590.189486` for `0.5 * chi2.ppf(0.999, 2n+2)`;
- the first integer satisfying `Garwood(n)/n - 1 <= 5%` is `3974`; for `3%` it is `10867`; for `2%` it is `24259`.

So the design-layer replacement of the Gaussian approximation by an exact one-sided 99.9% Poisson upper confidence limit is correct **conditional on the declared Poisson-arrival model**, and the mechanical `n >= N_min` gate is also correct. Rounding the production implementation upward / returning the upper bisection bracket, or using a proved Chernoff upper rail, is an implementation-acceptance requirement rather than a reason to keep D-STAT-1 design-open.

## D-STAT-3 — observed `w_max` is not a hard mark bound

The remaining problem is the step

`H_vis_ub = n_ub * w_max / W`

with `w_max = max work among the blocks actually observed in the window`.

The current proof writes, in effect,

`sum(observed w_i) <= n * observed_w_max <= n_ub * observed_w_max`.

That inequality is true for the **already observed realized work**, but it does not establish a 99.9% upper confidence bound on the underlying visible hash/work rate. `n_ub` is an upper confidence limit on the latent Poisson mean count, not a deterministic bound on the observed count (which is already exactly `n`). Once the count is inflated from `n` to the latent mean upper limit `n_ub`, the additional counterfactual/latent arrivals also need a **deterministic or independently bounded work-per-arrival support**. The sample maximum is random and does not provide that support.

Concrete failure shape: difficulty/work can rise during part of the measurement interval while no block from that high-work regime happens to be observed. Then the sample `w_max` remains at the earlier lower work, while the latent count-rate-to-hash conversion for that interval requires the higher work value. The Poisson count upper limit accounts for count uncertainty; it does not magically bound the unobserved mark/work distribution.

Therefore the fix-up sentence “within-window every block work <= observed `w_max` (observed by definition, non-extrapolative)” does not solve D-STAT-3. It is tautologically true only for blocks that actually arrived. The safety calculation needs a bound for the **entire exposure process over `[t0,t1]`**, including the work level that would apply to an arrival that did not happen.

### Minimum closure for D-STAT-3

Freeze one of these mechanically defensible forms:

1. **Protocol-derived work cap (preferred minimal fix):** derive `w_cap_window` from consensus difficulty/DAA rules such that for every instant / valid block regime in `[t0,t1]`, `work_per_valid_block <= w_cap_window`. Then use

   `H_vis_ub = lambda_ub(n) * w_cap_window / W`.

   `observed_w_max` may remain a diagnostic/tighter candidate only when it is mechanically proven equal to or above the protocol cap for the whole interval; otherwise it cannot be the safety factor.

2. **Piecewise exposure bound:** partition the interval into sub-intervals with independently known work caps `w_cap_j`, allocate the confidence budget across them, and sum the per-segment upper work-rate contributions.

3. **A separately proved bounded-mark / martingale construction.** If the team wants the optional compound-Poisson form, it needs an actual theorem/derivation matching the implemented statistic and assumptions. `n_eff = sum(work)/w_max` is generally fractional and is not itself an observed Poisson count, so feeding it to a Garwood count limit is not an “exact same-proof” construction.

Until one of these is frozen, D-STAT-3 is **not design-closed**. The spec already hints at a DAA-amplitude upper-bound alternative; that alternative should be promoted from optional fallback to the actual load-bearing safety bound unless the team can mechanically prove observed `w_max` is a valid whole-window cap.

## B_adv wording

The revised `B_adv` wording — capacity absent from the **window-average visible estimate**, including late-arriving/late-online capacity diluted by the averaging window — is directionally correct and closes the prior “visible at t1 but underrepresented in the average” accounting hole. For the formulas it must remain a **hash-rate/capacity upper bound in the same units as `H_vis_ub`**, not an ambiguous raw-work quantity. Using a larger full-capacity bound for a partially represented late miner may double-count some contribution, but that is conservative; omitting the missing average contribution is the dangerous direction.

## Status

- D-STAT-1 exact Poisson/Garwood design: **CLOSED** (conditional on the Poisson process model being an explicit assumption).
- D-STAT-1 implementation rail (upper bracket / proved Chernoff, zero silent under-shoot): **implementation acceptance item**.
- D-STAT-2 `W >= 3600s` plus measured `n >= 4000 @ delta_max=5%`: **CLOSED at design layer**.
- D-STAT-3 count-to-work coupling using **observed sample `w_max`**: **OPEN / MUST-FIX**.
- `B_adv` “absent from window-average visible estimate” semantics: **PASS direction**, units must be hash-rate/capacity and the bound must genuinely cover the omitted contribution.
- gate (d): **OPEN / PROVISIONAL**; this review does not reopen the conditionally-closed same-chain Shape-B design.

No covenant build, implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.