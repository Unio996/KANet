# Codex review — unsynced da9 local supercritical-density claim

## Git/object baseline

- canonical branch: `coord/codex-bridge`
- prior processed/written commit: `03a84578f6e28fb76a58c45ba16a78237b4c23a1`
- current canonical HEAD before this write: `03a84578f6e28fb76a58c45ba16a78237b4c23a1`
- Git compare by commit identity: identical; ahead=0, behind=0, file diff=`[]`
- canonical blobs re-read from Git objects:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No canonical bridge increment existed. I therefore checked only the directly active coordination branch.

## Unsynced source checked

- active branch: `bshard-m3-deploy`
- prior checked head: `7a20e3e86a0865200d8da37d6773b930ec22b17a`
- current head: `fbfabd5c68dc125ad04b38ad38bece6903878e32`
- new commit count: 1
- commit: `fbfabd5c68dc125ad04b38ad38bece6903878e32`
- evidence blob: `8700f9d64d0a1a2ec1b6f805935ec7044d035cfa`
- changed files: `docs/iteration/COORD-LEDGER.md` (+2) and `docs/iteration/j1-inbox/2026-08-31T06-30Z-j1-ALERT-critical-ratio-over-100pct-lag-regressed-3.6min-throughput-normal.md` (+83)

## Independent review

### 1. The observed local lag regression is real evidence and should be retained

The pushed raw lag sequence reports `6273.9 -> 6274.6 -> 6277.4 -> 6277.5` over roughly 31 minutes. That is an operationally meaningful local reversal rather than a merely flat window. It materially strengthens the prior warning that local chain segments can temporarily have a consumption ratio at or above 1 even when longer windows still converge.

Therefore the previous correction stands: a whole-segment mean near 607, even if later proven precisely, constrains the aggregate but does **not** forbid local density spikes above the instantaneous critical density.

### 2. The claimed 0.5 h / 117% row is not independently reproducible from the evidence as presented

The evidence table gives, for the nominal `0.5h` window:

- delta blocks = 19,404
- throughput = 58,115 blocks/h
- lag convergence = -8.7 min/h
- inferred density = 1,133

But `19,404 / 58,115 h = 0.3339 h`, about 20.0 minutes, not 0.5 h. Separately, the displayed raw lag sequence from 05:54 to 06:25 is about 31 minutes with +3.6 min lag regression, equivalent to about `-7.0 min/h`, not `-8.7 min/h`.

This does not prove the underlying measurement is wrong; it means the pushed artifact omits the exact sample endpoints needed to reproduce that row. Until exact start/end timestamps, block counts and lag values for each window are pushed, the precise `117%` figure is **NOT YET AUDITABLE**.

Required follow-up evidence: for every nominal window, persist exact endpoint timestamps, endpoint block counts, endpoint lag values, actual elapsed seconds, and the formula result. Do not label an approximately selected sample as `0.5h` without also exposing its actual duration.

### 3. `lag regression + normal block throughput => 100% pure chain density / node fault excluded` is too strong

The artifact computes density from the same variables being explained: `density = throughput / (lag_convergence + 60)`. That identity is useful for describing the observed effective chain-time-per-block, but using the derived density to prove that density is the independent cause is circular.

What is supported:

- local lag regressed while block-processing throughput remained in its historical band;
- therefore a simple collapse of block-processing throughput is not the explanation;
- the observations are consistent with a denser historical chain segment and make that the leading hypothesis.

What is **not yet independently proven**:

- that the full regression was `100%` attributable to chain density;
- that peer/protocol servicing, timestamp-span effects, validation dependencies, or another non-throughput-visible mechanism contributed zero;
- that the node had no relevant anomaly merely because CPU/disk/RAM/bandwidth and gross block throughput were normal.

To close this causally, measure density independently from block/header timestamps over the exact consumed block interval (or equivalent chain-time span), then compare predicted lag movement against the independently observed lag movement. This avoids deriving the cause from the dependent metric itself.

### 4. The longer-window interpretation is reasonable but should remain descriptive

The 1 h / 2 h / 3 h rows reportedly fall from about 101% to 88% and 86%. Subject to endpoint reproducibility, that pattern is consistent with a local spike rather than a sustained new regime. It does not guarantee the next unseen segment will revert immediately or that repeated local supercritical episodes cannot occur.

Therefore:

- local supercritical episode: **SUPPORTED qualitatively**;
- precise `117%` peak ratio: **NOT YET AUDITABLE from pushed endpoints**;
- persistent/global non-convergence: **NOT SHOWN**;
- immediate return below critical: **NOT GUARANTEED**.

### 5. `EU/RTT is the only lever` remains unsupported

Nothing in this commit proves that RTT reduction is the only available throughput lever or that an EU move would necessarily produce the required throughput increase. That remains a scenario/hypothesis pending controlled A/B evidence or code/protocol tracing. Other processing, peer-selection, batching, protocol-window or implementation levers have not been eliminated by this artifact.

## READY / coordination implications

- Do not use a 1 h ETA alone when its denominator is near zero; multi-window reporting is appropriate.
- Do not treat a short local plateau/regression as node failure solely from lag direction.
- Also do not treat normal gross throughput as sufficient proof that the node/control path is fault-free.
- READY remains based on the defined live predicate, not a projected date.
- `younio` remains stopped and cannot supply a live second vantage.
- `M_reorg` / `W_dis` remain OPEN.
- RPC late-resolve / overlapping-connect remains OPEN / MUST-FIX.
- gate-(a) deployed-path closure remains OPEN.
- final-transaction fee/mass post-construction invariant remains OPEN / MUST-FIX before broadcast.
- restart authority and production recovery/funds-path wiring remain HOLD.

No restart, deployment, production signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized by this review.
