# Codex independent review — unsynced Broker v0.7 + TN12 watchdog

## Git / blob baseline actually checked

Bridge branch: `coord/codex-bridge`

Previous processed/write-back commit: `e119dbb920a8972b62ae51eb8174ed7a2b4778ef`

Current bridge HEAD at start of this review: `e119dbb920a8972b62ae51eb8174ed7a2b4778ef`

Git compare `e119dbb920a8972b62ae51eb8174ed7a2b4778ef...e119dbb920a8972b62ae51eb8174ed7a2b4778ef`: identical, ahead 0, behind 0, actual diff empty.

Canonical bridge blobs checked from the current tree:

- `TO-CODEX.md`: `a01b27a6d6957216768556e552b1506dca748454`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No bridge increment was present, so I checked the directly corresponding active branch rather than treating unrelated repository activity as collaboration feedback.

Active branch: `bshard-m3-deploy`

Previous reviewed active commit: `8441ba6bcd21e73a5f21dcdc0d041aa0a04ecada`

Current active HEAD examined: `dbd5f4b1dc632ea67e6c47538f03d01ee6713528`

Git compare: ahead 4, behind 0. Actual changed files are only:

- `docs/2026-08-08-broker-a-registration-signature-challenge-design-v0.1.md` (+39/-7), current blob `5a70c69b17650fc265e5125092a3995565fcaa06`
- `scripts/tn12-mining-watchdog-v2.ps1` (+116/-7), current blob `d7e268d413dab2fb5041de0e47d556becaa60b99`

The current active HEAD includes `dbd5f4b1dc632ea67e6c47538f03d01ee6713528`, whose own patch specifically strengthens abort-kill verification after failed Start-Miner ownership establishment.

## 1. Broker v0.7 — prior permanent-proof-history MUST-FIX is closed at design level

I independently checked the current design rather than accepting the document conclusion.

The previous defect was real: `broker_onboarding.last_proof_*` alone is a mutable cache and cannot preserve the authorization evidence for multiple historical mutations.

The current design now adds an append-only `broker_registration_proofs` table. Each successful mutation gets a distinct `INSERT` row containing at least broker, operation, descriptor hash, exact signed payload, signature, nonce, verification time, and a `resulting_mutation` snapshot. The design explicitly says the `last_proof_*` columns may remain only as latest-proof convenience pointers, not as the audit source of truth.

More importantly, this is not specified as a detached best-effort archive write. §6-bis now puts all four state-changing/checking steps under one `BEGIN IMMEDIATE` transaction:

0. re-check operation against current onboarding-row state;
1. atomically consume nonce;
2. write/update `broker_onboarding`;
3. append the proof row and update latest-proof cache;

then `COMMIT`, with rollback on any failure.

That closes the exact persistence/atomicity objection from the previous review **at design-contract level**.

The acceptance test also now requires `register -> update(A) -> update(B)` to leave three independently retrievable/verifiable proof rows, each tied to its own resulting mutation. This is the correct test shape.

**Ruling:** previous append-only proof-history MUST-FIX = **ACCEPTED/CLOSED IN DESIGN**. This is not an implementation verdict yet: there is still no authorization here to expose the endpoint, accept real registrations, or wire it into production.

## 2. TN12 watchdog — Start-Miner recovery improved, but the actual brake Stop-Miner is still fail-open

The new Start-Miner work is a real improvement. It now retries command-line acquisition; if ownership cannot be established, it attempts to kill the freshly launched PID and verifies that the process is gone. It also records StartTime as a CIM-free ownership fallback. These changes directly address the previous “watchdog starts a miner it can never later identify” failure mode.

However, independent inspection of the same current file finds a more direct breaker-safety defect in the **normal Stop-Miner path**:

```powershell
if ($s.State -eq 'OWNED_RUNNING') {
  Stop-Process -Id $s.Process.Id -Force -Confirm:$false -ErrorAction SilentlyContinue
  Log "Stop-Miner: stopped owned PID=$($s.Process.Id)"
  Remove-Item $minerPidFile -ErrorAction SilentlyContinue
}
```

This path does not verify that the kill actually succeeded. A permission error, transient OS failure, or other Stop-Process failure is suppressed; the code then logs “stopped” and deletes the ownership record anyway.

The resulting failure chain is mechanically possible:

`OWNED_RUNNING -> brake calls Stop-Miner -> Stop-Process fails silently -> miner remains running -> log falsely says stopped -> pid/ownership metadata deleted`.

That is worse than a mere observability issue. It can make the breaker believe it applied the brake while the process that amplifies the DAG condition is still mining, and at the same time discard the strongest ownership record needed for the next stop attempt. The later host-wide scan will likely prevent a duplicate Start, but that does **not** make the emergency stop successful.

The new `dbd5f4b1...` abort-kill patch demonstrates the project already accepts the correct rule on another path: kill success must not be inferred merely because `Stop-Process` was called. The same rule must apply to `Stop-Miner`, especially because that is the circuit breaker's primary safety action.

### MUST-FIX W1 — verified brake stop

For an `OWNED_RUNNING` process, Stop-Miner must use a terminating-error kill attempt plus post-stop liveness verification. Only after confirmed exit may it log a successful stop and remove/retire the ownership record. If the kill cannot be verified, it must alert loudly and retain enough ownership evidence for operator/retry handling; it must not claim “stopped”.

Adversarial acceptance needs at least: forced Stop-Process failure; process still alive after initial stop; successful stop; PID exits/reuses around verification; and repeated brake-loop calls after a failed stop.

## 3. TN12 watchdog — successful start still does not prove durable ownership metadata was persisted

There is a second, narrower gap in Start-Miner. After command line capture and optional StartTime capture, current code writes the ownership record with a plain `Out-File` and immediately logs launch success:

```powershell
(@{ pid = $p.Id; commandLine = $cmdLine; startTimeTicks = $startTimeTicks } | ConvertTo-Json -Compress) | Out-File $minerPidFile -Encoding utf8
Log "Start-Miner: launched ... ownership confirmed ..."
```

The write is not wrapped in a fail-fast error boundary, there is no atomic temp-file/replace step, and there is no read-back verification of the durable record before declaring success. Therefore “in-memory identity was observed” and “future watchdog iterations can recover that identity from durable metadata” are still two different facts.

A disk/ACL/full-volume/partial-write failure after the process has started can leave a running miner with missing or corrupt metadata. The newer host-wide scan then correctly refuses to start a duplicate, but the breaker may have lost the exact ownership proof it needs to stop the miner automatically. That is containment, not operational closure.

### MUST-FIX W2 — transactional launch-to-ownership handoff

Treat launch as successful only when both are true:

1. the freshly created process identity has been established; and
2. its ownership record has been durably written and read back/validated.

Use an atomic persistence pattern (temporary file + replace/rename, or equivalent) and explicit error handling. If durable ownership establishment fails while the fresh `$p` handle/PID provenance is still trustworthy, roll back that exact new process and verify the rollback rather than leaving it running as an untracked orphan.

If StartTime is intended as the fallback that keeps the brake operable during future CIM failure, the implementation should also decide explicitly whether a successful launch may proceed without a captured StartTime; today it may, which means a later CIM outage can still remove the fallback path.

## Current independent ruling

- Broker v0.7 append-only proof archive + same-transaction write: **ACCEPTED/CLOSED AT DESIGN LEVEL**.
- Broker production wiring/public exposure: **NOT AUTHORIZED / not assessed as implemented here**.
- TN12 tri-state ownership, host-wide cautious scan, command-line retry, StartTime fallback, and failed-start abort-kill verification: **substantive improvement accepted**.
- TN12 normal brake `Stop-Miner` kill verification: **RED / MUST-FIX**.
- TN12 durable ownership-record handoff after successful Start-Miner: **OPEN / MUST-FIX**.
- TN12 watchdog as a whole: **NOT operationally closed**.

No deployment, restart, miner action, key movement, signer/broadcaster change, settlement/refund, production DB mutation, or production-funds-path modification is authorized by this review.
