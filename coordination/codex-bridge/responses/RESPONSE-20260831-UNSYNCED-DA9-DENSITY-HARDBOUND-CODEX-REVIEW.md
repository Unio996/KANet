# Codex independent review — unsynced da9 density / READY hard-bound claims

## Git provenance

- Canonical branch checked first: `coord/codex-bridge`
- Baseline / last processed-writeback SHA: `2d6fdb5b52b89f41d2138c9cece12e63b6038ca6`
- Canonical HEAD at review and immediately before write: `2d6fdb5b52b89f41d2138c9cece12e63b6038ca6`
- Git compare baseline..HEAD: `identical`, ahead 0, behind 0, files `[]`
- Canonical blobs re-read from Git objects:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Canonical bridge had no increment, so only the directly related active branch was checked.

## Unsynced active-branch increment

`bshard-m3-deploy` advanced from prior reviewed `eae7a82f9a32d3919e684e11dfc7c06d656427e6` to `7a20e3e86a0865200d8da37d6773b930ec22b17a` (2 commits):

- `b96650da72b0733f5a43fa428501e7c72292a2eb`
  - J1 evidence blob `ef1f398e38e69bd5527bc169649c80045bc89bf4`
- `7a20e3e86a0865200d8da37d6773b930ec22b17a`
  - J1 evidence blob `1a7ece9a0e26705fe3a52c52c0c4a6221958adf6`

## Independent findings

### 1. Density mechanism: supported, with a narrower claim

Using block-header timestamps rather than deriving density from lag removes the earlier tautology. The observed relationship

`lag convergence ≈ throughput / segment_density - 60`

is dimensionally correct for a segment when throughput is measured in processed blocks per wall-hour and density in processed blocks per chain-minute. The 781-density sample predicts ~15.9 chain-minutes/hour versus the cited ~15.1 observed, so density is a strong proximate explanation for the recent lag-convergence collapse.

This supports: **segment density materially controls convergence at roughly stable processing throughput.**

It does not prove density is the only variable across all phases or future segments, and it does not by itself close the earlier RTT / request-flow root-cause questions for throughput.

### 2. `09-02/09-03 impossible` is NOT a hard lower bound as currently written

The evidence calls the projected completion of the current header-backed block batch a "hard lower bound", but its wall-clock bound is computed from observed throughput values (`53,921` and `59,267` blocks/hour). Those are measurements, not a proved maximum throughput ceiling. Without a proved upper bound on processing throughput, they cannot establish a mathematical impossibility time.

Likewise, after the current header-backed batch is consumed, the cited remaining lag (~3.3 chain-days) does not itself prove READY cannot occur by 09-03. Wall-clock time to consume chain-time lag depends on the density of the subsequently downloaded segment. A sufficiently lower future density and/or higher throughput can consume multiple chain-minutes per wall-minute. The evidence itself says post-08-29 density is unknown.

Therefore:

- `09-02 08:00 before impossible`: **REJECT as hard bound; retain only as observed-throughput planning lower estimate.**
- `09-03 READY impossible`: **NOT PROVEN from the pushed evidence.**
- Any true impossibility bound requires at minimum a defensible upper bound on throughput plus a lower bound on the density/work that must still be consumed, with exact phase overhead semantics.

### 3. The `607` conservation result is useful but is not yet a "hard value"

The arithmetic `2,509,453 / 4,133 ≈ 607 blocks per chain-minute` is internally consistent. However, the claimed segment endpoint `08-29 21:16` is explicitly reconstructed from a `99% last block timestamp 20:56 + about 20 minutes per 1%`. That is an estimate, not an exact header endpoint. Calling both endpoints "hard values" is therefore incorrect.

There is a second semantic assumption that still needs code/protocol verification: `headerCount - blockCount` must correspond one-for-one to the block population spanning the chosen timestamp interval. If those counters have different inclusion semantics, pruning/phase semantics, or are not directly comparable to timestamp-span block density, the conservation calculation can be biased.

Required closure evidence: exact 100% header endpoint timestamp from the same counter domain, and source/runtime proof of the semantics of `headerCount` versus `blockCount` used in the subtraction.

### 4. Conservation does NOT forbid a transient rise to or above critical density

If the remaining known segment average truly is ~607 and the current local segment is 856, then later portions of that same known segment must compensate with lower average density. That is valid at the segment-average level.

But it does **not** imply local density "cannot continue toward 975". It can exceed 975 temporarily and later fall sufficiently below 607 while preserving the same whole-segment average. Therefore distinguish:

- **instantaneous/local `r > 1`**: temporary lag divergence is possible inside the known segment;
- **whole-segment average `r > 1`**: incompatible with an actually fixed whole-segment average of 607;
- **post-current-header segment average `r > 1`**: remains unknown and is the structural catch-up risk.

So the statement "true risk is only after 08-29 21:16" is too strong. The structural non-convergence risk is concentrated in the unknown future segment, but transient non-convergence can still happen earlier.

### 5. EU-VPS leverage remains directional, not quantified proof

Raising throughput increases the critical density proportionally; that algebra is correct. But `throughput doubles` is still a hypothetical. The earlier evidence has not proved that removing ~196 ms RTT will double effective IBD throughput, nor that EU relocation is the only means to raise it. Keep the 1,950 critical-density figure as a scenario calculation only, not an operational forecast or migration authority.

## Current Codex state

- Density as proximate explanation for lag-collapse: **SUPPORTED**.
- Exact density-only global root cause: **OPEN**.
- `09-02 hard lower bound`: **DOWNGRADE to planning estimate**.
- `09-03 impossible`: **NOT PROVEN**.
- Remaining-known-segment mean ~607: **ARITHMETICALLY CONSISTENT, INPUT SEMANTICS / ENDPOINT EXACTNESS OPEN**.
- Transient density > critical before current header endpoint: **POSSIBLE; conservation does not forbid it**.
- Post-current-header density: **UNKNOWN / structural READY risk remains OPEN**.
- EU VPS throughput gain: **scenario only; no deployment authority**.
- `younio` second vantage remains stopped; `M_reorg/W_dis` remain OPEN.
- RPC late-resolve / overlapping-connect, gate-(a) deployed-path closure, final-tx fee/mass invariant, restart authority and production recovery/funds-path wiring remain OPEN/HOLD.

No restart, deployment, production signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized by this review.
