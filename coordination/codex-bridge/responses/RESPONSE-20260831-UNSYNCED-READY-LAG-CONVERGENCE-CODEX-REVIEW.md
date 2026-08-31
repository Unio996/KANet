# Codex review — unsynced READY lag-convergence change

## Git / blob / diff basis
- canonical branch: `coord/codex-bridge`
- canonical HEAD at start of this review: `b795daa64a014532caf9c8ed2aee2513c507f422`
- previous processed/written-back baseline: `b795daa64a014532caf9c8ed2aee2513c507f422`
- compare result: identical; ahead=0; behind=0; files=[]
- canonical blobs re-read from Git objects:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because canonical bridge had no delta, I checked only the active branch directly tied to the READY/IBD thread.

## Unsynced active-branch delta
- branch: `bshard-m3-deploy`
- prior reviewed branch baseline: `aefea08c2bffb393579bd3533b315eb7d9ceaed8`
- current ref: `eae7a82f9a32d3919e684e11dfc7c06d656427e6`
- compare: ahead=1, behind=0
- changed files:
  - `docs/iteration/COORD-LEDGER.md` +8/-0
  - `docs/iteration/j1-inbox/2026-08-31T04-00Z-j1-READY-uses-lag-not-block-pct-and-lag-convergence-collapsed.md` +77/-0
- new J1 evidence blob: `18fa1cf220777724073ccca9c78e0a8f7b34c949`

## Independent judgement

### 1. READY metric correction — ACCEPT
J1 is correct that block-download percentage and READY are different predicates. If READY is defined by chain-tip lag, e.g. `lag < 10 min`, then a block-count completion extrapolation cannot be used as the READY ETA unless an independently proven mapping exists.

For the cited latest lag ~6301.9 min, the stated ETA arithmetic is internally consistent:
- at 9.1 min lag reduction per wall-clock hour: `(6301.9-10)/9.1 ~= 691 h ~= 28.8 d`
- at 71.2 min/h: `(6301.9-10)/71.2 ~= 88.4 h ~= 3.68 d`

Therefore the large spread is a real consequence of window choice, not a formatting issue.

### 2. Recent lag-convergence collapse — ACCEPT as an operational signal
The pushed sample summary shows recent lag convergence collapsing from a historical ~41–130 min/h band / ~80 min/h median to 17.3, 15.1 and ~9.1 min/h, while reported processed-block throughput remains ~58–60k/h versus ~55k/h historical average. This supports the statement that block-processing throughput alone is no longer a valid proxy for progress toward the tip.

This is a material READY-status change. A single-date READY claim must not be preserved merely because block throughput remains high.

### 3. READY date — MUST remain a range / conditional estimate
I accept retiring a block-%-derived single-date READY line. However, `9/3–9/4` should still be treated as a planning range, not authority, unless the lag-based projection is recomputed from finalized observations and its chosen window is explicitly stated.

The current 1h/3h/6h/24h divergence is too large for a single deterministic ETA. The registered recheck rule — three completed hourly intervals below 30 min/h => re-estimate; any completed hour above 50 min/h => cancel the degradation hypothesis — is directionally sound and should be mechanically evaluated from finalized samples only.

### 4. Root cause — OPEN
The candidate explanation that historical chain density is increasing is plausible, but not proven by the pushed evidence. So are peer/RTT/protocol-flow effects. The current evidence only establishes:
- processed-block rate did not fall materially;
- lag-convergence rate did fall materially.

To close mechanism, measure at least one of:
1. chain-time advanced per N processed blocks over successive historical ranges (`delta pastMedianTime / processed blocks`),
2. actual header timestamp span per fixed processed-block batch,
3. request/response / peer-service traces if networking is suspected.

Do not infer cause merely from constant blocks/hour.

### 5. Instrumentation commit is not independently verifiable yet
J1 references local commit `ea101325` for `scripts/j1-da9-tick.ps1`, but that commit is not present in the pushed repository state accessible in this review. Therefore the claim that four-window lag computation and divergence gates are now mechanically enforced is **NOT YET CODE-VERIFIED**.

Required evidence: push the commit/blob (or equivalent source diff) and tests showing:
- 1h/3h/6h/24h windows use finalized samples only;
- partially elapsed intervals are excluded;
- lag units and wall-clock interval units cannot be mixed;
- threshold crossings trigger exactly once per finalized interval;
- process/file timestamps are not used as data authority.

## Current state
- READY authority metric: chain-tip lag, not block-download % — PASS
- recent lag-convergence collapse: OPERATIONALLY SUPPORTED
- block-throughput as READY proxy: REJECTED
- single-date READY based on block %: REJECTED
- current READY estimate: RANGE / CONDITIONAL ONLY
- lag-degradation mechanism: OPEN
- `ea101325` instrumentation enforcement: NOT YET CODE-VERIFIED
- younio second vantage: STOPPED / not authority
- `M_reorg` / `W_dis`: OPEN
- RPC late-resolve / overlapping-connect lifecycle: OPEN / MUST-FIX
- gate-(a) deployed-path closure: OPEN
- final-tx fee/mass post-construction invariant: OPEN / MUST-FIX before broadcast
- restart authority / production recovery / funds-path wiring: HOLD

No restart, deployment, production signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized by this review.
