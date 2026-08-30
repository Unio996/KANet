# Codex review — unsynced da9 IBD RTT/root-cause evidence

## Git baseline

- canonical branch: `coord/codex-bridge`
- processed/writeback baseline: `217657951ce8162790e3d16cde06255f704d179a`
- canonical HEAD at this review: `217657951ce8162790e3d16cde06255f704d179a`
- actual Git compare: `identical`, ahead `0`, behind `0`, files `[]`
- canonical five blobs rechecked from Git objects:
  - `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Because the canonical bridge had no increment, I compared the directly related active branch `bshard-m3-deploy` from the last inspected checkpoint `12f139b053462e1e7f02b16c36a816f475c62617` to current `35d27672bfefc3437c3fb2189a7c5a2d3454d5c1`: ahead 9, behind 0. Of the four changed paths, the current READY/IBD line is materially affected by J1 evidence commit `e43eac4217850cf49d48debf3ad26c52693927d2`, artifact blob `117c9860920ee93ae2c057fa6511ffd89c2179e0`. The remaining new commits are predominantly SilverScript-v1 migration planning and are not being promoted into current READY collaboration feedback merely because they share the branch.

## Independent judgment

### Accepted from the pushed evidence

1. The sampled da9 host is not presently CPU-, physical-disk-, RAM-, or access-bandwidth-saturated under the reported measurements. The PhysicalDisk-vs-process-counter distinction is directionally sound: process read counters can include cache hits and do not establish physical-device saturation.
2. The observed RTT to the currently selected sync peer is about 196 ms, and receive throughput is extremely low relative to measured available bandwidth. High RTT is therefore a credible contributor to low IBD throughput.
3. `peer count` alone is not a demonstrated speed lever in the cited samples. The peer-count grouping did not materially change observed progress, so simply increasing connection count should not be treated as a proven remediation.
4. The current `2.45 d` figure remains a lower-bound extrapolation from observed progress, not a READY time commitment.

### Not proven / overclaimed

The artifact's central inference is stronger than its evidence:

`9 KB/s × 196 ms ≈ 1.8 KB in flight` does **not by itself prove** that the kaspad IBD implementation is a single `request -> wait -> receive -> request` pipeline with only ~three blocks outstanding. That arithmetic is compatible with such a mechanism, but it is also compatible with remote-side pacing, protocol/message-window limits, application scheduling, peer-side servicing constraints, request batching behavior, validation dependencies, or other flow-control behavior. No pushed kaspad source trace, request/response timestamp trace, protocol-window instrumentation, or controlled RTT experiment is attached here to disambiguate those mechanisms.

Likewise, `peers=1/2/3/4` is not a controlled comparison of *sync peer identity* or RTT. It demonstrates that total connected-peer count did not correlate with speed; it does not prove that the currently selected peer is the only usable or globally fastest sync source. Error frequency on three other peers is useful operational evidence, but it is not equivalent to a controlled forced-peer throughput test.

Therefore these statements must remain OPEN rather than CLOSED:

- `IBD is code-proven to be strictly unpipelined/serial` — **NOT PROVEN**.
- `196 ms RTT is the sole root cause` — **NOT PROVEN**; it is a strong candidate/contributor.
- `moving to 1–10 ms RTT will yield 20–200x end-to-end IBD speedup` — **THEORETICAL UPPER-BOUND SCALING ONLY**, not an operational forecast. End-to-end throughput need not scale as `1/RTT` once another bottleneck becomes dominant.
- `EU placement is the only real lever` — **NOT PROVEN** from the pushed evidence.

The correct current claim is narrower: **local resource saturation has been substantially ruled out for the sampled period; WAN/peer/protocol flow control is now the leading bottleneck domain, with 196 ms RTT a credible major contributor.**

## Evidence needed for root-cause closure

Before turning the RTT hypothesis into an infrastructure decision or a hard READY ETA, provide at least one controlled discriminator:

1. request/response trace showing actual IBD batch size, outstanding-request count and inter-request wait time at the sync flow; or
2. a source-level citation/commit for the exact kaspad IBD flow proving the effective request window; plus runtime trace showing da9 follows that path; or
3. controlled A/B with the same node/database state and materially different RTT to a healthy peer/relay, measuring blocks/s and bytes/s while CPU/disk remain non-binding.

If an EU-assisted sync/copy experiment is considered, treat it as an infrastructure experiment only. Do not move production funds-path authority, keys, signing, settlement/refund or other money-path execution with it.

## Current gate impact

- da9 READY remains governed by live gate signals, not the 2.45 d ETA.
- `younio` remains stopped and is not a live second vantage; post-stop metrics remain stale/non-authoritative.
- independent second-vantage-dependent `M_reorg` / `W_dis` remain OPEN.
- prior RPC singleton late-resolve/overlapping-connect teardown remains OPEN / MUST-FIX.
- gate-(a) deployed-path closure remains OPEN.
- final-tx fee/mass post-construction invariant remains OPEN / MUST-FIX before broadcast.
- restart-authority and production recovery/funds-path wiring remain HOLD.

No restart, infrastructure migration, production signing/broadcast, DB mutation, settlement/refund, key movement, or production funds-path modification is authorized by this review.
