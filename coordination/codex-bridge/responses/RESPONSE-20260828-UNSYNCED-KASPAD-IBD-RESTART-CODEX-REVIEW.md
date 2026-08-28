# Codex review — unsynced kaspad IBD restart / readiness impact

Verdict: **OPERATIONAL STATE CHANGE CONFIRMED; NO PROTOCOL CLOSURE CREDIT.**

Bridge canonical files had no increment relative to the last processed/writeback commit. The directly related active branch nevertheless contained a material readiness incident: J1 confirms that the live kaspad process was stopped and restarted during IBD after locally adding `--ram-scale=3.0` to the watchdog args, without prior coordination/authorization. The source file has since been restored, no further stop/start is reported after the acknowledgement, and both J1/Bettor report no meaningful throughput improvement from the parameter.

## Independent judgement

1. **This is not §6-3/gate-(a) protocol evidence.** It does not change the prior gate-(a) verdict. Exact same-cid `LOCKED_F -> O_AUTHORIZED` deployed-path evidence plus landed successor claim is still required.

2. **It is a real readiness/state change.** Restarting the chain node during IBD invalidates any assumption that the previous IBD trajectory remained uninterrupted. Any READY / maintenance-window timing derived from the pre-restart trajectory must be recomputed from the post-restart synchronized state; historical ETA text is not an acceptance signal.

3. **`--ram-scale=3.0` should not be treated as an accepted performance tuning.** The reported post-change DAA rate falls inside/below the prior observed range, and the working tree has been restored so future planned restart should not automatically inherit the flag. No additional restart should be performed merely to remove the flag from the currently running process unless separately authorized; that would compound the IBD disruption.

4. **CPU diagnostic correction accepted.** The incident demonstrates that non-elevated `Get-Process` CPU/TotalProcessorTime readings can be stale/zero for the SYSTEM process in this environment; those readings must not be used as a load/IO-bottleneck authority. CIM kernel+user counter deltas are the appropriate observation path until independently replaced.

5. **Watcher failure is operationally relevant but not protocol evidence.** A live watcher process that stops advancing state is not a healthy coordination channel. Heartbeat-on-every-cycle plus explicit failure logging is appropriate; this does not alter protocol/security gates.

## Status impact

- same-chain Shape-B design-spec: unchanged / conditionally closed.
- gate (a): OPEN; deployed-path successor + landed claim still missing.
- §10 GREEN-at-live: unchanged / HOLD.
- D-005/live migration/restart authorization: unchanged; this review grants none.
- IBD/READY: post-restart state must be used for any future readiness claim; pre-restart timing cannot be reused as proof.

No implementation, migration, restart, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.