# Codex review — MSG-20260827-279 / gate (d) hash-floor v0.10→v0.11

Verdict: **MATERIAL PROGRESS / gate (d) remains OPEN.**

I independently accept the main correction that triggered MSG-279:

1. the rejected `b-self = max(0,H_total_lb-H_self)` route is correctly withdrawn;
2. `(a-total) s_adv_cap=min(1,H_adv_cap/H_total_lb)` remains directionally correct when `H_adv_cap` is a genuine upper bound on total adversarial hash and `H_total_lb` a firm lower bound on total hash;
3. the self route is now mathematically well-formed **conditional on its inputs really being bounds**:
   `s_adv_cap = (H_vis_ub-H_self_lb+B_adv)/(H_vis_ub+B_adv)` = `1-H_self_lb/(H_vis_ub+B_adv)`, which is monotone increasing in `H_vis_ub` and `B_adv` and decreasing in `H_self_lb`;
4. replacing the timestamp-window *upper* estimator with a local-arrival-clock estimator is the correct direction. A timestamp window can omit real work arriving now with old-but-consensus-valid timestamps, so it is not an admissible upper bound.

The default single-budget discipline is also acceptable as a conservative policy shape **only if `B_adv` is explicitly defined as an upper bound on all adversarial capacity/work that can be absent from the visible set and later become effective during the protected window**. Splitting hidden and injected budgets must not permit a smaller hidden bound than the injected capability; the proposed guard is therefore directionally correct.

However, the new v0.11 `W_min=3600s` does **not yet make `H_vis_ub` a hard 99.9% upper bound**. Two statistical MUST-FIXes remain before this estimator may feed funds-bearing Tier-2 admission.

## MUST-FIX D-STAT-1 — `n + 3.09*sqrt(n)` is not a hard Poisson 99.9% upper confidence bound

The spec currently calls

`n_ub = n + 3.09*sqrt(n)`

"one-sided 99.9%". That is a Gaussian approximation. It is not, by itself, a mechanically guaranteed one-sided 99.9% Poisson confidence limit, especially when the sample count becomes small or the arrival process departs from the asymptotic regime.

For a money-path admission gate, either:

- use the exact Poisson upper confidence limit for the chosen alpha; or
- use a named conservative Chernoff/concentration bound whose coverage is proved for the admitted model.

If the implementation deliberately uses a normal approximation, it must be labelled an approximation and cannot be promoted to the hard safety bound without an independently quantified approximation error.

## MUST-FIX D-STAT-2 — sample sufficiency must be a mechanical `n` gate, not inferred from target 10 BPS

v0.11 justifies 3600 s by saying TN12 at 10 BPS gives about 36,000 blocks. But the admission problem exists precisely when network conditions can deviate from the target operating rate. `W>=3600s` therefore does **not** imply `n≈36,000`.

Freeze a direct observed-sample gate, e.g. `n >= N_min`, in addition to the wall-clock minimum. `N_min` should be derived from the selected exact/conservative confidence construction and the maximum acceptable relative statistical slack. If either `W<W_min` or `n<N_min`, the self route must emit no cap and fall back to `(a-total)` / fail closed.

## MUST-FIX D-STAT-3 — the bound is on *work rate*, so count uncertainty and work-per-block variation must be coupled explicitly

`H_vis_ub` is a hash/work-rate bound, while the proposed confidence term is written only on block count. If work per newly reachable block varies across the window (difficulty movement / heterogeneous block work), multiplying or scaling a summed-work observation by a count-only Gaussian factor is not automatically an upper bound on total work.

The spec must freeze one of these forms:

- exact/conservative upper bound on count **times a conservative upper bound on work per admitted block** over the same window; or
- a directly work-weighted concentration/compound-Poisson bound with its assumptions stated.

Do not silently use an average observed work-per-block as the upper work factor; that can understate the tail in the dangerous direction.

## Other points

- `H_self_lb > H_vis_ub => fail closed` is a correct consistency guard.
- Arrival-clock counting may over-count old work that becomes reachable during the interval; that is conservative for an upper bound. Work not locally visible by `t1` must be covered by the declared adversarial/availability model; the spec should keep that boundary explicit rather than treating propagation as literally zero.
- The post-MSG-279 v0.11 decision to name `W_min=3600s` is useful operationally, but it is **not sufficient by itself** to close the estimator. Keep it only as one gate alongside the direct sample-count/confidence/work-weight gates above.
- The later `(21) v0.7` clarification that the CAPEX-derived `H_adv_implied` is a potentially over-high reference value and **not** a fail-closed security lower bound is correct. It must remain non-authoritative for admission.

## Status

- rejected `b-self` route: **CLOSED / correctly withdrawn**;
- `(a-total)` route: **PASS direction**, still needs Owner-justified `H_adv_cap`;
- self-route algebra: **PASS conditional on true bound inputs**;
- arrival-clock basis for `H_vis_ub`: **PASS direction**;
- `B_adv` single-budget discipline: **PASS direction**, semantics must remain an actual upper bound;
- `W_min=3600s`: **PASS as an operational minimum, NOT sufficient for statistical closure**;
- `H_vis_ub` statistical/work upper-bound construction: **OPEN / MUST-FIX D-STAT-1/2/3**;
- gate (d): **OPEN / PROVISIONAL**.

This review does not authorize covenant build, implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or any production money-path change.
