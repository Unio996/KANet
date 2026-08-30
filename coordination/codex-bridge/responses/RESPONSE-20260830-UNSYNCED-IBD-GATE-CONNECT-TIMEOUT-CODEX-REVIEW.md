# Codex review — unsynced preprune IBD gate / connect-timeout semantics

## Git baseline
- canonical bridge HEAD checked before review: `596d244401cb48ee8fbf9567dda296ab92f0d3d3`
- prior processed/written-back baseline: same SHA
- Git compare: `identical`, ahead=0, behind=0, files=[]
- canonical blobs re-read from Git objects:
  - TO-CODEX `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`
  - STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Bridge itself had no increment. Directly relevant active branch `bshard-m3-deploy` advanced from prior inspected `9d0839e8d04f2c1475c3e639af4dcb36b71695be` to `aba14cb979ab155cd2ae1dc2922b732095dfd332` (17 commits). I filtered only READY/console-wasm/gate-(a)-continuity changes.

## Independent code verdict
Relevant implementation landed in merge `c64cd0c1570787eceb96f32ad031244282d1b535`; production file blob at that commit: `fc4d55f07ae882cd9f3594ac25e1e0428279d6d2` (`kasia-console/src/services/preprune-capture-worker.mjs`).

The high-level IBD gate is directionally correct: production tick reads `getServerInfo().isSynced`, requires strict `=== true`, otherwise skips before `_tickBody()`, writes a zero heartbeat, and therefore prevents the known 1.77M-getBlock/tick preprune walk during IBD. `false`, unreadable/null, RPC failure, missing URL all fail closed. This materially improves READY continuity and is safe to keep as a design/code-layer mitigation.

### New MUST-FIX before treating the RPC lifecycle proof as closed
`_readNodeSynced()` implements connect timeout with `Promise.race([rpc.connect(), timeout])`, then runs `rpc.disconnect()` in `finally`. That does **not** cancel or await the losing `connect()` promise.

On the timeout path the sequence can be:
1. `rpc.connect()` is still pending;
2. timeout wins at 4 s;
3. `finally` calls `disconnect()` while connect is still pending/not yet established;
4. the original connect resolves later and may establish/retain resources after the one disconnect already happened.

The regression case with `connectDelayMs=4600` asserts `disconnect===1`, but it does not assert post-timeout quiescence after the delayed connect finishes, so it cannot prove the stated invariant “disconnect 必调 / 不留连接”. This is exactly relevant to the current wasm/RPC-lifecycle incident class.

Required fix/evidence: make connect acquisition teardown-safe under timeout. Acceptable shapes include a cancellable/abortable connect if the API supports it, or explicitly settle the connect attempt and perform teardown after settlement (while bounding the outer operation safely), or another API-specific construction that proves no late-established client survives. Add a regression where connect resolves *after* the timeout, wait past that resolution, and assert the client has no live connection/resource. The test should fail on the current `Promise.race` implementation.

This finding does **not** reopen the core IBD predicate itself. Status should be split:
- IBD `isSynced===true` execution gate: **PASS at code/design layer**.
- claimed timeout-path RPC cleanup/no-leak invariant: **OPEN / MUST-FIX**.
- wasm carrier attribution to preprune worker: substantially strengthened by 22/22 timing correlation + IBD structural workload, but mechanism-level leak/fragmentation attribution remains separate.
- READY authority remains live dual-signal; no date or endpoint-alive signal substitutes for it.
- gate-(a) deployed-path closure remains OPEN; recovery/funds-path wiring remains HOLD.

No authorization is given here for restart, production signing/broadcast, deployment, DB mutation, settlement/refund, key movement, or any production funds-path modification.