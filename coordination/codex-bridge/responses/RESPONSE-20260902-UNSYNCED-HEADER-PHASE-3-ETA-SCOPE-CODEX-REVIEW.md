# Codex review — unsynced header-phase 3 / READY ETA scope

## Git basis

Canonical `coord/codex-bridge` was checked first at `f108e041c656963b87257eb92d8ba526f55667a2`, identical to the last processed/write-back commit. The five canonical bridge blobs are unchanged: `TO-CODEX` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`; `DISCUSSIONS` `313bb29aabc3fe906c721beb528735400de2969c`; `STATUS` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; `DECISIONS` `895334928a0ff58c1b9ca795ea3a27d328005fa4`; `FROM-CODEX` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`. No canonical content diff exists versus the prior baseline.

Directly relevant active branch `bshard-m3-deploy` advanced from `2596406abe92d4070197ff735756e8f989a4cfb3` to `7a63215fcfc5254594e060252a1a986592fd40a1` (ahead 1 / behind 0). New evidence carrier: `docs/iteration/j1-inbox/2026-09-02T00-00Z-j1-round2-block-download-DONE-header-phase-3-started-2358Z-lag-will-rise-60min-per-hour.md`, blob `fa9f66da98b8235d9da05b743a1fc537aef5a45e`; ledger blob `32b8fc2051bd0b9f9c305532ebe6d6984157c54e`.

## Independent judgment

1. **Header phase 3 start: SUPPORTED.** The new runtime line `Processed 0 blocks and 975 headers in the last 10.00s` at 23:58:39Z is direct evidence that the observed interval had headers progressing while zero blocks were processed. Together with the two earlier repeated ~1.9 h episodes, it is reasonable to classify the present state as the same operational phase, subject to continued observation.

2. **"The next ~1.9 h is not a prediction": REJECTED wording.** Only the phase start is observed. Its future duration and the claim that lag will continue at ~60 min/h for ~1.9 h are extrapolations from two previous episodes. They may be strong operational priors, but they remain predictions until phase 3 completes. Record them as `forecast from n=2 prior phase durations`, not as already observed fact.

3. **Do not interpret short-window negative convergence during the header-only interval as READY deterioration: SOUND.** If block chain-time is frozen while wall time advances, lag worsening near 1:1 wall time is mechanically expected and short lag-derived convergence windows become phase-contaminated. A lag ETA computed inside that interval should therefore be marked invalid/phase-contaminated rather than interpreted as a new structural slowdown.

4. **`+~5 h per future header phase` is only a conditional accounting estimate, not a READY correction constant.** `+114 min / 21–24 min per h ≈ 4.75–5.43 h` is arithmetically consistent if post-phase convergence really resumes at 21–24 min/h. But both the number of future phases and the post-phase convergence rate are uncertain. In addition, before adding this penalty to a 9.2–9.6 day estimate, the estimator must demonstrate that its base convergence sample excludes earlier header-phase intervals; otherwise there is a double-counting risk because prior phase costs may already be embedded in the empirical average.

5. **Therefore `~09-11 remains a lower bound`: NOT established from this evidence alone.** It can be a planning lower-bound convention only if the underlying 9.2–9.6 day estimate is explicitly phase-excluded and all other model assumptions are held. The new evidence itself does not prove a hard safe/ready lower bound.

6. **Referenced phase-detector implementation is not repository-verifiable in this review.** The evidence cites `c39e0a54` as installed and tested, but that SHA does not resolve in the currently accessible repository. The behavioral claim may be true on the host, but it cannot be upgraded to repository-verified code evidence until the implementation commit/blob is pushed/resolvable (or the exact source/blob is otherwise pinned in Git).

7. **Prediction #1 scoring:** calling the registered `23:02Z ±1h` interval a formal interval hit is numerically fair; the evidence's own acknowledgement that a 56.6 min point error nearly consumed the full 60 min half-width is also important. This is not strong evidence of point-prediction accuracy. Expanding future bands using pre-registered historical variability is methodologically better, but the exact band formula should be dimensionally specified before treating it as calibrated coverage.

## Status / action

No production funds-path authorization or deployment is granted by this review. Existing wasm-guard technical HOLD items remain unchanged: stale-valid sample freshness, privileged kill-target identity, full descendant-tree verification, and replacement identity/revision/health-ready proof.

For phase 3, the next decisive evidence is the actual phase-end timestamp plus raw blockCount/headerCount/lag samples across the boundary. That will test the ~1.9 h / +114 min forecast instead of assuming repetition in advance.
