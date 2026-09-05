# Codex review — D-b disconnect #8 recovery + S2 feeder reliability

Source active-branch compare: `6fc6847d819b7878671670648df08e0cf2bb3a21..684f1e1f4b0aa986a2503b2f46f157fdee8925d2` on `bshard-m3-deploy` (4 commits; only `docs/2026-09-05-NWT-redteam-db-ibd-request-pipelining-v0.1.md` +5 and `docs/iteration/COORD-LEDGER.md` +6; no runtime implementation diff).

## Independent judgment

1. **D-b post-disconnect recovery: SUPPORTED.** After disconnect #8, IBD restarted, traversed header/scan phases, and body sync resumed. The first reported post-recovery body window (`198/396` alternation, ~29.7 blk/s over the first 12 buckets; NWT later reports ~28.74 blk/s over 5 min) is consistent with the depth-2 request pipeline still being active after reconnection. No D-b rollback signature (`IncomingRouteCapacityReached`, `syncee inconsistency`, expected-block mismatch, panic) is reported in the new evidence.

2. **Causality wording remains too strong.** NWT §11 says the four-peer reset pattern is "链路级瞬断，非 D-b" and later that the pipeline "不增加断连率". The same evidence supports the weaker conclusion already recorded by Codex: the event is **consistent with an external/local network transient and D-b causal responsibility is not demonstrated**. Four peers resetting within ~5 s plus the prior DNS symptom makes D-b less likely, but one event without interface/route/packet telemetry or peer close-reason evidence does not prove non-causality or an unchanged disconnect rate. Do not promote those statements to fact.

3. **S2 feeder reliability materially regressed and is not presently an independent READY signal.** The ledger records a ~44 min D-line gap, the second feeder gap that day. Marking S2 temporarily unreliable is correct. The replacement durable feeder is described as a host-local `scratch/_ibd_feeder.sh` process with an alive file, 20-minute cadence and single-writer discipline, but this branch commit contains only ledger/docs changes. Therefore the feeder implementation and its failure semantics are **not code-reviewable from this Git diff**, and one fresh D line is activation evidence, not durability evidence.

4. **READY must remain independent of S2 until durability is demonstrated.** The stated architecture that S1 is independent and `ready_watch` marks D age >60 min STALE is directionally safe. Do not let S2 absence/recency silently become a positive readiness condition. A feeder should become trusted only after at least multiple scheduled intervals plus evidence that node failure/timeout does not terminate the outer loop and that duplicate writers cannot reappear.

5. **No production-money authorization.** Nothing in these four commits changes or closes the existing HOLD on post-sync recovery/idempotency semantics for IBD-gated settlement/refund/ZK paths, nor does it authorize payout, refund/settlement selector switches, signing/broadcast, money-state mutation, key movement, or other production funds-path changes.

## Status

- D-b sustained throughput/recovery: **SUPPORTED**.
- Disconnect #8 external-network attribution: **PLAUSIBLE / CONSISTENT, not proven**.
- D-b disconnect-rate neutrality: **NOT DEMONSTRATED**.
- S2 feeder: **UNRELIABLE until multi-interval durability evidence**.
- Production money-path semantic HOLD: **UNCHANGED**.
