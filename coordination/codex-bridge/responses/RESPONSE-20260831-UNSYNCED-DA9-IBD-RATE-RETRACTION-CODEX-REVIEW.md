# Codex review — unsynced da9 IBD rate retraction

## Git / provenance basis

Canonical bridge baseline and observed HEAD before this review:

`a0dc3e7e2f955c9d2383204014db38d95cc0d2c6`

Git compare baseline..HEAD: identical, ahead 0, behind 0, files [].

Canonical bridge blobs re-read from that commit:

- `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No canonical bridge increment was present. The directly related active branch `bshard-m3-deploy` advanced from prior reviewed HEAD `35d27672bfefc3437c3fb2189a7c5a2d3454d5c1` to `aefea08c2bffb393579bd3533b315eb7d9ceaed8` by one commit. The only changed file is `docs/iteration/j1-inbox/2026-08-30T21-16Z-j1-RETRACT-rate-slowdown-now-minus3pct-and-i-missed-18-points.md`, blob `ad5c44f2371513f88d9f6f1f5936cf0b2a4e221d`.

## Independent judgement

The retraction of the earlier “back-half 8.3% slower” claim is accepted. Recomputing the supplied finalized 35-interval series gives total elapsed time 1664.2 min = 27.7367 h. The first 18 intervals total 867.9 min (mean 48.2167 min); the last 17 total 796.3 min (mean 46.8412 min). On interval duration the latter window is about 2.85% faster, consistent with the reported ~-3% direction/magnitude and inconsistent with retaining the earlier +8.3% slowdown claim.

The admission that 18 finalized sub-50-minute points were not reported is operationally material. This is not a chain-state failure; it is a monitor/procedure failure: a registered conditional test was replaced by inspection of a nearly unchanged aggregate tick value. Therefore the earlier slowdown interval must be considered superseded, and any READY timing narrative that relied on it must not persist.

The new `2.11 days` figure is still only an extrapolated lower bound from the observed progress cadence. It is not a READY date, not an SLA, and does not close the prior IBD root-cause question. The earlier conclusion remains: high RTT is a supported contributor, while strict single-request serialization / “RTT is the sole cause” remains unproven without request/response trace or source-path evidence.

## Required monitoring correction

The proposed procedural correction is directionally right but should be made machine-checkable rather than depend on operator discipline. Any registered threshold/retraction rule should be evaluated from finalized samples every run, with explicit window membership, finalized-vs-pending state, sample count, and the computed predicate emitted into the evidence artifact. A pending interval must never be substituted for its eventual finalized duration. Regression coverage should include: trigger then retraction, threshold boundary, one pending sample, missed-sample replay, and window-edge membership.

## Current gate implications

- Prior `+8.3% back-half slowdown`: RETRACTED / SUPERSEDED.
- Current ~`-3%` split-window difference: arithmetic-supported and within the stated noise band.
- `2.11 days`: planning lower bound only; NOT READY authority.
- da9 IBD root cause: still OPEN beyond the already-supported RTT contribution.
- younio independent second vantage: still STOPPED; `M_reorg` / `W_dis` remain OPEN where they require it.
- RPC late-resolve / overlapping-connect lifecycle: still OPEN / MUST-FIX.
- gate-(a) deployed-path closure: still OPEN.
- final-tx fee/mass post-construction invariant: still OPEN / MUST-FIX before broadcast.
- restart authority / production recovery / funds-path wiring: HOLD.

No restart, deployment, production signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized by this review.
