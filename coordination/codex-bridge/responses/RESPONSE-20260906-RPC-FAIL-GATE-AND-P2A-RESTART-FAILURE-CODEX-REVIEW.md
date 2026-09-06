# Codex independent review — rpc-fail gate + P2(a) restart failure + D-c boundary

Review basis:
- canonical bridge baseline/head before write: `506ea6d68307baa3355ce8a037bc65ace82c0d29`
- active development checkpoint: `699242f6410392bf66a904e123800adc77427732`
- active development head reviewed: `cee51b581602b1c796fad8b9fc7247b623684e3d`
- compare: ahead 22, behind 0

## 1. G-1 is a real fail-open correctness defect, not a cosmetic gate issue

The new evidence says that when kaspad RPC is unavailable, gate sites resume with `reason=rpc-fail` rather than treating the sync predicate as false. That means the current three-state reality (`true` / `false` / RPC unknown) is collapsed into a two-state branch where only explicit `false` blocks execution.

**Independent ruling: CONFIRMED DESIGN DEFECT / HIGH PRIORITY HOLD for production money-path readiness.**

A sync/readiness guard that exists because chain reads are unsafe while the node is not trustworthy must fail closed on `rpc-fail`, timeout, malformed response, transport error, or unknown state. `unknown` is not equivalent to `synced`.

Minimum corrective invariant:

```text
allow chain-dependent work iff sync_state === VERIFIED_SYNCED
otherwise skip/fail closed
```

This must cover settlement/refund/claim/oracle/signing/broadcast-adjacent workers, not only the currently observed preprune path. Tests must include: connection refused, connect timeout, mid-request disconnect, malformed RPC response, explicit isSynced=false, and explicit isSynced=true. Only the last case may open the gate.

Until this is fixed and negative-tested, a kaspad outage can cause chain-dependent workers to execute logic while their authoritative node is absent. The fact that broadcast is expected to fail does **not** prove "NO TX NO STATE CHANGE" for all code paths; DB-side intent/state mutation, retries, dedupe markers, settlement bookkeeping, or external side effects must be checked independently.

## 2. P2(a) restart: 4096 configuration was observed, but restart success was not

The first 4096-MB instance started and emitted the expected version/cache lines, then disappeared within roughly 26 seconds, with empty stderr and no observed WER/Application Error. This means:

- `8192 -> 4096` argument substitution itself has evidence;
- **durable restart acceptance FAILED**;
- the cause is still **OPEN**.

The current hypothesis that SSH session teardown reaped the child is plausible because the process disappeared shortly after command completion and prior long-lived WMI launch history exists. But empty stderr/no WER is not enough to prove that causality.

**Ruling: SSH-child-reap = PLAUSIBLE / NOT PROVED.**

A detached WMI or one-shot scheduled-task relaunch is a reasonable diagnostic/recovery mechanism, but acceptance must be based on process survival + listener + exact command line + binary hash + startup log after a meaningful observation interval, not merely successful `Create()` return or a 60-second pulse.

Also verify that no previous kaspad instance or RocksDB lock holder remains before relaunch. Do not infer LOCK from memory-release timing without direct evidence.

## 3. P2(a) itself remains a headroom mitigation, not root-cause closure

The host free-memory trigger (<6 GB) justified taking the pre-authorized mitigation action operationally, but the restart failure means there is not yet a valid post-change memory window. Do not record P2(a) as accepted until the 4096 instance is durably up and the following are measured:

- WS/private bytes baseline after warm-up;
- free memory;
- handle count;
- IBD/body throughput;
- whether the previous growth envelope/slope returns.

A one-time ~4 GB downward shift followed by the old slope would support the existing hypothesis that non-block-cache / ram-scale memory dominates long-run growth.

## 4. D-c self-trigger design: keep implementation and production switch separated

The new D-c design to self-trigger small IBD rounds from relay-mode lag is directionally coherent with the observed pattern: relay-mode falls behind, orphan/locator work accumulates, and an IBD round rapidly catches up. But the design changes sync behavior and error handling inside kaspad and is therefore not production-authorized by this review.

The proposed safeguards (blue-work + DAA margin, peer eligibility, error classification, backoff, shadow T=0) are useful. Before any switch, NWT review must specifically verify:

1. no trigger storm / repeated CAS race under multiple peers;
2. finality/pruning/data-invalid errors remain disconnect/fail paths, not backoff-and-keep;
3. residual incoming-route/orphan state cannot grow unbounded across repeated small IBD rounds;
4. the self-trigger does not increase the already observed relay fan-in/console timeout problem beyond an accepted envelope;
5. `isSynced` flapping cannot reopen money-path gates during an IBD body phase.

## 5. P2-6 correctness HOLD remains

The first live performance window for 6a/6b is strong, but the malformed-JSON fail-closed defect identified earlier is not closed by these commits. A healthy live DB and `seed FAILED=0` do not exercise the negative path. Keep full correctness closure on HOLD until an invalid/unparseable `side_lock_daa_unrecoverable` payload causes the entire seed/tick to fail closed rather than silently disappearing from the in-memory set.

## Final state

- G-1 rpc-fail gate: **CONFIRMED DEFECT; FAIL-CLOSED FIX REQUIRED**.
- production money-path readiness based on current gate: **HOLD**.
- P2(a) 4096 parameter application: **observed**, but durable restart acceptance: **FAILED / OPEN**.
- SSH child-reaping cause: **PLAUSIBLE, NOT PROVED**.
- D-c self-trigger design: **reviewable candidate only; no production switch authorization**.
- P2-6 performance: **SUPPORTED**; malformed-JSON correctness closure: **HOLD**.

No production payout/refund/settlement selector switch, signing/broadcast, money-state DB mutation, key movement, unsafe-RPC enablement, or D-c production deployment is authorized by this review.
