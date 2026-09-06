# Codex review — TN12 IBD postmortem attribution boundary

Reviewed source commit: `3484955c07a21fc3b1f812422a73f1a6e491adda`
Reviewed source blob: `docs/2026-09-06-bettor-tn12-ibd-postmortem-v0.1.md` = `3c7132837b5308757fbe79f469696ab80f69d9fa`

## Independent judgment

The postmortem is directionally useful, but several causal claims are stronger than the evidence established in the bridge history.

1. **D-b throughput benefit remains SUPPORTED.** The documented uplift from roughly 13–15 blk/s to 25–30 blk/s is consistent with the prior multi-hour observations. This is a performance result, not by itself a proof of all recovery/resource properties.

2. **The two post-D-b multi-peer reset incidents must not be labeled proven `本机链路瞬断（Wi-Fi）`.** Prior evidence made local/external link transient strongly plausible: multiple peers reset in a short interval, Wi-Fi was the active interface, and no known D-b rollback signature was reported. But packet/interface events, driver/AP logs, peer close reasons, or a controlled wired-vs-Wi-Fi A/B were not present. Correct status: `local/external link transient strongly plausible; D-b causation not demonstrated; D-b exclusion not demonstrated`.

3. Therefore `主要断连源是 Wi-Fi` is also too strong. `Switch to wired Ethernet` remains a sensible zero-code mitigation and diagnostic experiment, but should be framed as testing the link-attribution hypothesis rather than as executing against a proven root cause.

4. **`header 重议 27–41 min ∝ 距上次同步到 tip 的时长` is not established as a proportional law.** Two observed recovery points (about 6h→27m and 10h→41m) can be reported as observations, not as a validated linear relationship.

5. **`句柄风暴已治` should be scoped.** The D-a changes appear to have removed the earlier high-rate file-open/close pathology and materially reduced physical reads, but later monitoring still left handle-count stability OPEN. The postmortem should distinguish `specific open/close storm signature no longer observed` from `long-run handle/resource stability proven`.

6. **`D-b 两次链路断连后自恢复、零错误` is acceptable only in an operational sense.** Recovery after the observed disconnects is supported and no known rollback signature was recorded; this does not prove causal independence from D-b or long-run fault freedom.

7. The READY/post-sync section must preserve the existing money-path acceptance boundary: a healthy first 1h performance window and one-week shadow-selector agreement do not by themselves prove recovery/idempotency for settlement/refund/ZK/pool work skipped while the IBD gate was active. No production selector switch or other money-path change is authorized by this postmortem.

## Requested documentation correction

Please revise the postmortem terminology so that evidence levels are explicit: observed fact vs strongly plausible attribution vs hypothesis vs planning estimate. In particular, replace categorical Wi-Fi attribution and the proportional-recovery claim with bounded wording, and scope the handle conclusion to the specific storm signature rather than long-run stability.

No production funds-path modification, signing/broadcast action, key movement, settlement/refund selector switch, or DB money-state mutation is authorized by this review.
