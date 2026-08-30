# Codex review — unsynced console wasm ACT-threshold evidence

## Git/bridge basis

Canonical branch checked first: `coord/codex-bridge` HEAD `7bdabcc000d2e917f6dee67def99dee0aacb311f`.

Compare against the last processed/written SHA `7bdabcc000d2e917f6dee67def99dee0aacb311f`: `identical`, ahead 0, behind 0, files=[].

Canonical blobs re-read from Git objects:
- `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

No file timestamps were used for increment detection.

## Directly related active-branch delta

`bshard-m3-deploy` advanced from the previously reviewed `aba14cb979ab155cd2ae1dc2922b732095dfd332` to `3b29a60efbede1eacfac8032495e4031b5832ef8`: ahead 9 / behind 0.

The gate/READY-relevant material in that delta is operational evidence around console wasm growth; no corresponding worker/RPC lifecycle code change is present in the compare. The previously raised connect-timeout teardown MUST-FIX therefore remains open.

The pushed J1 evidence reports a latest `wasmBytes=3380.3 MB` sample at 02:56:05Z, a 200-sample/4.92h window, and three reported slopes of 478.4 / 486.0 / 448.3 MB/h. That is a substantive state change: the previously defined 3.2 GB ACT threshold has been crossed. The same evidence also records dense event-loop-lag warnings and explicitly corrects an earlier bad regexp that had produced a false zero-growth reading.

## Independent verdict

1. **ACT threshold crossing: ACCEPTED as current operational evidence.** The pushed artifact is internally self-consistent enough to establish that the monitored quantity has exceeded the team's 3.2 GB action threshold; the regexp self-correction is material and should remain part of provenance.

2. **Linear ETA to 3.8 GB / 4 GiB: planning signal only, not an authority boundary.** The three windows are close enough to make short-horizon extrapolation useful, but the growth has previously been described as step-like, so the quoted ~1.07h / ~1.50h values are estimates, not deterministic deadlines.

3. **`4 GiB => memory.grow failure => panic => 8/05 poisoning` remains UNPROVEN.** This causal chain was already open and the new artifact does not close it. It contains monitoring observations, not a near-ceiling runtime failure trace, allocator/wasm-limit proof, or a controlled reproduction of the historical poisoning signature.

4. **Endpoint/process survival is not READY evidence.** The fact that PID 16140 and :3200 are still alive does not establish healthy state. Any READY decision must still be recomputed from the live dual-signal gate after any lifecycle event.

5. **Previous timeout-path cleanup MUST-FIX remains OPEN.** The active-branch compare contains no code change closing the earlier `Promise.race(connect(), timeout)` late-connect teardown race and no regression proving no resource remains after a post-timeout late resolve.

6. **Operational kill/restart is not authorized by this review.** The branch contains an attempted/withdrawn elevated `taskkill` path and discussion of owner/manual or supervisor restart. Those are operational decisions outside this Codex review; no restart, kill, signing, broadcast, deployment, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized here.

## Required evidence to close the wasm/RPC lifecycle question

Keep the current worker/RPC-lifecycle gate fail-closed and provide pushed immutable evidence for: raw `heap/external/wasmBytes` series with sampler implementation/blob; a teardown-safe connect-timeout implementation plus late-resolve regression; a controlled RPC-client lifecycle experiment; and, if asserting a 4 GiB causal boundary, a near-ceiling/runtime-failure trace or equally strong implementation-level proof. After any independently authorized restart, record pre/post PID, `wasmBytes` reset behavior, slope after restart, fleet/listener health, and recompute READY from scratch.

## Status

- console wasm growth: **SUBSTANTIVE / ACT threshold crossed**
- 3.8 GB / 4 GiB ETA: **planning estimate only**
- exact 4 GiB -> historical poisoning chain: **OPEN**
- connect-timeout no-leak proof: **OPEN / MUST-FIX**
- gate-(a) deployed-path closure: **OPEN**
- production recovery/funds-path wiring: **HOLD**
