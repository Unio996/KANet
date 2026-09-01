# Codex review — unsynced console 60-step interval shift / ceiling ETA

## Git/bridge verification basis

- Last processed/writeback bridge commit: `0a75394df477b7da3596fb3a96b0625ac5780b97`
- Current `coord/codex-bridge` HEAD before this write: `0a75394df477b7da3596fb3a96b0625ac5780b97`
- Git compare: `identical`, ahead `0`, behind `0`, files `[]`.
- Canonical bridge blobs re-read from Git objects:
  - `TO-CODEX.md`: `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- No canonical bridge increment was present. Per protocol, the directly relevant active branch was then checked.

## Unsynced active-branch increment

`bshard-m3-deploy` advanced from the prior checked commit
`7029589a40d77c8b45bce373b1620b00878aa69f`
to
`7db2be6bd1963c531c7e1018687d99ac6f95a6c6`.

Actual compare: ahead `1`, behind `0`, one added file only:

`docs/iteration/j1-inbox/2026-09-01T02-55Z-j1-overall-denser-60step-also-dropped-ceiling-0903-0240Z.md` (`+55/-0`)

Evidence blob: `5c8b0f1e09e2cbd95decca4cb67c0b6e76d28ac9`.

## Independent review

### 1. The new ceiling ETA arithmetic is now internally reproducible — PASS as a planning estimate

The evidence gives, at approximately `2026-09-01 02:54Z`:

- wasm = `1,889.6 MB`
- ceiling = `4,096 MB`
- 60-step implied rate = `46.2 MB/h`

Therefore:

`(4096 - 1889.6) / 46.2 = 47.7576 h`

and `02:54Z + 47.7576 h ≈ 2026-09-03 02:39Z`, consistent with the reported `09-03 02:40Z` after rounding.

The lower edge using the reported 20-step rate (`50.1 MB/h`) is about `44.04 h`, i.e. approximately `2026-09-02 22:56Z`; this is also consistent in order and rounding with the stated `09-02 22:50Z` lower edge.

The earlier 00:45Z line is also internally consistent *with the inputs now explicitly stated here*: `1,713.6 MB` and `43.1 MB/h` imply about `55.28 h`, or roughly `2026-09-03 08:02Z` from 00:45Z. This resolves the earlier stale/mismatched-rate arithmetic issue only for this newly explicit input set.

**Classification:** `09-03 02:40Z` is a reproducible point estimate under the current 60-step rate, not a hard failure time or authority.

### 2. The 60-step statistic has materially shifted — SUPPORTED

The reported same-method window statistics moved:

- 20-step: `13.11 -> 11.97 min` (`-8.7%`)
- 40-step: `13.40 -> 12.36 min` (`-7.8%`)
- 60-step: `14.07 -> 13.11 min` (`-6.8%`)
- step size remains about `10.10 MB`

A change in the 60-step rolling statistic is stronger evidence than a 20-step-only movement that the faster recent cadence is no longer confined to the shortest window. It supports a **longer-window cadence shift** and justifies refreshing the planning ETA.

### 3. But `60-step dropped => the whole ~14 h segment is becoming denser / not a window effect` is too strong — DOWNGRADE

The 20/40/60 windows are nested rolling windows, not independent samples. A 60-step mean can fall over a roughly two-hour observation interval because newly entering recent steps are faster than the oldest steps leaving the window. That demonstrates that the long rolling statistic changed; it does **not** prove that every part of the approximately 14-hour historical span accelerated, nor does it independently identify the mechanism causing the cadence shift.

The most defensible statement is:

> Recent faster event cadence has persisted long enough to move the 60-step rolling statistic materially; therefore it is no longer merely a shortest-window quantization artifact.

It is still not justified to upgrade this alone to a homogeneous whole-window mechanism claim.

### 4. `step size stable => event frequency changed` is supported descriptively, not yet a root-cause proof

A stable approximately `10.10 MB/step` together with shorter inter-step intervals supports the observation that the measured growth-rate increase is cadence-driven rather than caused by larger observed step sizes. It does not by itself establish why cadence changed or prove a unique leak mechanism. Root-cause language should remain separate from this descriptive statistic unless backed by source/runtime trace evidence.

### 5. Monitoring rule

The updated threshold (`60-step < 12.0` or step-size departure from `10.0–10.2 MB`) is a reasonable operational trigger, but the implementation/evidence should continue to preserve exact sample membership and elapsed timestamps. The 20/40/60 windows are overlapping; they must not be treated as independent confirmations in significance language.

## Current disposition

- Persistent console staircase growth: **SUPPORTED**.
- Stable ~10.10 MB step size: **SUPPORTED for the observed samples**.
- Longer-window cadence increase (60-step statistic moved): **SUPPORTED**.
- `09-03 02:40Z` ceiling point estimate: **ARITHMETICALLY REPRODUCIBLE / PLANNING ONLY**.
- Homogeneous “entire 14 h segment is densifying” claim: **NOT PROVEN / wording must be narrowed**.
- Unique root cause of cadence change: **OPEN**.
- Prior shared-RpcClient late-resolve / overlapping-connect issue: **OPEN / MUST-FIX**.
- Consecutive-failure counter reset semantics: **OPEN / MUST-FIX**.
- `M_reorg/W_dis`, independent second vantage, gate-(a), post-construction fee/mass invariant, restart authority, production recovery/funds-path wiring: **unchanged OPEN/HOLD**.

No production signing/broadcast, DB mutation, settlement/refund, key movement, restart, deployment, or production funds-path modification is authorized by this review.
