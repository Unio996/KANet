# Codex review — MSG-20260827-278 / gate (d)

Verdict: **MATERIAL PROGRESS, gate (d) remains OPEN.**

I independently re-read the current `bshard-m3-deploy` evidence through branch HEAD `803f63b41e84e3c8e4b4cd0eba40a5da897e038c`, including the consolidated gate-(d) v0.10 text, NWT hash-floor v0.8, and the durable claim-depth sampler. I accept the timestamp-parser repair and the split 132-second masking wording. However, there is one new load-bearing mathematical error in the proposed `b-self` adversarial-share form.

## PASS — claim-depth timestamp parser MUST-FIX is substantively repaired

The durable sampler now has a source-specific canonical timestamp policy and explicitly handles the real persisted formats: SQLite `CURRENT_TIMESTAMP` text as UTC, zoned ISO-8601, and integer epoch values under source-specific allowlists. `legAFrom` refuses non-finite or negative wall times and marks them non-final-eligible. This closes the deterministic production-shape defect identified in the prior review.

This is still not final gate-(d) evidence: the final T5 bound still needs true sender-bound claim submission timestamps from the actual claim harness and the required post-sync >=30-sample run. Historical/proxy observations remain evidence inputs, not a future hard bound.

## PASS — masking wording / source separation

The current three-part wording is acceptable:

1. pre-stamped/full-masking head start bounded by the protocol future-timestamp tolerance;
2. residual estimator influence decays over the declared wall-clock window;
3. threshold-detection delay is modeled separately (`132 + f*W + T_dwell`).

This is materially better than saying all masking influence ends at 132 seconds.

Likewise, separating the in-window adversarial **share cap** from the **additional injected hash** used for the DAA-pump multiplier is the right conceptual split. The incremental-pump relation `k_max <= 1 + H_adv_add / H_total_lb` is conservative when `H_total_lb` is a valid lower bound on total pre-injection hash: using the lower denominator overstates the possible multiplier.

## MUST-FIX — `b-self` uses a lower bound where an upper bound is required

Hash-floor v0.8 currently proposes:

`nonself_bound = max(0, H_total_lb - H_self)`

and then treats that quantity as an upper bound on already-present non-self/adversarial hash in

`s_adv_cap = (max(0, H_total_lb - H_self) + H_adv_add) / (H_total_lb + H_adv_add)`.

That direction is unsafe.

If `H_total_lb <= H_total_true`, then, for a known `H_self`,

`max(0, H_total_lb - H_self) <= max(0, H_total_true - H_self)`.

So `H_total_lb - H_self` is a **lower bound** (or floor) on non-self hash, not an upper bound. Using it in the adversarial numerator can understate the adversarial fraction and make the honest-hash floor too large.

Concrete counterexample:

- `H_total_lb = 100`
- `H_total_true = 200`
- `H_self = 20`
- `H_adv_add = 0`

Current `b-self` reports `s_adv_cap = 80/100 = 0.80`.

But if all non-self hash is adversarial, the true share is `180/200 = 0.90`.

Therefore `b-self` is **not** a valid general upper-bound source for `s_adv_cap`.

### Required repair

Keep the already-valid absolute-cap route:

`(a-total) s_adv_cap = min(1, H_adv_cap / H_total_lb)`

provided `H_adv_cap` is an independently justified **upper bound on total adversarial hash already present plus mobilizable within the protected window**, and `H_total_lb` is the accepted firm lower bound on total hash.

For a self-hash-based route, an upper bound on adversarial share needs additional upper-bound information, e.g. a credible `H_total_ub` / non-self upper bound. With exact or lower-bounded honest self hash `H_self_lb` and a credible total-hash upper bound, a form like

`s_adv_cap <= 1 - H_self_lb / H_total_ub`

can be conservative (subject to matching windows/semantics). With only `H_total_lb` and `H_self`, no nontrivial upper bound on the non-self fraction follows: the true total may be arbitrarily above the lower bound, pushing the non-self share toward 1. In that case this route must fail closed rather than manufacture a cap.

Accordingly:

- `(a-total)` = **PASS direction**;
- `b-self` as currently written = **REJECTED / MUST-FIX**;
- `H_adv_add -> k_max` = **PASS direction**, but it must not be conflated with an upper bound on already-present adversarial share.

## Residual gate-(d) status

The residual closure checklist remains broadly correct, but the share-cap line must be corrected before any honest-hash floor can become a deployment input. In addition, the already-recorded operational requirements remain open: true sender-bound >=30 claim-shape samples, post-sync observation/reorg evidence, named conservative constants/slack without double counting, and Owner-approved adversarial budget/cap assumptions.

The same-chain Shape-B design-spec remains conditionally closed; this review does not reopen it. Gate (d) remains **OPEN / PROVISIONAL**.

No covenant build, implementation, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.
