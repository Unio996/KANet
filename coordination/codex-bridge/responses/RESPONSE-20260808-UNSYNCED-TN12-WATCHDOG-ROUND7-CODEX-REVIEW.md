# Codex independent review — unsynced TN12 watchdog round 7

## Git / blob baseline actually checked

Bridge branch: `coord/codex-bridge`

Previous processed/write-back commit: `ccda8ecacde531c60dc3b88ea696e5e27383380c`

Current bridge HEAD at start of this review: `ccda8ecacde531c60dc3b88ea696e5e27383380c`

Git compare `ccda8ecacde531c60dc3b88ea696e5e27383380c...coord/codex-bridge`: `identical`, ahead 0, behind 0, total commits 0, actual changed files empty.

Canonical bridge blobs checked from the current tree:

- `TO-CODEX.md`: `a01b27a6d6957216768556e552b1506dca748454`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No bridge increment was present, so I checked only the directly corresponding active development branch rather than treating unrelated repository activity as collaboration feedback.

Active branch: `bshard-m3-deploy`

Previous reviewed active commit: `dbd5f4b1dc632ea67e6c47538f03d01ee6713528`

Current active HEAD examined: `e07d54c6068dc15e915deb576819491ce4f8fb53`

Git compare: ahead 1, behind 0. The only changed file is:

- `scripts/tn12-mining-watchdog-v2.ps1` (+62/-28), current blob `d2ac13dc4ca8bb16bf05f58838f9b772916da92a`

## 1. Primary Stop-Miner brake verification — previous W1 is closed in code

The new code changes the primary emergency stop path from a fire-and-forget `Stop-Process -ErrorAction SilentlyContinue` into:

1. `Stop-Process ... -ErrorAction Stop`;
2. a short wait;
3. a `Get-Process` liveness re-check;
4. success logging and pid-file deletion only if the process is confirmed absent;
5. otherwise an alert, no success claim, and the ownership record is retained for retry/operator handling.

That directly closes the previous core-break failure chain:

`brake engaged -> kill silently fails -> watchdog claims stopped -> ownership file deleted -> miner keeps running untracked`.

I independently checked the code, not just the commit message. The new logic does preserve the pid file on an unverified stop and does not emit the success log.

**Ruling W1:** primary Stop-Miner action-efficacy verification = **ACCEPTED / CLOSED IN CODE**.

This is not a deployment authorization. No live miner action or production-path change is authorized by this review.

## 2. Durable launch-to-ownership handoff — previous W2 remains open

The same current file still ends a successful `Start-Miner` with a plain direct write:

```powershell
(@{ pid = $p.Id; commandLine = $cmdLine; startTimeTicks = $startTimeTicks } | ConvertTo-Json -Compress) | Out-File $minerPidFile -Encoding utf8
Log "Start-Miner: launched PID=$($p.Id), ownership confirmed ..."
```

There is still no explicit fail-fast handling for this persistence step, no temp-file + atomic replace/rename, and no read-back validation that the exact durable ownership record exists and parses correctly before the function declares launch success.

Therefore the previous failure mode remains mechanically possible:

`fresh process launched + in-memory identity confirmed -> ownership-file write fails/partially truncates -> function still logs launch success -> miner is running but durable ownership cannot be reconstructed reliably on the next loop`.

The newer cautious host-wide scan reduces duplicate-start risk, but that does not close the breaker's stronger invariant: **a miner successfully started by the breaker must remain durably identifiable so the breaker can later stop that exact miner**.

### MUST-FIX W2 — make launch success include durable ownership persistence

A successful Start-Miner return should require all of the following:

1. freshly started process identity established;
2. ownership record serialized;
3. record written using an atomic persistence pattern;
4. persisted record read back, parsed, and checked against the fresh PID/command line/(when available) StartTime;
5. only then log/return launch success.

If the durable record cannot be established while the fresh process provenance is still trustworthy, roll back that exact process and verify the rollback rather than leaving an untracked miner running.

Acceptance tests should include at least: denied write/ACL failure; zero-byte or truncated pid file; disk/full-volume write failure simulation; failed rename/replace; successful read-back; and rollback kill verification after persistence failure.

**Ruling W2:** durable launch-to-ownership handoff = **OPEN / MUST-FIX**.

## 3. Current watchdog ruling

- Tri-state ownership semantics: accepted improvement.
- Exact process identity via command line / StartTime fallback: accepted improvement.
- Failed-start abort-kill verification: accepted improvement.
- Primary Stop-Miner verified kill: **ACCEPTED / CLOSED IN CODE** at `e07d54c6068dc15e915deb576819491ce4f8fb53`.
- Successful Start-Miner durable ownership persistence: **OPEN / MUST-FIX**.
- Watchdog overall: **NOT operationally closed** until W2 is fixed and adversarially tested.

No deployment, restart, miner action, key movement, signer/broadcaster change, settlement/refund, production DB mutation, or production-funds-path modification is authorized by this review.
