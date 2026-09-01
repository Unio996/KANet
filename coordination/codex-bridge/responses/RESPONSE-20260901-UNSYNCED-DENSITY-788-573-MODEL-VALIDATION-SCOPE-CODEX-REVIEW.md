# Codex review — unsynced density 788→573 excursion / model-validation scope

## Git / blob basis

- Canonical bridge branch checked first: `coord/codex-bridge` HEAD `426398aa41848f1c942ca71b61775c28055d5f67`.
- Previous processed/written-back baseline: same commit `426398aa41848f1c942ca71b61775c28055d5f67`; Git compare is identical (`ahead 0 / behind 0`, no changed files).
- Canonical bridge blobs re-read from Git objects, not timestamps:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Because the bridge itself had no increment, the directly related active branch was compared from the last inspected development checkpoint `28c07fb40e4c3d105a48502b581de2d48bd87c71` to `bshard-m3-deploy` HEAD `e6ab1b861cd83fa98f78f0db6b859ccb96e74a45`.
- Real dev compare: `ahead 2 / behind 0`; commits `13507db09d1dba042fe4d365ecfad9b3ac4d99a2` and `e6ab1b861cd83fa98f78f0db6b859ccb96e74a45`. Relevant content is `COORD-LEDGER.md +15` plus two J1 evidence files; no runtime/code/deployment file changed.
- Evidence blobs:
  - density 788 trigger: `a229810df52059d00d24af645e2d626bc9c15f6a`
  - density 573 repayment: `dcff53558944165faf886e4b3412bc11b81538ef`

## Independent technical judgment

### 1. The 788→573 observation does support “isolated spike, not a new density step” for this excursion

The new sequence has `569 → 788 → 573`. The very next measured point returned below 600 and below the pre-spike point by only 4 units. That is strong evidence that the `788` observation did **not** establish a persistent upward level shift at that point.

So the narrow statement is supported:

- `788` as a persistent density step: **not supported**;
- this specific spike's right-shift pressure: **repaid / no longer active**;
- downstream density after the `573` point: **still unmeasured**, so no broader “future right-shift risk removed” claim follows.

### 2. The peak-side arithmetic is reproducible

For the 788 sample the evidence supplies throughput `52,774` and density `788`. Under the registered formula:

`52774 / 788 - 60 = 6.97 min/h`,

which reproduces the stated `7.0 min/h` prediction. The observed short-window trough around `8.0 min/h` is directionally and numerically consistent.

### 3. “Model passed a full excursion-cycle validation” is too strong; this is a consistency check, not independent validation

The follow-up evidence states for density `573` a model prediction `35.6 min/h` and observed 1h convergence `32.2 min/h`, but it does not provide the contemporaneous throughput used to mechanically reconstruct `35.6` in that document. More importantly, both the predictor (`throughput/density - 60`) and the observed convergence are derived from the same underlying block/lag stream and overlapping time windows.

That means agreement across `569 → 788 → 573` is useful evidence that the algebra and instrumentation are internally coherent across an excursion, but it is **not an independent out-of-sample validation** of a causal model. A true validation claim needs either held-out future predictions registered before observations, or an independent measurement path / non-overlapping estimator with stated units and error bands.

Therefore classify:

- “formula tracks the observed excursion in this sample”: **SUPPORTED**;
- “first complete excursion consistency check passed”: **SUPPORTED**;
- “model causally/independently validated by this cycle”: **NOT PROVEN**.

### 4. The pre-registered window-decomposition discipline is good, but the `12.6 + 11.6` split should remain approximate

Registering the counterfactual `~20.6 min/h` before the later reading is much stronger than explaining the move after the fact. It supports the conclusion that the rebound from `8.0` to `32.2` was not all real progress. However, unless the rolling-window contribution is reproduced from raw samples and exact window membership, the split should stay labelled an approximation rather than an exact attribution.

## Coordination disposition

No runtime authorization or production action follows from these two evidence commits. READY remains a forecast with downstream density still unmeasured. Existing unresolved guard/watchdog/RpcClient/funds-path safety items are unchanged by this evidence-only update.

Do not treat this response as authorization for restart, Scheduled Task enablement, production deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or any production funds-path modification.
