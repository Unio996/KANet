# Codex review — unsynced console acceleration / ACT authority claims

## Scope / Git basis

Canonical bridge baseline and starting HEAD for this review: `5ea9e11d4a3dc72f05635e16b54d295eaf9da931`.

Git compare `5ea9e11d4a3dc72f05635e16b54d295eaf9da931...5ea9e11d4a3dc72f05635e16b54d295eaf9da931` is identical (`ahead=0`, `behind=0`, no changed files). Incrementality was determined from commit/blob/diff state, not from any in-file timestamp.

Canonical five blobs at the starting HEAD:

- `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the bridge itself had no increment, I compared the directly relevant active branch `bshard-m3-deploy` from the prior processed checkpoint `3e7193710386a441a3dd0bac997d3bf6e1122a7c` to current `6ccfba4b046f2d40134645af27a97c36a70f3590`: ahead by 2 commits, behind 0. Relevant source commits are `a46c8bb9b41960adb7ad7cff9a46da49da44fb46` and `6ccfba4b046f2d40134645af27a97c36a70f3590`.

## Independent findings

### 1. The acceleration signal is now materially stronger, but “compound/exponential” is not proved

J1 supplies six non-overlapping endpoint windows with gross rates approximately `38.7, 40.6, 42.1, 46.9, 53.7, 79.9 MB/h`, plus a separate step-cadence estimate near `77.9 MB/h` and a post-burst 3h endpoint estimate near `78.6 MB/h`.

This is materially stronger than the previously rejected short rolling-window slope: the six gross endpoint windows are non-overlapping, and the longer-window rate is clearly moving upward. Therefore:

- sustained acceleration / increasing leak rate: **SUPPORTED operationally**;
- stable ~10 MB ordinary step size with frequency/cadence increase: **SUPPORTED descriptively**;
- “this is compound/exponential growth”: **NOT PROVEN**.

Monotonically increasing finite-window rates do not by themselves identify an exponential/compound law. In particular, the final 6h gross window includes the separately identified `+69.6 MB` burst. J1 states that subtracting the burst still leaves ~`68.3 MB/h`, which remains above the preceding `53.7 MB/h` and therefore preserves the acceleration conclusion; it still does not establish a specific compound model or justify extrapolating a fixed second derivative as a bound.

Consequently, ACT/ceiling calculations based on a continuing “+2.4 MB/(h*h)” acceleration term are scenario estimates, not lower/upper mathematical bounds unless that growth law is independently justified.

### 2. The 07:03–07:11Z burst is a real second signature; single-cause attribution remains open

The reported burst has irregular increments (`+1.6,+1.8,+2.0,+40.8,+4.7,+5.0,+13.2 MB`) rather than the ordinary ~10 MB staircase. It is therefore reasonable to separate it from the normal staircase mechanism.

However, the later statement that it is a “one-time reconnect storm” is still **HYPOTHESIS / NOT ROOT-CAUSE CLOSED**. Correlation with simultaneous relay reconnects and an anomalously long settle tick can support that hypothesis, but without an allocation/call trace it does not identify which constructor/buffer/path owns the `+40.8 MB` allocation. Do not fold this burst into the normal `captureSideLockDaa` causal proof.

### 3. The leaf IBD gate does structurally cover the ordinary recapture constructor churn while the node is not synced

Code review of `e12e8ac461087ad4c64ca8d7b1dcaebed634da38` supports an important narrower conclusion. `captureSideLockDaa()` checks the node-sync gate before resolving/constructing its per-capture RPC client and returns `skipped:'node-not-synced'` unless `gate.synced === true`. The supplied regression explicitly checks zero `RpcClient` construction when the gate is closed. The currently referenced `recaptureSideLockDaaForMarket()` callers funnel into `captureSideLockDaa()`.

Also, the sync probe itself now uses `getSharedRpc()` in production, rather than constructing a fresh client per leaf call. Therefore ordinary not-synced recapture frequency increasing does not linearly recreate the old per-side constructor churn.

Verdict:

- ordinary not-synced `captureSideLockDaa` constructor churn is structurally cut off by the leaf gate: **SUPPORTED**;
- “the next restart makes all console leakage zero”: **NOT PROVEN**;
- burst path and funds-path/non-batch-1 constructors remain outside that narrow proof;
- previously identified shared-RpcClient late-resolve / overlapping-connect and consecutive-failure accounting defects remain **OPEN / MUST-FIX**.

### 4. New evidence contains a direct contradiction on ACT authority; therefore ACT is still not an automatic recovery guarantee

This is the most important status correction in the new material.

J1 states that `ACT 3200` is unattended and “does not need Owner elevation”. The later coordination ledger in `6ccfba4b...` states the opposite: when ACT fires, killing the SYSTEM-owned console “still needs one elevation capable of killing SYSTEM console”, and recommends the Owner execute the privileged stop before ACT.

Those claims cannot both be true. The new two commits provide no watcher source/blob, deployed revision, task identity/ACL, or trigger→kill→restart→health-ready trace that resolves the contradiction.

Therefore:

- ACT=3200 as an observed/planned threshold: **SUPPORTED**;
- current ETA window to that threshold: **planning only**;
- ACT automatically and autonomously recycles the live SYSTEM console without Owner action: **NOT VERIFIED and now internally contradicted**;
- “no action required because ACT is a guaranteed backstop”: **REJECTED** until execution authority is demonstrated.

To close this, provide the exact deployed ACT watcher source/blob, the live task/service identity and permissions, the `>=3200` comparison path and polling interval, and a non-production or historical trace showing `trigger -> successful stop of the actual SYSTEM console -> restart -> target revision loaded -> health-ready` without manual elevation.

### 5. Maintenance-window and ACT claims must remain separate

The leaf gate and batch-1 singleton are reportedly already in the live tree and will be loaded on the next console process start. That is different from proving what actor can cause that process start. The supervisor patch and its privileged task transition are likewise a separate control path.

Do not use “patch is on disk” as proof that ACT can activate it. Activation requires an actually successful restart under the live ownership/permission model.

### 6. Verify criterion needs one semantic fix

The proposed post-restart criterion `6h wasm slope <5 MB/h and no 10MB steps` is useful for verifying disappearance of the ordinary staircase. But “occasional burst does not count as failure” is too broad if the goal is to validate total memory safety. A burst should be classified separately rather than ignored:

- ordinary 10 MB staircase absent + low baseline slope => ordinary leak patch verified;
- any large irregular burst => separate anomaly remains OPEN and must be bounded/traced;
- total wasm still approaching safety threshold => operational safety is not PASS merely because ordinary steps disappeared.

## Required status carried forward

- ACT autonomous restart authority: **OPEN / NOT VERIFIED**.
- Ordinary not-synced recapture constructor churn after gate activation: **EXPECTED CLOSED BY CODE, requires live post-restart verification**.
- Irregular burst root cause: **OPEN**.
- “compound/exponential” law: **NOT PROVEN**; sustained acceleration is supported.
- shared RpcClient late-resolve / overlapping-connect: **OPEN / MUST-FIX**.
- shared RpcClient consecutive-failure reset semantics: **OPEN / MUST-FIX**.
- funds-path batch 2: **HOLD**.
- `M_reorg/W_dis`, independent second vantage, gate-(a), post-construction fee/mass invariant, restart authority, production recovery/funds-path wiring: **OPEN/HOLD as previously recorded**.

No production restart, deployment, production signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized by this review.
