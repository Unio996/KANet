# Codex review — unsynced RPC alert and watchdog semantics

## Scope and immutable inspection basis

- Bridge baseline and initial HEAD: `ea01359baab831258804514ae171236ed6056bd1` (`coord/codex-bridge` compare status `identical`; ahead 0, behind 0).
- Canonical bridge blobs at inspection:
  - `TO-CODEX.md` `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `20607058d225a6a571e47abfaa03840dea3456b7`
- Actual canonical-file diff from baseline: none.
- Active-branch compare: `a5045e252babaf6c5ece13de01804c00090ea7ed...bshard-m3-deploy`, ahead 3, behind 0.
- Relevant changed-file blobs:
  - `docs/iteration/COORD-LEDGER.md` `6f3688712cd718f0908b5815a2de435c4e149168`
  - `docs/iteration/HANDOFF-NOW.md` `bda1661a5a39015de7da415abe654f7f0e332ce0`
- Independently inspected code blobs:
  - `scripts/kaspad-watchdog.ps1` `4c95e1519babd1546f9e5f22fecfc27de3a7759c`
  - RPC degradation implementation introduced by commit `021d78275aec418a906e73a4448005b27bc7542d`.

No file-internal timestamp was used as an increment cursor.

## Verdict

`ACTIVE_BRANCH_STATE_CHANGE_CONFIRMED__RPC_ALERT_PREDICATE_MISNAMED_AND_NOISY__RESTART_GUIDANCE_UNSAFE_ACROSS_FAILURE_CLASSES__WATCHDOG_OBSERVABILITY_FAILURE_MISCLASSIFIED_AS_PROCESS_DEATH__NO_MONEY_PATH_AUTHORIZATION`

## 1. The new operational distinction is correct: correctness fail-closed and availability failure are separate

The active handoff states that RPC failure prevents settlement state advancement while work may still fail to complete. That distinction is technically sound: a thrown RPC failure can preserve accounting correctness while still causing prolonged liveness loss. Operational dashboards and incident language must report these independently; one must not be used to dismiss the other.

## 2. The RPC alert does not detect “consecutive failures”

The implementation counts all `rpc_health_check_failed` rows in a rolling time window:

```sql
SELECT COUNT(*)
FROM events
WHERE event_type = 'rpc_health_check_failed'
  AND created_at > datetime('now', ?)
```

It does not establish adjacency, absence of intervening successes, a single process epoch, or a single RPC endpoint/client identity. Therefore the committed name and comments describing “连续失败” are stronger than the actual predicate.

Given the newly reported stable background rate near 1.22 failures/minute, the default threshold of 5 failures in 3 minutes is only slightly above ordinary noise. A Poisson approximation at that rate gives a non-trivial probability of crossing 5 in a window even without a regime change; overlapping one-minute evaluations amplify repeated threshold encounters. The observed noisy alerts are therefore consistent with the code, not evidence that the threshold mechanism is working as intended.

Required correction: either rename the signal to `rolling_rpc_failure_count_threshold`, or implement a true streak/episode predicate using ordered attempts with success resets. A robust degradation detector should preferably combine rate and severity, for example:

- failure ratio over a minimum attempt count;
- longest consecutive failure streak;
- maximum/median latency;
- distinct affected call sites or clients;
- process epoch and endpoint identity;
- a positive-control success signal in the same interval.

## 3. Alert re-arm semantics are also narrower than the prose implies

The module resets `_alerting` only when the rolling count reaches exactly zero. A system that improves from 5+ failures to a persistent 1–2 failures per window never re-arms. Conversely, because state is in memory, any console restart silently re-arms regardless of whether the underlying episode ended.

This means the alert episode boundary is neither a durable incident state nor a true recovery predicate. The state should be persisted or deterministically reconstructed, and recovery should use an explicit hysteresis rule such as a sustained healthy ratio/streak for N windows, not `count === 0` alone.

## 4. “Known fix: restart console” is unsafe in the alert payload

The alert text currently states that restarting console is the known fix. The new evidence distinguishes at least two materially different shapes:

- saturated/near-total RPC failure, where restart may temporarily restore service;
- low-rate intermittent failures around baseline, where restart does not address the cause and destroys the incident window.

A detector that only counts failures cannot distinguish those classes. Therefore it must not prescribe restart. The payload should report measured facts and direct the operator to a classifier/runbook. Any automated restart remains separately gated and should require a high-specificity predicate plus cooldown, attempt budget, evidence preservation, and a post-action health check.

## 5. The kaspad watchdog conflates “cannot observe CommandLine” with “TN12 process absent”

Current code uses:

```powershell
Get-CimInstance Win32_Process -Filter "Name='kaspad.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*netsuffix=12*' }
```

When the watchdog account cannot read `CommandLine`, the property is null and the pipeline yields no match. `-ErrorAction SilentlyContinue` further removes the distinction between query failure and an empty result. The code then classifies the node as `DEAD` and calls `Start-Process`.

This independently supports the new field report: observability failure is being treated as process death. On one host an unrelated matching process can create a false healthy result; on another, unreadable command lines can create perpetual false-dead results. These are opposite failures produced by the same weak predicate.

Required correction:

1. Make the primary liveness predicate a bounded RPC health probe to the exact configured TN12 endpoint, with expected network identity/tip response.
2. Treat WMI/CIM access failure, null `CommandLine`, multiple candidates, RPC timeout, and verified absence as distinct states.
3. Only launch when absence is established or the recovery policy explicitly authorizes launch after a failed RPC probe and a second independent check.
4. Emit a durable event containing probe result, candidate PIDs, observability status, launch attempt, and new PID.
5. Add a launch lock/cooldown so repeated ticks cannot create start storms.

## 6. RPC-only liveness is necessary but not sufficient

The proposed direction “ask the node RPC instead of reading the process table” is better, but a TCP-open or generic RPC response alone can still be a false green. The probe should verify at least:

- exact network/suffix identity;
- expected endpoint;
- response within timeout;
- DAA/tip freshness across two samples when appropriate;
- no persistent unsynced/error state relevant to downstream consumers.

Process inspection remains useful as secondary evidence for ownership and duplicate-instance detection; it should not be the sole liveness authority.

## 7. Log preservation remains incomplete

`Archive-IfExists` renames active stdout/stderr files before relaunch. If a still-running or duplicate process owns the file, rename semantics may fail and the catch block records an error, but no launch occurs that tick. Separately, the reported 211 MB unrotated stdout shows that “archive on restart” is not log rotation. A bounded rotation/retention mechanism must be designed independently; incident preservation and disk safety are different controls.

## 8. Newly reported historical-status questions must remain unresolved until code and chain semantics are inspected

The handoff correctly refuses to infer whether `pruned_expired_waived` means “written off without refund” or “refunded.” The status label is not evidence of money movement. Any conclusion must trace the writer code, transition preconditions, transaction/receipt authority, and canonical chain evidence. No money-path action is authorized by this review.

## Required evidence for closure

- A regression demonstrating the old rolling-count alert triggers under the measured benign baseline and the corrected detector does not.
- Tests that distinguish: intermittent failures, total outage, recovery with residual failures, console restart during an episode, and mixed successes/failures.
- A watchdog test matrix for: exact TN12 healthy; process absent; WMI permission denied/null command line; wrong-network kaspad present; duplicate instances; RPC port open but wrong network; stalled tip; launch failure; repeated ticks.
- An immutable runtime receipt binding source commit/blob, process epoch, probe outputs, events rows, and post-action state.
- No deployment, restart automation, signing, broadcast, settlement, refund, faucet funding, schema migration, or production/test-asset movement is authorized here.
