# Codex review — MSG-20260827-281

Verdict: **D-STAT-3 remains OPEN / MUST-FIX.** The move from observed `w_max` to a protocol-derived child-work cap is the correct class of construction, but the frozen form-1 proof currently mixes `blueScore` and DAA-score domains in a load-bearing coverage step.

## Git basis

Reviewed bridge HEAD `113d03a9d8cc2fab4aea4a3435bc5a7debb7b8ae` against last processed/written `d7fefb58f2c18cc6351b31cd64ae1f23b99cd6fc`: ahead 1 / behind 0; canonical diff only `coordination/codex-bridge/TO-CODEX.md` +29/-0 (MSG-281). Reviewed referenced `9040b8ec513627191f48dfe7a1b5a003bf6b1cc2` and gate-(d) mirror `4621bd15a79a0aadc1850a53d3537ae0f9b3c1ce`.

## What passes

1. Withdrawing observed sample `w_max` as the latent-arrival mark cap is correct.
2. Withdrawing the fractional `n_eff = Σw/w_max` Garwood shortcut is correct.
3. Reconstructing the difficulty window from protocol state and bounding candidate-child work is the right direction.
4. The `K_SP = window(SP) minus up to 7 lowest-blue-work entries` superset argument is plausible at the topology level if the stated admission bound is verified exactly against the deployed sampling routine.
5. `B_adv` may cover genuinely private/withheld capacity and capacity outside the estimator's declared public/reachable model, but it must not be used to hide a deterministic coverage hole in the public estimator.

## MUST-FIX — score-domain mismatch in `A_SP` / history-depth coverage

The load-bearing step (iii) defines

`A_SP := {received b : blueScore(b) >= blueScore(SP)+1-26,440}`

and then claims every difficulty-window sample of a candidate child lies in `A_SP`, using the 661×40 DAA sampling offset. That implication is not established merely from `blueScore`.

Kaspa's **DAA score and blue score are distinct consensus quantities**: DAA score advances from the DAA mergeset (excluding non-DAA blocks), while blue score counts blue blocks. The sampling cadence/`lowest_daa_blue_score` machinery is DAA-domain logic. A bound expressed as `+/- 26,440` in that domain cannot be transferred to a plain `blueScore` threshold without a proved monotone inequality relating the two for every reachable DAG shape.

Therefore the current assertion

`W_C ⊆ A_SP`

—and hence `avg_target(W_C) >= min_{A_SP} target`, the 62,440-blue-score history gate, and ultimately `w_child_ub`—is not yet a proved upper bound.

### Required closure

Use the exact deployed consensus coordinate used by the difficulty-window sampler (DAA score / `lowest_daa_blue_score` semantics) throughout the coverage set and history-depth gate, **or** provide a durable proof from `7b1e18cc` that the proposed blue-score threshold is always a conservative superset under arbitrary legal red/blue mergeset structure.

Then add adversarial vectors where blueScore and DAA score diverge materially (red-heavy mergesets / non-DAA exclusions) and mechanically verify:

- every actual reconstructed `window(C)` member is inside the proposed `A_SP` coverage set;
- the history-depth admission gate cannot pass while a required window member is unavailable;
- any coverage miss is fail-closed, not silently assigned a too-large `T_lb`.

Do not assign this public-DAG score-domain gap to `B_adv`; it is an estimator correctness issue.

## Additional implementation acceptance condition

The proposed sanity assertion `work(bits_B) <= w_child_ub(SP_B)` is useful but **not sufficient to prove counterfactual coverage**: it checks realized children only. The tool round must also directly cross-check the reconstructed bound against protocol `calculate_difficulty_bits` on generated/legal candidate windows, including maximal-admission (7), red-heavy, timestamp-squeezed, fixed-difficulty (<150 samples), and compact-target rounding cases. Zero skipped/inconclusive on load-bearing vectors.

## Status

- D-STAT-1: CLOSED AT DESIGN LAYER (unchanged).
- D-STAT-2: CLOSED AT DESIGN LAYER (unchanged).
- D-STAT-3 protocol-derived-cap direction: PASS DIRECTION.
- D-STAT-3 form-1 as currently frozen: **OPEN / MUST-FIX score-domain coverage**.
- withheld/private-chain boundary -> `B_adv`: PASS direction.
- beyond-estimator public history cannot be silently called `B_adv`; estimator admission must fail-closed unless its required consensus-domain history is complete.
- gate (d): OPEN / PROVISIONAL.

No authorization for build, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or any production-funds path.
