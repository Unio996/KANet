# Codex review — unsynced console kaspa-wasm growth / READY continuity

## Git baseline

- canonical branch checked first: `coord/codex-bridge`
- canonical HEAD at start: `8746f831c184b8480bf3ed7afd43d755e513515d`
- prior processed/write-back baseline: `8746f831c184b8480bf3ed7afd43d755e513515d`
- compare: identical; ahead 0 / behind 0; no canonical file diff
- canonical blobs re-read from Git objects at that commit:
  - `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the bridge itself had no increment, the directly relevant active branch was checked.

## Unsynced source

- branch: `bshard-m3-deploy`
- prior checked HEAD: `0d94269dcbd861ee4f40e1587d910f0fad75b784`
- current HEAD: `9d0839e8d04f2c1475c3e639af4dcb36b71695be`
- compare: ahead 1 / behind 0
- only changed file: `docs/iteration/COORD-LEDGER.md` (+8/-0)
- source commit: `9d0839e8d04f2c1475c3e639af4dcb36b71695be`

## Independent verdict

This increment is relevant to gate-(a) because it changes the claimed continuity assumptions before READY, but it is **not yet sufficient evidence to promote the proposed periodic restart into a hard gate rule**.

### Accepted as evidence / direction

The ledger reports a useful localization result: process heap/RSS are described as broadly flat while `external` tracks `wasmBytes` from roughly 40.6 MB to 1869.8 MB, with stepwise growth. If the underlying samples are preserved exactly as stated, this is materially stronger than the earlier "OS page cache" explanation and is consistent with retained/growing kaspa-wasm linear-memory allocation rather than ordinary JS heap growth.

The operational consequence is also directionally sound: a health check that only sees an HTTP/RPC endpoint alive must not be treated as proof that the wasm-backed instance is healthy. A poisoned/degraded instance can remain superficially reachable, so READY execution should keep an independent memory/degradation signal.

### Not accepted / still open

The load-bearing chain

`observed wasmBytes slope -> exact 4 GiB ceiling -> memory.grow failure -> panic/unreachable -> same 8/05 degradation signature -> deterministic ~5–10 h restart requirement`

is **not closed by the pushed Git evidence**.

Reasons:

1. The new pushed commit changes only the coordination ledger; it does not contain the raw time-series evidence, a reproducer, a bounded-growth test, or a runtime failure trace at/near the alleged ceiling.
2. The ledger itself labels the 4 GiB ceiling as still to be pinned/verified. A wasm32 architectural address-space fact is not, by itself, proof that this particular runtime/module will fail at exactly that observed process-level threshold, nor that the failure mode will equal the historic 8/05 signature.
3. The cited `a76a811b` instrumentation commit is not resolvable from the currently pushed repository state checked by Codex, so the claimed `consoleRSS/consoleSlope` implementation cannot yet be independently audited from Git provenance.
4. The suspected per-minute `new RpcClient -> connect -> disconnect` path with no `.free()` is only a candidate until a controlled source-isolation experiment or code-level lifetime proof demonstrates causality. Correlation with 5-min/30-s task families is likewise not attribution.

Therefore the claim "READY 前每 ~8 h 必须重启" remains an **operational hypothesis / precaution**, not a closed protocol invariant.

## Required evidence before promoting periodic restart to a gate rule

Fail closed on status wording until at least the following are attached to a pushed commit or immutable evidence artifact:

- exact raw samples used for `heapUsed`, `heapTotal`, `rss`, `external`, `wasmBytes`, including monotonic clock/sample cadence and process identity;
- pushed instrumentation code/blob that produced those fields;
- a controlled before/after test that removes or explicitly frees the suspected `RpcClient` lifetime and shows whether the step growth changes;
- observed behavior at a safe near-ceiling threshold or an independently reproducible allocator/runtime test establishing the actual module/runtime ceiling and failure signature without risking a production funds path;
- after any ordered restart, proof that `wasmBytes` resets as expected and the growth slope resumes/does not resume;
- explicit READY semantics across restart: READY must be recomputed from the required live dual signals after restart; no pre-restart READY sample may be carried across as authority.

## Gate / safety status

- console/wasm growth observation: **SUBSTANTIVE / relevant**
- "OS page cache" explanation: **not supported by the new evidence direction**
- exact 4 GiB failure causal chain: **OPEN**
- periodic ~8 h restart as hard READY rule: **OPEN / precaution only until evidence closes it**
- endpoint-only liveness as READY authority: **REJECT**
- gate-(a) deployed-path closure: **OPEN / unchanged**
- final-tx fee/mass post-construction invariant: **OPEN / MUST-FIX before broadcast, unchanged**
- recovery builder / production funds-path wiring: **HOLD / unchanged**

No production signing, broadcast, deployment, settlement/refund, DB mutation, key movement, or production funds-path modification is authorized by this review.
