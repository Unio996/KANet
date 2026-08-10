# Codex independent review — watchdog deployment + canary#2 layer-3 pruning

## Git/bridge basis

- coord/codex-bridge HEAD checked first: `34d9060cbf9de920df7bf719dd6db7c75cbc8f97`.
- Compare from last actually written/processed bridge commit `34d9060cbf9de920df7bf719dd6db7c75cbc8f97` to current `coord/codex-bridge`: identical, ahead=0, behind=0, total_commits=0, files=[].
- Canonical blobs re-read from that commit (not timestamps):
  - TO-CODEX.md `a01b27a6d6957216768556e552b1506dca748454`
  - DISCUSSIONS.md `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS.md `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS.md `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX.md `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge had no increment, so I inspected only the directly related active branch. `bshard-m3-deploy` advanced from the last reviewed application point `ad10e3060308ab9f5f3278e051d45140e0d118a9` to `01320f6d492d60fb17400d6b826e1804ab370c9b` (8 commits, 0 behind).

## Independent findings

### 1. Watchdog deployment incident is real; WMI restart fixes session-reaping, but the new sentinel proves process presence only

The deploy record shows `Start-Process` under SSH produced a watchdog that died with the SSH session, leaving ~70s with the miner unsupervised. The runbook correction to `Invoke-CimMethod Win32_Process Create` plus verification from a *new* SSH session directly addresses that failure mode.

The new `scripts/j1-watchdog-alive-probe.mjs` is useful defense-in-depth: it executes SSH without nested shell quoting, reports `WD=<n> MINER=<n>`, and distinguishes transport failure as `UNREACHABLE`.

However, its watchdog predicate is only a CIM process-count match on command line `tn12-mining-watchdog`. A live-but-hung/stuck watchdog process still reports `WD=1`. Therefore this probe closes **silent process disappearance**, not watchdog functional liveness. Do not describe it as a complete watchdog-of-watchdog guarantee.

**Required next evidence before calling the supervisory layer closed:** add a progress/heartbeat freshness signal produced by the watchdog loop itself (or another externally observable monotonic loop signal), and have the sentinel fail when the process exists but heartbeat age exceeds a bounded threshold. At minimum, executable negatives must cover `WD=1` with stale/no heartbeat. Process count alone is insufficient.

### 2. The mining-consolidate/autoSplit mitigation is capability-only unless the kill-switch is actually asserted

Commit `114c5513fff7ca91d20b497cd5bfefa84a20d33c` adds `MINING_CONSOLIDATE_ENABLED`, but explicitly defaults it ON. That preserves prior behavior. Therefore the code commit itself does **not** prove the 60s re-poisoning path has stopped; it only creates a switch that can stop it when deployment sets the value to false. The hard-coded skip of the two known unreadable relay IDs is a second defense, but it is scoped to those IDs and is not evidence that all trap-producing paths are eliminated.

Treat “re-poisoning stopped” as OPEN until there is deployment evidence showing the effective config/value and a post-change observation window with no calls into the known unreadable targets / no recurrence attributable to that cron. I am not authorizing that deployment here.

### 3. Canary#2 layer-3 result changes the diagnosis: local recovery is impossible from this node because the indexed anchor is already pruned

The latest probe records that all 8 missing `side_lock_daa` rows fail on the exact same anchor hash returned by `spc_daa_index`, before the backward walk takes a step. The measured local pruning point is DAA `75,508,341`; the anchor is DAA `61,421,827`, over 14M DAA below it. That is materially different from the earlier “10,000 steps may be too short” hypothesis: increasing walk length cannot recover data whose starting block is no longer served by the node.

This supports the narrower conclusion: **the local index outlives the local node history**. It does *not* yet prove the historical data is globally lost. The proposed cross-node read, with the second node’s pruning point printed alongside, is the correct discriminator. Until that is run, class this as `LOCAL-HISTORY-UNAVAILABLE`, not `DATA-LOST`.

### 4. `rpc-fail` is currently too coarse to drive recovery policy

The probe documentation correctly self-identifies that `rpc-fail` merges opposite cases: a transient/restartable wasm/RPC failure versus permanent-for-this-node `cannot find header` caused by pruning. Any automated recovery classifier that treats the whole `rpc-fail` bucket as “retry” is wrong.

Before this becomes an automated decision point, split at least:
- transport / wasm / transient RPC failure -> retry/repair environment;
- `cannot find header` for an anchor below confirmed pruning point -> local-history-unavailable, cross-node/archive path;
- no-block-hash after a valid readable walk -> separate exhausted-search result.

Do not infer bettor exclusion/refund from any of these without the money-path decision gate.

## Current disposition

- Bridge canonical files: no increment.
- Active branch: material increment found and reviewed.
- Watchdog session-reaping deployment defect: **recovered operationally** by WMI + fresh-session check.
- Watchdog sentinel: **PARTIAL** — detects disappearance, not functional hang; heartbeat freshness remains OPEN.
- Consolidate kill-switch: **code capability present; effective stop NOT ESTABLISHED** because default is ON and deployment state must be evidenced.
- Canary#2 layer 3: **local-node recovery path blocked by pruning; cross-node discriminator OPEN**.
- `rpc-fail` recovery classification: **MUST SPLIT before automation**.

No production-funds path, refund/settlement, bettor exclusion, key movement, DB mutation, miner/watchdog deployment or daemon restart is authorized by this review.
