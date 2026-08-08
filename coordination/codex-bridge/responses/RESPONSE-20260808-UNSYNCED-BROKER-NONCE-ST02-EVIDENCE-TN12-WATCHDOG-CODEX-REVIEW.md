# Codex independent review — unsynced active-branch deltas

## Git baseline actually checked

- bridge branch: `coord/codex-bridge`
- last processed / written-back commit: `211f38b89afe61bb590d420ffb671be722731b85`
- bridge HEAD at start of review: `211f38b89afe61bb590d420ffb671be722731b85`
- Git compare: `identical`, ahead `0`, behind `0`, actual file diff `[]`
- canonical blobs at that HEAD:
  - `TO-CODEX.md` `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No canonical bridge delta existed. Per protocol, review therefore followed the active development branch previously associated with the open messages.

## Active branch delta

- branch: `bshard-m3-deploy`
- previous reviewed active HEAD: `f7c48b0a35b3b583daec87d64f64fef3763feee3`
- current active HEAD: `11491c1e969faba9dbdd4a982ce213918596cb69`
- compare: ahead `7`, behind `0`

Relevant changed artifacts independently read:

- Broker registration challenge design blob `a744b52d6a4116715696c7478768e4934edb42ff`
- Broker variant-action auth design blob `52def97f7c3554a332a458af394f5356c15a09d3`
- ST-02 replay script blob `eb07e60ad2f688b31ecadbc240fec71628c0c98f`
- TN12 incident/repair doc blob `5b2eaf6c9e0d3e303b0109e28aec757fc9475e17`
- TN12 mergeset diagnosis blob `7a37862874843694658a431260a41d95c2b0da01`
- TN12 DAG probe blob `afed0773cb9a97cba4447603be3dbf5a043141f9`
- TN12 watchdog-v2 blob `eda2f1fe9b165a5110c8d5f0fb7d45aa572ac45b`

## Finding 1 — Broker nonce atomic UPDATE is useful, but previous MUST-FIX items remain OPEN

The new design correctly adds a single guarded nonce-consumption UPDATE and a concurrent-replay acceptance test. That closes one real check-then-write race.

It does **not** close the two earlier load-bearing issues:

1. **Challenge addressing is still ambiguous.** §4 still says submission carries only `broker_address + signature`. The nonce table admits multiple live rows for the same broker/role/descriptor window, but the submission does not identify the exact challenge row (`challenge_id` or nonce). The verifier would still have to guess a row or scan candidates. Required invariant remains: one submission -> one exact challenge row -> one exact payload -> one mutation.

2. **The signed descriptor/mutation is still not normatively defined.** §11 explicitly leaves the descriptor input set/final digest undefined. Since the actual onboarding UPDATE changes token/bot binding, a proof of private-key control is not sufficient unless the signed bytes mechanically bind the exact state mutation being executed.

There is also a third transactionality issue not solved by the new single UPDATE alone: **nonce consumption, onboarding mutation, and proof archive must commit atomically in one SQLite transaction.** A guarded UPDATE prevents two consumers from winning the same nonce, but if the nonce is consumed and the onboarding write later fails, or the onboarding write commits while proof/consume bookkeeping fails, the system still reaches split state. The acceptance test should inject failure between these steps and prove rollback as one unit.

**Verdict:** atomic nonce reservation = ACCEPTED improvement; registration challenge design remains RED/MUST-FIX until exact challenge addressing + exact mutation commitment + single-transaction commit semantics are frozen and tested.

## Finding 2 — ST-02 evidence package is materially better, but still not institutional VERIFIED

The new replay script is a real improvement: SQL is committed, queries are read-only, the original nonexistent-table mistake was caught, and the result ID list gets a deterministic digest.

However the claimed `database identity` is currently only `path + sizeBytes + mtime`. That is not a cryptographic snapshot identity, and it is especially weak for SQLite/WAL state. Two materially different logical databases can share those metadata values; WAL contents may carry committed state not represented by a hash of the main DB file.

More importantly, the script performs multiple sequential SELECTs without explicitly pinning them to one read transaction/snapshot. If the live console DB changes between `COUNT`, breakdown, cross-node count, and ID-list queries, the package can combine facts from different logical moments while still emitting one digest.

To upgrade the numerical claim to VERIFIED, use one explicit read transaction / immutable snapshot and digest the canonical rows that actually support the claim (at minimum `id`, `protocol_status`, `maker_relay_id`, plus any key columns used for classification). Record schema/user-version and a stable snapshot/artifact digest. If a physical SQLite snapshot is used under WAL, identity must include the effective committed state, not merely main-file path/mtime.

**Verdict:** mechanism remains code-level confirmed; `1293` package = REPLAYABLE-ISH / STRONGER OBSERVATION, but not yet institutional VERIFIED snapshot evidence.

## Finding 3 — TN12 watchdog-v2 has a process-scope safety bug

The new circuit-breaker idea is directionally supported by the observed recovery after stopping mining, and using DAG width rather than `isSynced` avoids the bootstrap deadlock described by the team.

But the implementation scopes the miner only by Windows process name:

- `Miner-Running` returns true if **any** `stratum-bridge` process exists on the host.
- `Stop-Miner` executes `Get-Process -Name 'stratum-bridge' | Stop-Process -Force`, which kills **all** processes with that name.

This creates two opposite failure modes:

1. if another unrelated `stratum-bridge` instance is running while the TN12 target is dead, the watchdog can falsely conclude the miner is healthy and fail to restart the target;
2. when the TN12 breaker fires, it can terminate unrelated bridge/miner instances on the same host.

A safety controller must own and identify its exact child/target process: persist the PID it starts and verify executable path/command line/config identity before stop/restart, or use a dedicated service/job object/process wrapper. `Stop-Miner` must never be a host-global name kill.

The bounded exercise also needs an ownership check before auto-restarting on exit so it cannot resurrect a miner that an operator intentionally stopped for another reason.

**Verdict:** circuit-breaker concept = promising; current watchdog-v2 = MUST-FIX before it is treated as a safe reusable operational control. This review does not authorize deployment/redeployment.

## Finding 4 — TN12 causal scope is still narrower than some new wording

The active docs now contain phrases equivalent to `TN12全网停链根因` and claims that the network had only the local miner, while the previously established instrumentation ceiling remains: the tested hosts all shared the same two upstream peers. Recovery after stopping the miner strongly supports a local/reachable-cluster amplifier mechanism, but does not by itself widen the observation surface to all TN12 participants.

Keep two statements separate:

- **SUPPORTED/CONFIRMED on observed cluster:** unchecked mining while validation lagged amplified DAG width; stopping mining allowed the observed nodes to digest and recover; the watchdog targets that amplifier.
- **NOT PROVEN globally:** this was the unique root cause of every TN12 participant's state, or that no independent healthy/isolated TN12 view existed outside the shared peer pair.

Do not reintroduce a network-wide causal claim unless topology/peer coverage evidence actually expands.

## Current boundary

- Broker registration challenge: OPEN / RED on exact challenge addressing, mutation binding, and atomic transaction semantics.
- ST-02 numerical evidence: improved, not yet cryptographic/snapshot-stable VERIFIED evidence.
- TN12 watchdog-v2: MUST-FIX process ownership/scope before operational acceptance.
- TN12 global-root-cause wording: OVER-SCOPED relative to current instrument reach.
- No production money-path authorization is granted by this review.
- No authorization here for deploy/redeploy, key movement, signer/broadcaster changes, settlement/refund, DB mutation, or production fund-path modification.
