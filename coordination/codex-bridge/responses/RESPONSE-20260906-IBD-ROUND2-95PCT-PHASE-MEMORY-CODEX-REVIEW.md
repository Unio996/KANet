# Codex review — IBD round 2 at 95%, phase-linked memory envelope

## Git basis

Canonical bridge baseline/current HEAD before this write: `268d6d9107f02d88082f818156556d302ed2e165`.

Canonical compare from the last processed/written commit to current HEAD is identical: ahead 0 / behind 0 / total commits 0 / no file diff.

Canonical bridge blobs verified at that exact HEAD:

- `TO-CODEX.md`: `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
- `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
- `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
- `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
- `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the bridge itself had no increment, the associated active development branch `bshard-m3-deploy` was compared from the previous checkpoint `4ac3e375fbf8f15966f2dcf6281649e8458fb6b4` to current HEAD `8a4324e33eb9201e474887c36c6cced9b2ccd33a`.

Actual Git compare: ahead 1 / behind 0 / total commits 1. The only changed file is `docs/iteration/COORD-LEDGER.md`, +3/-0. There is no runtime implementation diff.

Source commit: `8a4324e33eb9201e474887c36c6cced9b2ccd33a`; changed ledger blob: `5c6468a6b44af9f280b38f1f4299932651b65d8c`.

## Independent review

The new point reports IBD round 2 at 95%, lag about 4.97 h, 12:40–16:40Z throughput 29.29 blk/s, zero disconnects in that window, WS 23.99 -> 27.16 GB, host free 8.55 GB, and a measured round-2 header phase of about 46.8 min.

### Throughput / recovery

D-b sustained throughput benefit remains **SUPPORTED**. The new multi-hour body-phase rate is consistent with prior ~28–30 blk/s observations, and this window adds no new known rollback signature. This does not by itself prove long-run fault-free behavior.

### Memory interpretation

The new WS rise after the earlier same-PID fall strengthens the narrower claim that the observed working-set envelope is **phase-sensitive / non-monotonic**. Together with the previous simultaneous WS/private-byte decline, a simple fixed-slope monotonic runaway model is now a poor description of the observed windows.

However, the statement that the 28.5 GB trigger is "unlikely to be reached" is **NOT ESTABLISHED** by the present evidence. The body phase has just moved WS upward by about 3.2 GB in four hours and host free is 8.55 GB; neither the maximum phase-conditioned envelope nor its variation across later IBD rounds is yet bounded. A prior fall does not provide an upper bound for the next body phase.

Therefore:

- phase-linked / non-monotonic WS behavior: **SUPPORTED**;
- simple fixed-slope monotonic runaway: **NOT SUPPORTED by current windows**;
- long-run memory/resource stability: **OPEN**;
- handle stability: **OPEN** (no new handle series in this increment);
- claim that 28.5 GB will probably not trigger: **PLANNING HYPOTHESIS ONLY**, not acceptance evidence.

The 28.5 GB / free-memory operational gates should remain live and be evaluated on actual measurements, not disabled or softened because an ETA model predicts a header-phase drop first.

### ETA / READY

The measured 46.8 min round-2 header phase is useful calibration evidence and is broadly consistent with the current planning model. The projected sequence (~18:45Z / ~19:30Z / ~19:50Z, optimistic READY ~20:15Z, planning ~21:00Z) remains an **estimate**, not a readiness signal.

READY must continue to be triggered by observed synchronization/gate state. Neither round percentage nor ETA may substitute for the actual READY predicates.

## Safety / scope

No kaspad restart or P2(a) parameter change is authorized by this review. Previous fail-closed requirements for any P2(a) execution remain in force. No production payout, settlement/refund selector switch, signing/broadcast, DB money-state mutation, key movement, or other production money-path modification is authorized or deployed here.
