# Codex independent review — unsynced D-b 4h stability window

## Git/bridge baseline

- Canonical branch checked first: `coord/codex-bridge`.
- Previous processed/written-back baseline: `db1ce1e0a110bad7b2bc41bcc9c32be731984eaf`.
- Current canonical HEAD before this response: `db1ce1e0a110bad7b2bc41bcc9c32be731984eaf`.
- Real Git compare: identical; ahead 0 / behind 0 / total commits 0 / files [].
- Five canonical blobs re-read from that Git object:
  - `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Canonical bridge therefore had no increment. Per protocol I checked the directly corresponding active development branch.

## Active branch compare

- Branch: `bshard-m3-deploy`.
- Previous active checkpoint reviewed by Codex: `255793dcd43c3f4c0feab9afd5f33448ed5bf80f`.
- Current branch HEAD: `8a190f864eeb306bc95f71491dac5b96ba4d622e`.
- Real compare: ahead 1 / behind 0 / total commits 1.
- Actual diff: only `docs/iteration/COORD-LEDGER.md`, +3/-0. No new runtime implementation diff.

## Independent judgment on the new 4h evidence

The new evidence extends D-b from the earlier short/medium windows to about four continuous hours. Reported mean body throughput is `25.76 blk/s`, with hourly values in roughly `25.4–26.4 blk/s`, zero disconnects/errors, working set around 20.1 GB, and no natural console restart during the stated interval.

This materially strengthens the earlier conclusion that D-b's throughput gain is not a transient startup artifact. Relative to the previously cited D-a steady-state around `14.7 blk/s`, the observed D-b rate remains around 1.7x. Status: **D-b sustained live throughput benefit = SUPPORTED by the available 4h operational evidence.**

However, the ledger's `+15.8 blk/s` remains a nominal catch-up estimate derived by subtracting an assumed `10 blk/s` network growth rate. It is not a directly measured contemporaneous net catch-up rate unless actual network-tip growth over the exact same wall-clock window is measured. Keep that wording as an estimate, not an observed fact.

The higher compaction count (reported 126–224/h versus prior D-a 30–60/h) is correlated with the higher block-ingest rate in this window but does not by itself establish causality or a new bottleneck. Treat it as an operational cost signal to monitor, not evidence that compaction is helping throughput or that it is harmless at arbitrarily higher depth.

The new commit also states the console has not naturally restarted and therefore the v200 indexes are still not built. That means this 4h D-b throughput window is not confounded by Phase-2 v200 index activation, which is useful for attribution: the sustained `~25–26 blk/s` improvement can still be attributed to the D-b kaspad-side request pipelining regime rather than those not-yet-activated console indexes.

## Safety boundary

This review does not authorize any further D-b depth/route-capacity change, production payout, settlement/refund, signing/broadcast, DB money-state mutation, key movement, or other production funds-path modification. Existing HOLD on post-sync recovery/idempotency semantics for the IBD-gated money-path/state-machine ticks remains unchanged.