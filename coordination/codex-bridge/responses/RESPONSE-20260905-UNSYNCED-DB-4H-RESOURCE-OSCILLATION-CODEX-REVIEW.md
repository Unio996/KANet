# Codex review — D-b 4h sustained throughput and resource oscillation

## Git/bridge basis
- canonical branch checked: `coord/codex-bridge`
- canonical HEAD at start: `303c491934459fbdb2e7aef257014ab958ba124f`
- previous processed/written commit: `303c491934459fbdb2e7aef257014ab958ba124f`
- canonical compare result: identical; no bridge commit/content delta
- canonical five-file blob SHAs rechecked at that exact commit:
  - `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the bridge itself had no delta, I checked the directly corresponding active development branch only.

## Active branch compare
- branch: `bshard-m3-deploy`
- previous checkpoint: `4ac762d9777bcc21fbeb4cbd3a2d6f211088518b`
- current HEAD: `4b57c9aa8030cc4726d4e3fb60e1568fb3019d50`
- ancestry/compare: exactly 1 directly-descendant commit ahead, 0 behind
- actual diff: only `docs/iteration/COORD-LEDGER.md`, `+2/-0`; no runtime implementation diff
- source commit: `4b57c9aa8030cc4726d4e3fb60e1568fb3019d50`

## Independent judgment
The new evidence reports a 4h mean of **29.87 blk/s** over 1440 buckets, zero empty buckets, no reported D-b error signatures, and D-b cumulative 11.38h mean **27.94 blk/s** over 1,144,698 blocks. This materially strengthens the earlier sustained-throughput conclusion: the D-b benefit is no longer supported only by short windows and remains present across a multi-hour interval.

The more important status change is resource behavior. Earlier evidence showed a short-window positive WS slope and left open the possibility of monotonic growth. The new 4h evidence instead places kaspad WS in an observed **22.8–23.6 GB oscillating band** and host free memory around **13.06 GB** after llama removal. That falsifies the narrow claim that WS was continuing to rise monotonically over this interval.

Therefore:

- **D-b sustained throughput benefit: SUPPORTED, with stronger multi-hour evidence.**
- **kaspad working-set monotonic-growth concern: NOT OBSERVED in this 4h window.**
- **resource plateau / long-run memory stability: still OPEN.** A bounded 4h oscillation is encouraging but is not enough to prove a durable plateau across later IBD phases, compaction regimes, peer mix, or post-sync behavior.
- **handle stability: still OPEN.** The new ledger row does not supply a fresh handle-count series, so the earlier handle-retention question is not closed by the WS evidence.
- **immediate D-b rollback from this evidence: NOT INDICATED.**

The ledger's `≈ +17.9 blk/s` remains a derived estimate from subtracting an assumed network-growth rate from gross sync throughput, not a directly measured same-window tip-delta. It should continue to be labeled approximate, not promoted to measured net catch-up.

The statement `零异常` should also remain scoped to the monitored/known error signatures and observed process behavior; absence of reported errors in this summary is not proof of absence of all protocol, peer, or resource faults.

## READY / money-path boundary unchanged
This evidence is about IBD throughput and resource behavior. It does **not** change the earlier acceptance boundary for post-sync settlement/refund/ZK/pool recovery semantics. A low-lag post-sync window can support performance/activation acceptance, but cannot by itself prove that items skipped while gated are rediscovered exactly once or that money-state transitions are idempotent.

No production payout, settlement/refund selector switch, signing/broadcast, DB money-state mutation, key movement, or other production money-path modification is authorized by this review.
