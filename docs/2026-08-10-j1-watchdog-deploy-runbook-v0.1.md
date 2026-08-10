# TN12 mining-watchdog deployment runbook (Owner GO 13:2x)

> **Status**: CURRENT
> Author: J1tn · 2026-08-10 · Gate contract = `docs/2026-08-10-j1-watchdog-deploy-preregistered-criteria-v0.1.md` (`fa22cfed`, approved by Bettor)
> 🔴 Execution waits on Codex's ~14:08Z round confirming no eighth square. This file is the prepared plan, run in advance so the deployment itself is mechanical.

## Pre-flight, already done (read-only, 13:3x)

| # | Check | Result |
|---|---|---|
| P1 | drift-check channel reachable | ✅ scan completed, 393 matched / 12 drifted, and it reports the mining-watchdog drift deployment is meant to close |
| P2 | 🔴 **deployed probe emits `virtualDaaScore`** | ✅ present. **Load-bearing and not in the A-list**: the new pay-for-itself gate reads it; an older probe without it would make every pulse read "unknown", halt, and leave the miner stopped |
| P3 | mining-watchdog instances on target | ✅ exactly **1** (PID 28080, since 08-09 15:37 local) |
| P4 | miner + ownership record | ✅ miner PID 15328; `_watchdog_miner.pid` present with pid + commandLine + startTimeTicks ⇒ the new instance will read it as `OWNED_RUNNING` and **not** start a second miner |
| P5 | operator pause file | ✅ absent (`_MINER_PAUSED.txt`) |
| P6 | local self-verification of the bytes to be shipped | ✅ `ParseFile` clean · test suite **46/46** · sha256 `1a232417d632…`, 76154 bytes |
| P7 | stale `kaspad-watchdog.ps1` instances | 5, **not touched** — different script, different owner, separate card |

## 🔴 A0 — a step my own A-list was missing, added during preparation

**Parse-check the new file ON THE TARGET before it reaches the live path.**

If the file fails to parse there, the watchdog dies at startup and the miner runs unsupervised —
the exact outcome this component exists to prevent. My local `ParseFile` passed, but that is *my*
machine's reader; the file carries emoji in comments and has no BOM, and PowerShell 5.1 decodes a
BOM-less file by the host's ANSI code page. That bit me twice today on the test file, where the
parser reported a missing brace 200 lines away from the real cause.

⇒ Stage first, parse there, and only then promote. A bad file never touches the live path, and a
parse failure costs nothing because the old watchdog is still running at that moment.

## Execution order (only after the Codex gate)

```
1. copy  scripts/tn12-mining-watchdog-v2.ps1  ->  D:\kaspa-tn12-mining\_staged-watchdog.ps1
2. on target: ParseFile the staged file        -> must be clean, else STOP (nothing has changed yet)
3. on target: hash the staged file             -> must equal 1a232417d632…  (content, not mtime)
4. promote:   _staged-watchdog.ps1  ->  tn12-mining-watchdog-v2.ps1
5. stop PID 28080, then VERIFY it is gone      -> not assumed gone (A4)
6. start via WMI, NOT Start-Process:
      Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
        CommandLine = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden
                       -File D:\kaspa-tn12-mining\tn12-mining-watchdog-v2.ps1' }
   6b. 🔴 verify it is still there from a NEW ssh session -- started is not alive
7. verify A1-A5 (below), then report readings, not conclusions
```

🔵 Steps 1-3 are reversible and change nothing live. The first irreversible step is 4.

## 🔴 What actually went wrong at execution (14:09Z) — read this before the next deployment

Step 6 originally said `Start-Process`. **It started, logged its banner, and was gone by the next
ssh call.** A process started with `Start-Process` from an SSH-invoked PowerShell is a child of
that session and dies with it. For about 70 seconds (14:09:11Z → 14:10:21Z) there was **no
watchdog at all** and the miner ran unsupervised — precisely the outcome this component exists
to prevent, caused by the deployment of the component.

🔨 This is the same shape as fault mode ② in my own handoff file (a session-scoped background
process is reaped at the session boundary). That entry describes the Claude Code turn boundary;
this was an SSH session boundary. **I recognised the shape and did not recognise it wearing a
different shell.** The information needed to avoid it was already in my own notes: the previous
instance (PID 28080) had been started via WMI Create precisely because it is genuinely detached.

⇒ Step 6 now uses `Invoke-CimMethod Win32_Process Create`, and step 6b requires re-checking from
a **new** ssh session. **"It started" and "it is running" are different readings**, and the first
one is what a deployment naturally produces.

## A1–A5 verification, with the exact string to look for

| # | How | Expected |
|---|---|---|
| A1 | `check-deployed-drift.mjs` with `DRIFT_SSH` | `tn12-mining-watchdog-v2.ps1` no longer in the drift list |
| A2 | tail `_watchdog.log` | `watchdog v2 started (brake>220 resume<50 poll=30s threads=1 maxRounds=0 cliff=248)` |
| A3 | same log | **no** `MISCONFIGURED BACKSTOP` line |
| A3b | same log | **no** `CONFIG REJECTED` line (new config-domain check; silence here means every env override is unset or in-domain) |
| A4 | process list | exactly **one** `tn12-mining-watchdog-v2.ps1`, and PID 28080 confirmed absent |
| A5 | process list | `stratum-bridge.exe` still running — ideally still PID 15328, since the ownership record should stop the new instance from starting a second one |

## What I will NOT claim afterwards

Per the approved gate contract: the DAG has been at tips=1 for over 13 hours, so the brake will
most likely not engage at all after this. **A quiet log is reported as "not yet exercised" and is
not a pass.** Success requires at least one observed brake episode under real load, and if none
occurs the honest report says so.
