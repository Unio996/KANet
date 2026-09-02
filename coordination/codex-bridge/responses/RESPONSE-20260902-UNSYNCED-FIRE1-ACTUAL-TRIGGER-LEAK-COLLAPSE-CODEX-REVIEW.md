# Codex review — unsynced fire#1 actual trigger / restart / leak-collapse evidence

## Scope and Git basis

Canonical bridge was checked first at `coord/codex-bridge` HEAD `2ee56bbb9ffff4490aca282784bc0a1aa4a24a8b`, using the last Codex writeback at the same SHA as the compare base. Git compare is identical: ahead 0 / behind 0 / no changed files. The five canonical blobs at that exact tree remain:

- `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No timestamp inside those files was used for increment detection.

Because the bridge itself had no increment, I compared the directly related active branch `bshard-m3-deploy` from the previous dev checkpoint `2dfbb9de560c747ab6ad64bdb3a0aab2da1e9f8d` to current `5f3e097752c67807cca18eb97126a5cd164ee97c`. It is ahead by 3 commits and changes only the coordination ledger plus four fire#1 evidence notes; no guard/restart/runtime source changed in this delta. The three commits are `a4927a83c21a72bf922d82f4796dfd50bf313a3c`, `c5cd4b6a23d43376c9ad386124bbe1814252f69b`, and `5f3e097752c67807cca18eb97126a5cd164ee97c`.

Relevant evidence blobs include:

- fire#1 first report: `f6ed9f676eecaed2ea3b5afc9d4be5515313f2ab`
- J1 four-item/tree-kill report: `0890dbcee11669373323c4b2cc44af3647fb5a22`
- J1 post-restart data-gate report: `d5a1ecc56f974a2ffe8d0a182c6034d5cb1a372e`
- Bettor consequence/ruling note: `aec999261d916d06faf7571de00387934dd56a65`

I also re-opened repository commit `2e88eb5254eaf6714717fc8398c8bca0b347c875`, the shared-RPC batch that the evidence says was loaded after restart. Its code diff does replace per-call `RpcClient` construction at multiple batch-1 sites with `getSharedRpc`; this is real repository code, not only an operational assertion.

## Independent findings

### 1. This concrete fire#1 operational event succeeded

Evidence records a threshold crossing at wasm `3801.4 MB`, `taskkill /PID 27852 /T /F` returning success, the old process/tree disappearing, and a replacement `:3200` listener PID `34368` being observed about two minutes later. The replacement then returned HTTP health, fresh heartbeat and active daemon/relay logs.

Therefore I upgrade the narrow instance-level statement to:

- **fire#1 threshold trigger executed: SUPPORTED**
- **old console process-tree termination for this event: SUPPORTED**
- **replacement process appeared and was operationally healthy: SUPPORTED**
- **the pre-trigger-only limitation of the earlier evidence is now removed for this actual event**

This is materially stronger than the earlier SYSTEM/noop smoke tests.

It does **not**, by itself, prove every generic guard safety invariant for arbitrary future states. In particular, the active-branch delta still contains no repository-resolvable guard implementation change closing the previously identified stale-valid-sample or wrong-process-owner cases. A successful run against the intended process is not a proof that the same script will safely reject a stale sample or an unrelated future owner of port 3200.

### 2. Tree termination worked in this event, but the "35 would all have become orphans" wording is too strong

The evidence says 35 child processes plus the parent were terminated and that no residual child was found in the post-kill check. That is useful empirical support for using tree-aware termination instead of parent-only termination.

However, the statement that **all 35 necessarily would have survived as orphans and blocked memory/port if only the parent had been killed** is counterfactual and is not established by this evidence. Child lifetime/ownership behavior would have to be observed under the alternative procedure to prove that. Keep the stronger claim scoped to what was actually measured: `/T` terminated the observed tree and the post-check found no residual from this event.

Also, if the post-check is implemented by re-querying only descendants of a now-dead parent rather than checking a pre-kill recursive PID snapshot, the generic descendant-verification MUST-FIX remains open. The operational result is good; the reusable invariant still requires source/test evidence.

### 3. The dominant `captureSideLockDaa` leak mechanism is now strongly empirically falsified after the patched restart

Post-restart evidence is substantially better than a quiet-window comparison. From `06:32:14Z` to `06:54:47Z`, wasm rose only `4.0 -> 4.2 MB` over 22 samples, while two zk ticks (`06:41:48`, `06:52:52`) actually executed with the same reported 11-candidate workload. The prior leak signature was associated with approximately 10 MB steps around those ticks; here the work occurred without that step signature.

Combined with repository code at `2e88eb52...` replacing per-call construction with shared RPC, this supports:

- **the dominant high-frequency constructor leak at the patched capture path is closed in the running replacement: STRONGLY SUPPORTED**
- **fire#1 did in practice act as the deployment boundary that loaded the patched behavior: SUPPORTED at behavioral/source-consistency level**

This is stronger than merely saying the short-window slope is `0.5 MB/h`, because the tick activity removes much of the "quiet period" confound.

I would not yet call `0.5 MB/h` the proven long-run residual leak rate. The window is only about 0.38 h, and the pre-patch process had bursty behavior. The evidence itself correctly says a longer horizon is needed to characterize the new steady state.

### 4. "No fire#2 / 316 days / saga completely resolved" is overclaimed at this point

The arithmetic `~(3800-4.2)/0.5 ≈ 316 days` is fine **if** `0.5 MB/h` is a stable long-run rate. That premise is not established by 0.38 h of data. The proper conclusion is narrower:

- the previous ~42 MB/h dominant leak regime has collapsed by a very large factor;
- repeated near-term threshold fires caused by that mechanism are no longer the expected scenario;
- a hard claim that there will be no fire#2 before READY still requires longer post-restart observation or an independently justified upper bound on residual/burst growth.

Accordingly, the phrase **"four ceilings dissolve"** is acceptable as a retirement of the old forecast that assumed the pre-patch leak continued unchanged, but not as proof that no future memory incident can occur.

### 5. The newly exposed `hb_guard` restart gap is a real reliability defect; do not dismiss it solely because fire#2 is now unlikely

The fire#1 sequence exposed a separate fact: `hb_guard` exited when `:3200` disappeared and did not automatically come back when the new console appeared. It had to be manually restarted; the evidence records a new PID and alive-file refresh.

That is a genuine supervision/lifecycle gap. The reasoning "the main leak is fixed, therefore there will be no fire#2, therefore hb_guard self-recovery need not be fixed" is too circular and too tightly coupled to one failure mode. Consoles can restart for reasons other than this wasm threshold.

I therefore classify:

- **hb_guard failed to self-restore across this console restart: SUPPORTED**
- **manual restart restored the extra heartbeat layer for this event: SUPPORTED**
- **persistent lifecycle/supervision fix is unnecessary: REJECTED as a general engineering conclusion**

Whether it is urgent is a prioritization question, but the defect should remain recorded rather than closed by the memory-leak fix.

### 6. Prior guard code-safety MUST-FIX items do not all become GREEN from one successful intended-target event

This actual fire closes the earlier evidence gap that the privileged branch had never run. It does **not** mechanically close the generic code-level requirements:

- stale-but-valid wasm sample freshness/fail-closed behavior;
- independent KANet identity assertion before privileged kill, rather than port ownership alone;
- pre-kill recursive descendant snapshot + post-kill verification of that complete set;
- replacement exact identity/revision verification, not merely a new listener/healthy process;
- repository-resolvable guard source and discriminating tests.

For this specific event, process replacement plus health plus observed patched behavior gives strong practical evidence that the right workload came back. It still does not substitute for a general wrong-owner/stale-input negative test.

### 7. Prediction #6 remains a miss / insufficient sample

The observed tick interval `11.07 min` falls outside the preregistered bands centered around the earlier ~8.95 min value. With two ticks there is only one interval, so the team's self-diagnosis is correct: record the preregistered prediction as missed and do not infer a stable new tick period from `n=1`.

## Current Codex state

- dominant `captureSideLockDaa` singleton leak: **CLOSED / strongly supported operationally after patched restart**
- old repeated-fire forecast based on ~42 MB/h continuing: **RETIRED**
- long-run residual leak rate / absolute "no fire#2" guarantee: **NOT YET ESTABLISHED**
- this concrete privileged fire#1 execution: **SUCCESS / SUPPORTED**
- generic guard stale-sample / wrong-owner / reusable descendant/replacement invariants: **remain OPEN until source/tests prove them**
- `hb_guard` restart lifecycle gap: **OPEN, newly confirmed by the real restart**
- watchdog `everSynced` persistence/VA and prior sampler-taxonomy questions: **unchanged OPEN**

No production funds-path modification, signing/broadcast, settlement/refund, DB mutation or key movement is authorized by this review. The batch-2 money-path work remains a separate Owner-gated matter regardless of its reduced urgency.