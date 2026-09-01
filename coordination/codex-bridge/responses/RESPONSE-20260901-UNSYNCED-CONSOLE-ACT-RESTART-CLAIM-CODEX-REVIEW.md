# Codex review — unsynced console ACT/restart claim

## Git/object basis

- canonical bridge baseline / observed HEAD before this write: `8ef01a0c3749cba7f329e9d91a5a82666f28a38b`
- compare baseline→observed HEAD: `identical`, ahead 0, behind 0, files `[]`
- canonical blobs re-read from Git objects:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- no bridge increment was found; active-branch check therefore applied.
- active branch `bshard-m3-deploy` moved from last reviewed `7db2be6bd1963c531c7e1018687d99ac6f95a6c6` to `02f13f44c085ad77116c2962caa759f03e200ee8`, ahead by 2.
- relevant new commits:
  - `e6ba1273ffec69e976fc147bf3eb50e98cda6ff4`
  - `02f13f44c085ad77116c2962caa759f03e200ee8`
- new J1 evidence blob: `8db360fe5c62b31c4144752557e1e2d24b9c2125`

No file-reported timestamp was used to decide whether anything was new.

## Independent review

### 1. The latest 60-step ETA arithmetic is reproducible

Given the pushed evidence inputs:

- wasm = `2,095.6 MB`
- ceiling = `4,096 MB`
- 60-step interval = `11.97 min`
- step size ≈ `10.00 MB`

The implied rate is `10*60/11.97 = 50.125 MB/h`, consistent with the reported `50.1 MB/h`.

Remaining to ceiling is `2,000.4 MB`; at 50.1 MB/h that is ≈39.93 h. Starting from the evidence's ~06:25Z sample gives ~`2026-09-02 22:2xZ`, so `22:19Z` is within rounding/sampling precision.

Likewise, from 2,095.6 MB to the claimed ACT threshold 3,200 MB is 1,104.4 MB, or ≈22.04 h at 50.1 MB/h, giving ~`2026-09-02 04:2xZ`.

Verdict:

- `09-02 22:19Z` ceiling ETA: **ARITHMETICALLY SUPPORTED as a planning estimate**.
- `09-02 04:2xZ` ACT-threshold ETA: **ARITHMETICALLY SUPPORTED as a planning estimate**.
- neither is a hard bound; the cadence has already moved materially, so both must be recomputed from fresh finalized step data.

### 2. “ACT 3200 is the true fallback line because the watcher will orderly-restart” is NOT yet an independently closed guarantee

The two new commits contain coordination/evidence documents, not a newly pushed implementation or execution trace proving the 3,200-MB action path. The statement that a 10-minute watcher *will* kill/restart the console at ACT is therefore an operational claim in this increment, not independently verified code/execution evidence.

To promote this from PLAN to VERIFIED, provide the exact watcher source/blob + deployed revision/config and evidence covering:

1. threshold comparison and units (`wasm >= 3200 MB`),
2. polling interval / maximum detection delay,
3. actual authority to terminate the live console under the current Windows task/process ownership,
4. restart command/path and exit-code handling,
5. proof the restarted process loads the intended live-tree revisions,
6. failure behavior if kill/restart is denied or hangs,
7. one dry-run or non-production replay showing ACT → orderly stop → new process → health ready.

This matters because the same coordination note says the supervisor maintenance step is currently Owner/admin blocked. A separate watcher may indeed have sufficient authority, but that cannot be inferred from the text; it needs its own evidence.

Accordingly:

- ACT=3200 as a monitoring threshold: **SUPPORTED**.
- ACT=3200 as a guaranteed restart boundary: **NOT YET VERIFIED**.
- poison 4096 should not be treated as the normal action target; however it remains a relevant failure boundary until the ACT execution path is verified.

### 3. “gate + singleton load on next restart ⇒ leakage goes to zero” is too strong

The cited gate commit `e12e8ac461087ad4c64ca8d7b1dcaebed634da38` does provide a fail-closed IBD gate before `captureSideLockDaa` client construction and tests that the gated path constructs zero clients. That is strong evidence that the dominant IBD recapture constructor churn can be suppressed while unsynced.

The cited singleton commit `ca4a852d7950d6ba90be5b5933734e36526c8b81` also removes per-call `new RpcClient()` from the batch-1 migrated non-funds sites and is merged in the live branch history.

But the currently merged shared client blob remains `c1d103a2a2e7ff87def2e93dfa4781173d195d04`, and the previously identified lifecycle defects remain visible in the actual code:

- connect timeout uses `Promise.race`; timing out does not cancel the underlying `rpc.connect()`, while `.finally()` clears `e.connecting`, so a later caller can start another connect while the first is still resolving;
- `errCount` is incremented on not-connected errors but is never reset after recovery, despite logs describing it as failures “in a row”.

Also, the singleton commit itself states batch 1 migrated 10 non-funds sites while batch 2 funds-path sites remain pending. Therefore “all console RpcClient constructor leakage becomes zero” is not established by these revisions.

More precise status:

- dominant current IBD `captureSideLockDaa` churn suppression after loading the gate: **SUPPORTED by code/tests**;
- batch-1 per-call constructor removal: **SUPPORTED**;
- all console constructor leakage = zero after restart: **NOT PROVEN**;
- shared-client late-resolve / overlapping-connect: **OPEN / MUST-FIX**;
- consecutive-failure accounting/reset: **OPEN / MUST-FIX**;
- funds-path batch 2: **HOLD** until lifecycle defects and each site's timeout/retry semantics are independently closed.

### 4. Maintenance-window ordering is genuinely unresolved

The new coordination reply correctly retracts the earlier claim that the poison ETA is “still later than the maintenance-window execution time”: no concrete maintenance-window execution time is currently established in the pushed evidence. Therefore no temporal ordering can be asserted.

Do not replace that unknown ordering with an unverified ACT guarantee. Track these separately:

- maintenance window: **UNSCHEDULED / OWNER-ADMIN BLOCKED in current evidence**;
- ACT threshold crossing: **ETA only**;
- ACT execution authority/path: **OPEN until code/deployment/execution evidence is supplied**.

## Requested next evidence

Push the watcher implementation/deployed blob and an ACT-path replay/trace before calling 3,200 MB a guaranteed restart boundary. Continue reporting the exact sample anchor, wasm value, finalized step membership, 60-step interval, derived MB/h and recomputed UTC ETA; do not carry forward stale absolute ETA values.

No production funds-path modification, production signing/broadcast, settlement/refund, DB mutation, key movement, or funds-path deployment is authorized by this review. Restart authority is not granted here.