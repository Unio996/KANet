# Codex independent review — TN12 watchdog round 8 persistence/abort orphan

## Git baseline actually checked

- bridge baseline/head before review: `a56ca9c257a042484736b086971910ba590a7be2`
- compare `a56ca9c...HEAD`: identical, ahead 0 / behind 0 / files=[]
- canonical blobs:
  - `TO-CODEX.md`: `a01b27a6d6957216768556e552b1506dca748454`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge had no increment, so active `bshard-m3-deploy` was checked from last reviewed `e07d54c6068dc15e915deb576819491ce4f8fb53` to current `5f047249436e72ad8a7a0a5097b0434f1d2069fe`: ahead 1 / behind 0. Only directly relevant diff: `scripts/tn12-mining-watchdog-v2.ps1` (+73/-20).

## What the new commit fixes

The new temp-file -> rename -> read-back path is a real improvement over the previous unchecked `Out-File`. It also correctly reuses one `Kill-AndVerify` helper for abort-kill and main-stop. This closes the narrow prior finding that a successful launch could be reported before any check that the ownership file was actually readable and matched PID/commandLine.

## New MUST-FIX — persistence failure + abort-kill failure deliberately destroys the only recoverable ownership record

Current failure path is:

1. watchdog launches PID `p` and successfully learns exact `cmdLine` (and usually `startTimeTicks`);
2. durable ownership write/read-back fails;
3. watchdog calls `Kill-AndVerify(p)`;
4. if kill is **not verified**, the process may still be alive;
5. code nevertheless executes `Remove-Item $minerPidFile` before branching on `$killVerified`;
6. alert explicitly admits a possible orphan with **NO ownership record** and says automation cannot stop it itself.

That is not fail-closed for a circuit breaker whose invariant is "must always be able to stop what this breaker started." The host-wide scan can prevent a second miner, but it does not restore the brake's ability to identify/stop the orphan that this watchdog itself just created.

### Required rule

For a freshly launched process, the watchdog has strong provenance in memory (`PID`, exact `cmdLine`, and StartTime when available). If persistence verification fails and abort-kill cannot be verified, it must **not intentionally discard that provenance**.

At minimum:

- if kill is verified: clean up ownership artifacts and return;
- if kill is not verified: preserve/recover an emergency ownership record containing the exact just-observed PID/cmdLine/startTime, or enter a latched emergency state that retains those values and permits only stop/reconciliation actions; do not delete the only durable identity;
- no subsequent automatic launch while this unresolved owned-orphan state exists;
- add an adversarial test for `write fails -> kill fails -> process survives` and prove the next watchdog cycle can still target the same process for stop/reconciliation.

This is distinct from the already-accepted "host scan prevents duplicate start" property. Duplicate prevention alone is insufficient; the breaker also needs stop capability over a process it itself launched.

## Additional evidence-quality note

The read-back currently verifies only `pid` and `commandLine`, not `startTimeTicks`. Because `Get-MinerState` uses `startTimeTicks` as the CIM-free anti-PID-reuse ownership fallback, a claimed durable ownership record should verify every field on which future ownership recovery relies. If `startTimeTicks` is present at write time, read-back should verify the exact tick value as well; otherwise the persistence proof is weaker than the later recovery invariant.

## Verdict

- temp/rename/read-back persistence mechanism: **ACCEPTED as structural improvement**
- previous W2 "no persistence verification at all": **CLOSED narrowly**
- persistence-failure + unverified-abort-kill orphan handling: **RED / MUST-FIX**
- full watchdog operational closure: **NOT YET**

No deployment/restart/miner action, key movement, signer/broadcaster change, settlement/refund, production DB mutation, or production-funds-path authorization is granted by this review.
