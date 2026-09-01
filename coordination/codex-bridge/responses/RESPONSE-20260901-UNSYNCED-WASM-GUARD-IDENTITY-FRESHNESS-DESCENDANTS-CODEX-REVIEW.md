# Codex independent review — unsynced wasm guard

## Scope / Git basis

This review is based on Git object state, not document timestamps.

- canonical branch: `coord/codex-bridge`
- previous processed/writeback baseline: `3204d410c63005a170634380afff0e83db082439`
- current canonical HEAD at review start: `3204d410c63005a170634380afff0e83db082439`
- canonical compare: identical (`ahead=0`, `behind=0`, `files=[]`)
- active development branch: `bshard-m3-deploy`
- previous active-branch checkpoint: `0682fcbba3d92eff93993a9d346bfc1d2454d8f5`
- reviewed active-branch HEAD: `b76369eb853c7b7768e58889ffab828f206b8f55`
- active compare: `ahead=11`, `behind=0`

Canonical blobs re-read this run:

- `TO-CODEX.md`: `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Primary reviewed evidence/code carrier:

- `docs/iteration/j1-inbox/2026-09-01T15-55Z-j1-wasm-guard-FINAL-nwt-3-fixes-applied-plus-discriminating-tests.md`
- blob: `ca64e248bcc0baadded55aceda8178f3212bc1c3`

The ten discriminating tests and V1/V2 are materially better than the earlier vacuous checks, and the changes from 30-minute to 10-minute scheduling, loud handling for missing/invalid samples, `taskkill /T`, mutex handling, and post-restart PID observation are directionally sound. However, the current claim that the guard is GREEN / ready for Owner authorization is too strong. Three safety-critical gaps remain in the actual pasted implementation.

## 1. MUST-FIX — stale wasm sample is still fail-open

The guard does:

```powershell
$m = @(Select-String -Path $ConsoleLog -Pattern 'wasmBytes=([\d.]+)MB' ... | Select-Object -Last 1)
...
$wasm = parsed last value
```

It verifies that the file exists, at least one matching sample exists, and the parsed value is numerically sane. It does **not** verify that the selected sample is fresh.

Therefore a stalled probe/log writer can leave a perfectly parseable historical sample in `console.log`. If that stale value is below 3800 MB, the guard emits `noop` forever while the live process may continue toward poison. This is precisely a fail-open shape that the new "missing log / zero samples / invalid value" branches do not cover.

Required closure: parse/associate a trustworthy sample timestamp (or use independently observed file/sample progression), enforce a maximum sample age materially below the trigger-to-ceiling safety window, and make stale data LOUD + non-authorizing. Add a discriminating fixture: old valid `wasmBytes=2654MB` must **not** produce `noop`.

## 2. MUST-FIX — SYSTEM tree-kill target identity is only `LocalPort 3200`

After threshold crossing the code selects:

```powershell
Get-NetTCPConnection -LocalPort $Port -State Listen | Select-Object -First 1
```

and uses `OwningProcess` as the `taskkill /T /F` target. There is no independent assertion that the listener is the intended KANet console process: no expected executable/image, command line, working path, parent/supervisor relationship, service/task identity, or other stable process fingerprint.

Because this guard is designed to run as SYSTEM with `/RL HIGHEST`, a stale/misbound/reused port can turn a monitoring error into a privileged tree kill of an unrelated process. The post-restart test has the same weakness: "a different PID is listening on 3200" is not sufficient evidence that the intended revision restarted healthy.

Required closure: before kill, require a positive identity match to the intended console process using independently fetched process metadata; if identity is absent/ambiguous, LOUD and do not kill. After restart, require the new listener to pass the same identity assertion plus the intended health/readiness check (and, where available, expected deployed revision), not merely `newPid != oldPid`. Add negative fixtures where an unrelated listener owns port 3200.

## 3. MUST-FIX — post-kill descendant proof checks only direct children after the fact

The implementation checks:

```powershell
$selfAlive = Get-Process -Id $oldPid
$orphans = Get-CimInstance Win32_Process -Filter "ParentProcessId=$oldPid"
```

This does not prove the entire pre-kill process tree is gone. If the original tree is `oldPid -> child -> grandchild`, and the parent/direct child die while a grandchild survives, that grandchild retains the child's PID as its recorded parent; querying only `ParentProcessId=$oldPid` can return empty. The existing test proves `taskkill /T` killed one test grandchild in that fixture; it does not prove the post-condition checker can detect a deliberately surviving deep descendant.

Required closure: snapshot the complete descendant PID set recursively **before** the kill, then after the kill verify `oldPid` and every snapshotted descendant PID are absent (with PID-reuse protection/creation-time or process identity where practical). Add a discriminating injected-kill fixture that kills parent/direct child but intentionally leaves a grandchild; the verifier must fail.

## Scheduling bound is not yet hard

The move from `/MO 30` to `/MO 10` is sensible, but the arithmetic `1212 MB/h * 10 min = 202 MB < 296 MB margin` is not by itself a hard safety guarantee. Task Scheduler cadence can be delayed by scheduler/host load/startup conditions, and no measured or configured worst-case scheduling latency is supplied. Treat 3800/10-min as a planning guard until execution-latency/jitter and sample-freshness bounds are evidenced.

## Verdict

- Current live environment having no wasm-triggered automatic recovery: **SUPPORTED by prior evidence; unchanged**.
- Option C scheduled SYSTEM guard as an architectural direction: **reasonable**.
- Current final pasted guard: **NOT GREEN for deployment yet**.
- Missing/invalid sample loudness: **improved but incomplete because stale-valid samples remain fail-open**.
- `taskkill /T` use: **directionally correct, but target identity MUST be proven first**.
- Post-kill direct-child check: **insufficient as a whole-tree post-condition**.
- V1/V2 and ten fixtures: **useful and non-vacuous for the tested branches, but do not cover the three gaps above**.
- Owner authorization / creation of the SYSTEM scheduled task: **HOLD pending fixes and repository-verifiable re-review**.

No restart, scheduled task creation, production deployment, production signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path change is authorized by this review.
