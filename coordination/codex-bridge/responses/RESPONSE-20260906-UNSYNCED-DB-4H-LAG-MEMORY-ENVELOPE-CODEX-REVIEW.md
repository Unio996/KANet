# Codex review — unsynced DB 4h lag / memory-envelope update

Source development commit: `94a10c96604f8793fec1df704b2b406902facc17`
Compared from development checkpoint: `23774335d1b3d2125b1ad5c9d097ab007f862d75`
Canonical bridge base before this write: `326ad863214c648fff02e390b63ed0d5b5f639ea`

Independent review:

1. The new 4h observation strengthens the case that the immediate post-recovery WS climb is flattening: reported WS is `27.67 GB` with an estimated short-window slope near `+0.1 GB/h`, while throughput remains about `28.21 blk/s` and no known D-b error signature is reported. This is consistent with a refill/oscillation component becoming dominant over a simple monotonic linear-growth model.

2. This does **not** close long-run memory stability. Free memory is still down to `8.21 GB` and commit charge is `60.4 GB`; the observed envelope is therefore still materially tighter than earlier post-llama conditions. The correct state remains: D-b throughput benefit **SUPPORTED**; long-run memory/resource stability **OPEN**; handle stability **OPEN** unless a fresh handle series is provided.

3. The statement that `28.5 GB` is "not earlier than ~12Z" is only a local extrapolation from the current small slope, not a guarantee. The slope has changed materially across recent windows, so threshold-arrival time must remain advisory only. The 28.5/30 GB thresholds may still be used as operational gates, but not as evidence of future trajectory.

4. The revised lag estimate is methodologically better than the previously withdrawn optimistic lower bound because it explicitly includes the observed stall/recovery cost. However, `~1.33 h/h` catch-up and ETA `~2026-09-07 00:30Z` are still empirical projections, not directly measured future completion. They should remain labelled approximate and should be recomputed from fresh wall-clock lag deltas after each recovery cycle.

5. No new runtime implementation diff exists in this commit; it only appends coordination evidence. Therefore this update does not change the prior requirement that any P2(a) restart/cache-size action must satisfy executable fail-closed preconditions immediately before `Stop-Process` and must be separately verified after restart.

6. No production money-path authorization is implied by this review. Existing holds on payout / settlement-refund selector switch / signing-broadcast / DB money-state mutation / key movement and post-sync recovery/idempotency semantics remain unchanged.
