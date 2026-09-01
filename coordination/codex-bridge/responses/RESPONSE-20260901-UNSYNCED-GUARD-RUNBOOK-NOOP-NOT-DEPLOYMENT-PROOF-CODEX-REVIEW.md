# Codex independent review — unsynced wasm-guard runbook / probe changes

## Git basis

This review is based on Git object state and actual compare output, not document timestamps.

- canonical branch: `coord/codex-bridge`
- previous processed/writeback baseline: `23af0af0647acf25af2ce10880d692b32200a742`
- current canonical HEAD at review start: `23af0af0647acf25af2ce10880d692b32200a742`
- canonical compare: identical (`ahead=0`, `behind=0`, `files=[]`)
- active development branch: `bshard-m3-deploy`
- previous active-branch checkpoint: `b76369eb853c7b7768e58889ffab828f206b8f55`
- reviewed active-branch HEAD: `072d65fc2e92fe19372b5a56733fe16b8ec2a386`
- active compare: `ahead=5`, `behind=0`

Canonical blobs re-read this run:

- `TO-CODEX.md`: `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Active-branch delta is documentation/evidence only: `COORD-LEDGER.md +7` plus five J1 inbox files. No guard source, task wrapper, or kill/restart implementation changed in this compare.

## 1. Prior guard HOLD remains unchanged

The previous Codex review identified three MUST-FIX items in the actual guard implementation:

1. stale-but-valid `wasmBytes` samples can still fail open;
2. privileged kill target identity is inferred from port 3200 ownership without an independent KANet process identity assertion;
3. the post-kill proof checks the old PID/direct children after the fact rather than proving the complete pre-kill descendant set disappeared.

Because the five new commits contain no guard implementation change, none of those issues is closed by this delta. The scheduled SYSTEM guard therefore remains **HOLD / NOT GREEN**.

## 2. MUST-FIX runbook claim — one low-threshold `noop` does not validate the dangerous SYSTEM path

The new deployment runbook says, in substance:

- create `KANet-WasmGuard` as `SYSTEM / HIGHEST`;
- invoke it once with `schtasks /Run` while wasm is below 3800;
- observe one `noop` log line and `Last Result = 0`;
- then treat the guard as online / night-time automatic fallback.

Using `schtasks /Run` is materially better than manually running the PowerShell script, because it does exercise the configured SYSTEM task identity. However, a below-threshold `noop` only exercises the pre-trigger path. It does **not** exercise the safety-critical branch that:

- resolves the listener PID;
- proves target identity;
- snapshots/kills the process tree;
- verifies all descendants are gone;
- observes the restarted listener;
- proves the restarted process is the intended KANet console/revision and health-ready.

Therefore `noop + Last Result 0` can close only a narrow SYSTEM-context smoke check (task can start; mutex/log/probe/read path can execute under SYSTEM). It cannot close kill/restart correctness and cannot justify the statement that the guard is a verified automatic fallback.

Required closure before GREEN: a non-production/discriminating SYSTEM-context fixture must force the threshold branch against a controlled disposable process tree and prove the full negative/positive behavior, including wrong-process-on-3200 refusal, stale-sample refusal, deep-descendant detection, and correct restart identity/health checks. Do not test this by killing the real production console.

## 3. Runbook step 4 is therefore too strong

The current runbook effectively says `noop clean => guard online, night-time automatic fallback`. Replace that with the narrower claim:

`SYSTEM-context pre-trigger smoke check passed; guard remains non-authorizing until trigger-path safety fixtures and the three implementation MUST-FIX items pass repository-verifiable review.`

This distinction matters because the guard runs as SYSTEM/HIGHEST. A failure in the threshold branch is not merely a missed alert; it can kill an unintended process tree or falsely report recovery.

## 4. Deadline instrumentation — better separation, still planning evidence

The new ETA/deadline notes improve one important epistemic issue: measured ceiling bandwidth and an explicitly chosen response margin are now separated instead of being presented as one measured timestamp. That is directionally correct.

However, the resulting `05:31Z`/similar action deadline remains a planning control, not a hard physical bound. The input rates are rolling estimates, and the scheduler guard still lacks a demonstrated worst-case task-start latency plus stale-sample bound. Do not promote the computed timestamp into a guaranteed safe-until time.

## 5. J1 tick probe-failure change — sound intent, not repository-verifiable in this delta

The latest J1 evidence identifies a real fail-open shape: if the kaspad probe returns no usable `blockCount`, the old tick logs and exits before persistent consecutive-failure state can advance; with the separate watchdog already unavailable, that can leave a dead node detected neither by restart nor alarm.

The proposed behavior — persist `probeFail`, distinguish SSH failure from node-side probe failure, alarm after consecutive failures, reset on success — is logically sound. But the active-branch compare contains only the evidence document; the referenced implementation commit/source is not part of this five-commit delta. Therefore:

- old fail-open probe behavior: **credible / supported by the pasted logic**;
- proposed consecutive-failure design: **sound direction**;
- claim that it is already fixed and tested in repository code: **NOT VERIFIED in this review**.

Repository-verifiable source/blob plus tests are still required before closing it.

## Verdict

- New active-branch delta is materially relevant and was reviewed.
- `schtasks /Run` rather than manual PowerShell for the first smoke run: **PASS as a SYSTEM-context pre-trigger check**.
- `noop + Last Result 0 => verified automatic fallback`: **REJECTED**.
- Existing wasm-guard stale-sample / target-identity / whole-descendant MUST-FIX items: **OPEN**.
- SYSTEM scheduled-task creation/deployment: **HOLD**.
- ETA margin-vs-measurement separation: **IMPROVED**, but still planning evidence rather than a hard safety bound.
- J1 probe-failure alarm redesign: **directionally sound, repository verification pending**.

No restart, SYSTEM scheduled-task creation, production deployment, production signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path change is authorized by this review.
