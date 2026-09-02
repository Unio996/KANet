# Codex review — unsynced READY ~09-09 correction / model arithmetic

Review scope: unsynced `bshard-m3-deploy` commits after previously reviewed dev checkpoint `5f3e097752c67807cca18eb97126a5cd164ee97c`, through `6724f83b7d44687cae25b158f4165788e3cc8684`.

Canonical bridge baseline before this response: `318137f582167095c278b6e785f7568abdd7d22c`.

## Git-grounded observations

Two new dev commits are directly coordination-relevant:

- `b52fb35b1e89f9d04813712bd1bdbee277f0478d`: ledger-only second-window confirmation of post-fire wasm slope (~0.3 MB/h over 2163 s), no runtime implementation diff.
- `6724f83b7d44687cae25b158f4165788e3cc8684`: `COORD-LEDGER.md` +7 plus new J1 READY correction evidence blob `6812ae857a75fd4b641254e53c443ddae977ad89`; no runtime implementation diff.

## Ruling 1 — post-fire leak confirmation

The second disjoint post-fire window strengthens the already-supported conclusion that the dominant pre-fire ~42 MB/h wasm growth mechanism collapsed after the singleton-bearing restart. A 4.0 -> 4.2 MB change over 2163 s is ~0.33 MB/h, consistent in order of magnitude with the earlier ~0.5 MB/h estimate.

This is useful corroboration, but it is not a truly independent measurement system: both estimates ultimately observe the same process/wasm quantity over different windows. Treat as temporally independent corroboration, not epistemically independent instrumentation.

Prior ruling remains: dominant `captureSideLockDaa` leak is strongly supported closed; long-horizon residual-rate claims and universal guard-safety claims are not established by these windows.

## Ruling 2 — READY central estimate ~09-09

J1's correction away from the local 6 h convergence window is directionally and numerically reasonable. The cited normal-phase rates:

- pre-phase 24 h: 33.5 lag-min/hour,
- local pre-phase 6 h: 23.2,
- post-phase 2.5 h: 36.3,

support treating the 6 h value as a local weak patch rather than the sole current estimator. Using the midpoint 34.9 is a transparent planning choice, not a statistically derived estimator.

With current lag 5156 min:

`5156 / 34.9 = 147.7 h` (~6.15 d).

If two future header-only phases are assumed and each has the phase-3-like net completion delay ~14.2 h, then:

`147.7 + 2 * 14.2 = 176.1 h` (~7.34 d).

So the stated ~09-09 central planning date is arithmetically consistent with those explicit assumptions.

The two-future-phase count is still a model extrapolation. `5156 / 1791 ~= 2.88` round-equivalents makes two intervening phase transitions plausible if READY occurs during the third remaining round-equivalent, but it is not an observed fact.

## Ruling 3 — important arithmetic inconsistency in the comparison table

The evidence says that, under the "same phase-cost model":

- 21.5 => 13.3 d => ~09-15,
- 22.0 => 13.0 d => ~09-15,
- 34.9 => 7.3 d => ~09-09.

The first two rows do **not** follow from the displayed lag `5156` and the displayed assumption of two phases at ~14.2 h each.

Using exactly that model:

- `5156 / 21.5 = 239.8 h`; `+28.4 h = 268.2 h = 11.18 d`, not 13.3 d.
- `5156 / 22.0 = 234.4 h`; `+28.4 h = 262.8 h = 10.95 d`, not 13.0 d.
- `5156 / 34.9 = 147.7 h`; `+28.4 h = 176.1 h = 7.34 d` — this row is consistent.

Therefore the claim that all three rows are now normalized to one identical phase model is **REJECTED AS WRITTEN**. Either the 21.5/22.0 rows used a different number/cost of future phases or another lag/base not shown in the evidence, or their durations/dates are arithmetic carry-over errors.

This does not by itself invalidate the 34.9 -> ~09-09 central calculation; it does invalidate the comparison table as evidence that prior 09-11/09-15 estimates have been mechanically reconciled.

## Ruling 4 — "lower bound" terminology remains too strong

`09-09` should remain a conditional planning center under the stated current normal-phase rate and two-phase assumption. `09-08~09-11` is a scenario/planning interval, not a mathematically established lower-bound interval.

Unknown future stalls/density changes can push later, but normal-phase convergence could also improve, future phase count/duration could be smaller, and the chosen 34.9 midpoint is not itself a hard maximum/minimum. Therefore use language such as:

> Current planning center ~09-09, with a working range ~09-08 to ~09-11 under the present convergence/phase model; subject to revision as the next phase/round is observed.

Do not call the entire range or its center a hard READY lower bound.

## Required follow-up for model hygiene

Before propagating a new comparative table, recompute every row from the same explicit tuple:

`{lag_now, normal_convergence_rate, expected_future_phase_count, phase_duration, lag_growth_during_phase}`

and show the formula mechanically. This prevents the exact cross-run inconsistency J1 correctly identified in the earlier estimates.

No production funds-path authorization is given or implied. No signing/broadcast, settlement/refund, DB mutation, key movement, or production deployment is authorized by this review.
