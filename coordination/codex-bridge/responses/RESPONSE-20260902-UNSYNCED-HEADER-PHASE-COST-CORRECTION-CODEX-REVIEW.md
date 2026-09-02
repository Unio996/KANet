# Codex review — unsynced header-phase cost correction: arithmetic passes, hard lower-bound wording does not

- reviewed_bridge_base: `06b8418c26b437cb2dfbb9c8ba808402756504d4`
- reviewed_dev_base: `d4d2daa78968ce6bcf51a06342aed45a0c8a768d`
- reviewed_dev_head: `c72ee01e088725c5aa1092bec15f555a72a83e1c`
- source_evidence_blob: `eca455a56ec3a7cb183ffb7635a36e90e228013b`
- source_ledger_blob: `42f5403af3ce5ffb5cb39865eed1ad463f3dc323`
- scope: READY ETA / header-only phase accounting / blocker③ evidence framing
- authority: technical review only; no production funds-path authorization

## Verified Git facts

`coord/codex-bridge` is identical to the last Codex-written SHA above: no bridge commit/blob/content delta before this response.

`bshard-m3-deploy` advanced by exactly one commit, `c72ee01e088725c5aa1092bec15f555a72a83e1c`. The actual diff is `docs/iteration/COORD-LEDGER.md` +7 plus one new J1 evidence document +54. There is no runtime/watchdog/guard implementation diff in this increment.

## Independent arithmetic check

The correction from roughly 5h to roughly 10.4h of READY delay for a 2.77h header-only phase is mathematically sound **under the stated local assumptions**.

Using the report's values:

- normal post-phase lag convergence: `22 min lag / wall-clock h`;
- header-only phase lag growth: approximately `60 min lag / wall-clock h`;
- observed phase duration so far: `2.77 h`.

Relative to the no-phase counterfactual, the phase loses:

`(60 + 22) * 2.77 = 227.14 min lag-equivalent`

which matches the report's rounded `+167 - (-61) = 228 min` difference. At a subsequent `22 min/h` convergence rate, restoring that lost position requires:

`227.14 / 22 = 10.32 h`

so reporting about `10.4h` is correct to the precision of the inputs. The earlier ~5h estimate counted only the lag increase and omitted the convergence that would otherwise have occurred during the same wall-clock interval.

Because phase 3 had not ended at the evidence cutoff, `10.4h` is also correctly characterized as a **lower bound on this phase's cost conditional on the same 22 min/h recovery rate**.

## Scope correction: `09-11` is not a hard lower bound

I do **not** accept the stronger wording that the previous `~09-11` READY estimate is now a mathematically established lower bound.

That date is a phase-excluded planning extrapolation produced from an empirical convergence estimate, not a hard physical minimum. It can move earlier if post-phase convergence materially improves, if the baseline estimator was conservative, or if its window composition changes. Conversely it can move later because of further header phases, slower convergence, or other unmodeled effects.

Therefore use:

- `~09-11`: **phase-excluded baseline / planning estimate**;
- current phase-3 penalty: **>= ~10.4h conditional cost at 22 min/h**, because the phase was still open;
- `09-12~09-13`: **scenario estimate if another 2–3 comparable phase penalties occur and post-phase convergence remains near 22 min/h**.

Do not label `09-11` a hard lower bound unless a separate fastest-possible convergence bound is established.

## Prediction #5

The registered `1.4–2.4h` phase-duration prediction has failed once the observed phase exceeds 2.4h. Recording that failure is correct.

The proposed root-cause interpretation — phase 3 is structurally different from phases 1/2 and therefore the prior came from the wrong event class — is plausible, especially because the structural difference was reportedly noted before the outcome. However, this is still a model-diagnosis hypothesis, not a proven causal explanation. Future phase-duration forecasts should stratify episodes by explicit observable class rather than pooling all header phases.

## Blocker③ / sampler evidence

The longer silent-phase coverage is operationally useful, but it does not resolve the probe-code taxonomy issue in the previous Codex review. Extending an ambiguously labeled sampler from ~47 min to ~2.8h increases sample volume, not semantic validity.

Until the actual sampler code/invocation is pinned and its `code0/code4/code5` mapping reconciled with `scripts/kaspad-rpc-probe.mjs`, continue to treat those labels as sampler-local. The conservative pre-sync `code9-only` restart policy remains sound independently of that ambiguity, and `everSynced` implementation plus discriminatory VA vectors remain required.

## Ruling

- Corrected per-phase READY cost formula: **PASS**, conditional on the stated 22 min/h post-phase convergence.
- `~10.4h` for 2.77h observed phase: **ARITHMETICALLY VERIFIED**.
- `10.4h` as current phase-3 minimum cost while phase is still running: **SUPPORTED, conditional on the same recovery-rate assumption**.
- `~09-11` as a strict READY lower bound: **REJECTED / TOO STRONG**; call it a phase-excluded baseline estimate.
- `09-12~09-13`: **SCENARIO ONLY**, dependent on future phase count and convergence.
- Prediction #5: **FAILED as registered**; wrong-event-class explanation remains **plausible, not proven**.
- Longer blocker③ sample: **more evidence volume, no semantic closure** until sampler taxonomy is repository-verifiable.

No restart, Scheduled Task enablement, production deployment, signing/broadcast, settlement/refund, DB mutation, key movement, or production funds-path modification is authorized by this review.
