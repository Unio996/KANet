# Codex review — unsynced younio stop / second-vantage premise change

## Git basis

- canonical branch checked first: `coord/codex-bridge`
- last processed / last write-back commit: `4368230409522c21446743e5df2004ea28f2d713`
- current canonical HEAD at start of this run: `4368230409522c21446743e5df2004ea28f2d713`
- actual compare: identical; ahead 0 / behind 0 / files=[]
- canonical blobs at that commit:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No canonical bridge delta was present, so I checked the directly relevant active branch instead of treating unrelated development commits as collaboration feedback.

## Unsynced active-branch delta

`bshard-m3-deploy` moved from the previously reviewed `1ec3b1979290afcedc8491830fc68d8bb8a81505` to `12f139b053462e1e7f02b16c36a816f475c62617` (1 commit). Actual diff is limited to:

- `docs/iteration/COORD-LEDGER.md` +6/-0
- `docs/iteration/j1-inbox/2026-08-30T12-13Z-j1-younio-fully-stopped-owner-order-bridges-dead-7.9d.md` +72/-0

The new evidence blob is `b5ee86c1c3c813132a3a27835c0b7e03a20d4214`.

## Independent judgment

### 1. Premise change is substantive and directly relevant

The evidence says Owner explicitly ordered the local `younio` kaspad plus KANet stack stopped, leaving `da9` as the only running node. That means any monitoring, corroboration, lag series, pruning-point series, block-scan series, or other measurements sourced from `younio` after the stop must be treated as stale / unavailable, not as a second live vantage.

This changes the evidence topology even if the primary `da9` READY computation itself is unchanged.

**Decision:** accept the premise change; do not continue citing `younio` post-stop as live evidence.

### 2. Second-vantage closure must not be silently inferred

The new artifact itself says the second vantage is now absent and `M_reorg` / `W_dis` remain OPEN. That is the correct conservative interpretation.

A single healthy `da9` stream can continue to support the local READY predicate if the predicate was already defined on that single primary source, but it cannot satisfy evidence requirements that explicitly require independent cross-vantage corroboration. Do not collapse these two questions into one GREEN status.

**Decision:** `da9` READY authority and second-vantage corroboration remain separate gates. The latter stays OPEN unless an independent replacement vantage is established and its provenance is verified.

### 3. Bridge liveness finding is operationally important, but the exact code-root claim is not independently closed here

The artifact reports two local bridge processes had been ineffective for ~7.9 days because they targeted `127.0.0.1:3100` while the local console was on 3400, and recommends reading the port from `kanet.env` plus heartbeat/self-checks.

That remediation direction is sound: configuration authority should come from the same environment source used by the console; a process-alive signal without successful end-to-end work is not a liveness proof.

However, in this review I could verify the pushed operational evidence but did not locate the cited `channel-bridge.mjs` path in the accessible branch via repository search. Therefore I am **not** promoting the exact hard-coded line/path to code-proven root cause yet. If this bridge path is rebuilt, require a pushed source blob plus a regression that fails on env/port mismatch and proves the heartbeat goes RED when no messages can traverse.

### 4. Owner stop is not authorization for any restart or funds-path action

The evidence includes a possible future restart command. This review does not authorize running it, changing `--ram-scale`, restoring services, signing/broadcasting transactions, moving keys, mutating DB state, settlement/refund, or any production funds-path modification.

If `younio` is ever brought back, its measurements must be treated as a fresh lifecycle epoch; stale pre-stop readiness or monitoring state must not be inherited.

## Current disposition

- `younio` live node / KANet vantage: **STOPPED by Owner order**
- post-stop `younio` monitoring evidence: **STALE / NOT AUTHORITY**
- `da9` READY computation: **not invalidated by this stop**, subject to its existing real-time gate
- independent second vantage: **ABSENT / OPEN**
- `M_reorg` / `W_dis`: **OPEN**
- bridge process-alive == bridge healthy: **REJECTED**
- exact pushed code proof of reported 3100-vs-3400 root cause: **OPEN**
- `Promise.race(rpc.connect(), timeout)` late-resolve / overlapping-connect lifecycle: **still OPEN / MUST-FIX**
- gate-(a) deployed-path closure: **OPEN**
- final-tx fee/mass post-construction invariant: **OPEN / MUST-FIX before broadcast**
- restart authority binding / production recovery / funds-path wiring: **HOLD**

No production restart, signing, broadcast, deployment, DB mutation, settlement/refund, key movement, or funds-path modification is authorized by this review.
