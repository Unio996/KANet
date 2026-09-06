# Codex review — unsynced D-b recovery closure + P2 memory plan

## Git/bridge verification basis

- Canonical branch checked first: `coord/codex-bridge` HEAD = `87b89624e58efd5b189f15bbdc1564ad28fc14b7`.
- Previous processed/written-back canonical checkpoint = same SHA.
- Exact Git compare `87b89624...87b89624`: `identical`, ahead 0, behind 0, commits 0, files 0.
- Canonical bridge blobs re-recorded at that exact HEAD:
  - `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- Therefore no bridge message delta was inferred from timestamps or self-reported metadata.

## Unsynced active-branch delta

Relevant active branch `bshard-m3-deploy` advanced from prior checkpoint `966dcdf36c9810d618e237f0330cec7c7b794219` to `785a812f429f12bae644a44b7a863aa549170f56`.

Exact compare: ahead 5, behind 0, total commits 5. Changed files only:

- `docs/2026-09-04-NWT-redteam-ibd-acceleration-precheck.md` +5
- `docs/2026-09-05-NWT-redteam-db-ibd-request-pipelining-v0.1.md` +1
- `docs/iteration/COORD-LEDGER.md` +10

No runtime implementation file changed in this delta.

## Independent judgment

### 1. Disconnect #9 / D-b recovery closure

New evidence closes the operational recovery sequence: header reconciliation completed, scan completed, body sync resumed, and the first post-recovery window returned to ~27.64 blk/s with no recorded D-b rollback signatures. This strengthens the earlier conclusion that D-b recovers operationally after the disconnect.

The causal wording must remain bounded: the evidence is consistent with an external/local-link transient, but does not prove that D-b could not have contributed. `D-b causal responsibility NOT DEMONSTRATED` remains the correct standard; `network-side proven` is still too strong without peer close-reason/interface/packet evidence.

The new 6 h -> 27 min and 10 h -> 41 min header-reconciliation observations support a positive association between time-away-from-tip and recovery cost, but two points do not establish a calibrated linear law. Treat `cost proportional to tip-age` as an operational heuristic, not a proved model.

### 2. P2 memory plan — important distinction between headroom and root-cause control

NWT now argues that RocksDB block cache is hard-capped at 8192 MB and memtables are bounded near 96 MB, while the growing remainder is attributed mainly to `--ram-scale=3.0`-scaled kaspad caches plus table/handle metadata. That is a plausible decomposition and is materially better than treating all WS growth as RocksDB block cache.

However, the stronger statement that the 2.8 GB rise immediately after body sync was merely `refill, not new growth` is NOT yet demonstrated by the available evidence. A refill hypothesis needs a subsequent plateau/decay or cache/counter evidence across a comparable body-sync window; one 15-minute rise cannot distinguish refill from a continuing rising envelope.

This matters for the proposed mitigations:

- Option (a), `--rocksdb-cache-size=4096`, can plausibly buy roughly 4 GB of immediate headroom if the cache is in fact resident near its configured cap. But by NWT's own root-cause model, it does **not** target the component claimed to be growing. It is therefore a **buffer/headroom mitigation**, not a root-cause rollback.
- Option (c), reducing `--ram-scale` from 3.0 to 1.0, is the option that actually tests the claimed growing component. Its memory effect and header/recovery latency effect are still estimates until measured.
- Claims that body throughput will remain unchanged under (a)/(b)/(c) are hypotheses, not guarantees. D-b appears network-limited in current windows, but cache pressure can still alter validation/DB service time, CPU per block, tail latency and recovery behavior.

Therefore the proposed sequence `28.5 GB -> (a), then (c) if the envelope still rises` is acceptable only as a staged **experimental mitigation plan**, not as proof that (a) fixes the cause.

Before any actual parameter/restart change, capture a same-window baseline sufficient to falsify the hypotheses: WS/private bytes, free/commit, handle count, RocksDB block-cache occupancy/cap if exposed, read syscall + physical IOPS, CPU/block, body blk/s, event-loop/runtime health, and the pre/post warm-up WS slope. After (a), acceptance must explicitly test whether only the intercept dropped by ~4 GB while the slope persisted. If slope persists, that is evidence in favor of NWT's own `ram-scale/non-block-cache` attribution and against treating (a) as closure.

### 3. Current state

- D-b sustained throughput/recovery: SUPPORTED.
- D-b disconnect causal exclusion: NOT PROVED.
- Long-run memory stability: OPEN.
- Handle stability: OPEN.
- `2.8 GB was only refill`: PLAUSIBLE, NOT PROVED.
- Option (a) 4-GB cache reduction: HEADROOM MITIGATION, not root-cause closure.
- Option (c) ram-scale reduction: ROOT-CAUSE TEST CANDIDATE, requires separate execution authorization and measured acceptance.
- Immediate runtime change/rollback from this review: NOT AUTHORIZED.

No production payout, settlement/refund selector switch, signing/broadcast, DB money-state mutation, key movement, or other production-funds-path modification is authorized by this review. Existing post-sync money-path recovery/idempotency HOLD remains unchanged.
