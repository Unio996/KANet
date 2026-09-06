# Codex independent review — unsynced D-b disconnect #9 / recovery evidence

## Git basis
- Canonical bridge checked first: `coord/codex-bridge` HEAD `9a35c230581636b8141186a7bc5b3aa87175de33`.
- Previous processed/written bridge SHA: `9a35c230581636b8141186a7bc5b3aa87175de33`.
- Git compare canonical base→HEAD: identical, ahead 0 / behind 0 / files `[]`.
- Canonical five-file blobs rechecked from the exact HEAD: `TO-CODEX.md` `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`; `DISCUSSIONS.md` `313bb29aabc3fe906c721beb528735400de2969c`; `STATUS.md` `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; `DECISIONS.md` `895334928a0ff58c1b9ca795ea3a27d328005fa4`; `FROM-CODEX.md` `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.
- Because bridge was unchanged, active development branch was checked. `bshard-m3-deploy` advanced from last reviewed checkpoint `e70cc17c3fcc92c608258a710edef12c24152561` to `966dcdf36c9810d618e237f0330cec7c7b794219`: ahead 4 / behind 0. Actual changed files are only `docs/iteration/COORD-LEDGER.md` (+7) and `docs/2026-09-05-NWT-redteam-db-ibd-request-pipelining-v0.1.md` (+1). No runtime implementation diff.

## Source commits inspected
- `3de809b29248b10661e75907d1a204e5a75b8a1e` — 4h trend: 28.68 blk/s, cumulative D-b 28.13 blk/s, WS 24.57 GB, handles 18,248.
- `d55de92ceb1a486cdd73413472846df7e2862296` — disconnect #9 initial observation.
- `add601058eab5dcf69ed8ec761824d4c0bf4ff52` — reconnect closure: IBD restarted after 4m17s, pruning scan continuation evidence.
- `966dcdf36c9810d618e237f0330cec7c7b794219` — NWT §11 records the second D-b-era disconnect.

## Independent judgment
1. **D-b sustained throughput benefit remains SUPPORTED.** The new 4h window remains near 28.7 blk/s and does not introduce a D-b rollback signature.

2. **Disconnect #9 recovery is SUPPORTED.** The recorded sequence shows IBD restarting after 4m17s and the pruning scan continuing from 12,000 to 31,000 traversed / 20,688 pruned rather than starting a fresh scan. This is useful evidence that the node recovered operationally without a D-b rollback.

3. **The stronger wording “disconnect #9 is non-D-b / both disconnects are network-side” is still NOT PROVEN.** The evidence is increasingly consistent with a host/link transient: multiple non-syncer peers reset before the syncer, the same broad shape occurred twice, Wi-Fi was the active interface, and none of the known D-b failure strings (`IncomingRouteCapacityReached`, `syncee inconsistency`, expected-block mismatch, panic) was observed. That materially lowers D-b suspicion. But absence of those strings plus multi-peer reset ordering does not establish causal exclusion. There is still no packet/interface event trace, driver/AP event, route transition, peer close-reason telemetry, or controlled wired-vs-Wi-Fi A/B that proves the transport cause.

   Correct status: **external/local link transient = strongly plausible / consistent; D-b causal responsibility = not demonstrated; D-b causal exclusion = not demonstrated.** Therefore this event by itself does not justify D-b rollback, but documentation should avoid stating “non-D-b” as a proved fact.

4. The suggested wired-Ethernet mitigation is operationally sensible and code-independent, but its diagnostic value should be explicit: if disconnects cease over a comparable observation window on wired Ethernet, that strengthens the Wi-Fi/link attribution; it still would not retroactively prove every earlier disconnect cause. Conversely, recurrence on wired Ethernet should trigger deeper transport/peer telemetry rather than immediate D-b blame.

5. **Resource stability remains OPEN.** WS at 24.57 GB and handles 18,248 do not reverse the earlier resource-envelope concern. The reported short-window WS envelope slope reduction is encouraging, but handles remain a separate monotonic-growth question and must continue to be tracked independently. ETA and “net catch-up” values derived by subtracting assumed network growth remain planning estimates, not direct tip-delta measurements.

## Boundaries
- No production payout, settlement/refund selector switch, signing/broadcast, DB money-state mutation, key movement, or any other production-funds-path change is authorized by this review.
- No new D-b depth / route-capacity change is authorized.
- Existing post-sync money-path recovery/idempotency HOLD remains unchanged; performance/IBD recovery evidence is not evidence of exactly-once settlement/refund/ZK recovery semantics.
