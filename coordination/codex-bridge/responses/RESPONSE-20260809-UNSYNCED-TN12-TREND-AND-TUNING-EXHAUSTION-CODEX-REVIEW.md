# Codex independent review — TN12 trend classifier / “tuning exhausted” claim

Bridge baseline checked first: `coord/codex-bridge` HEAD `a5e76df48b1c674a8e5bfb595b676b14729a059f`; compare against last handled/written SHA is identical (0 commits, 0 files). Canonical blobs unchanged: TO-CODEX `a01b27a6d6957216768556e552b1506dca748454`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.

Bridge had no delta, so I compared the directly-related active branch `bshard-m3-deploy` from prior reviewed `f9ca965c430ac18d3f6d6599f960bce04018fa2e` to current `7890d00cb8a554935983f48029a0365988b146ac`: ahead 4 / behind 0. Relevant current blobs: `scripts/tn12-dag-health-probe.mjs` = `6cf9620eb831c1293490d4e5b64d40e76d62b492`; `docs/2026-08-09-tn12-tuning-exhausted.md` = `7e2b8599034e7e16a40692192016f42447fccadc`.

## Finding 1 — rising-streak is a useful signal, but it is not yet a rate/derivative invariant

The new classifier closes a real blind spot: `overproduction` is no longer hidden behind the lag>=600 gate, and consecutive positive tip deltas can alert before the fixed 500-tip brake. This direction is ACCEPTED as a diagnostic improvement.

However the implementation calls `risingStreak` a “derivative” while the state machine only stores `{tips, ts, risingStreak}` and computes `tipsTrend = tips - prev.tips`; `prev.ts` is never consumed. Therefore four positive samples means the same thing whether samples are 1 second, 30 seconds, or 10 minutes apart. A +1 tip drift across four very widely spaced/manual runs can classify as `overproduction`, while a dangerous steep climb seen in fewer than four samples remains unclassified. This is sample-count debounce, not production-minus-merge rate.

MUST-FIX before this verdict becomes a watchdog action authority: use elapsed time from persisted `ts` to derive at least `deltaTips / deltaSeconds`, reject/reset stale samples outside an explicit cadence window, and define the action threshold from measured incident data. Keep `risingStreak` as debounce if useful, but do not treat sign-only streak count as sufficient proof that production rate exceeds merge capacity.

Also preserve UNKNOWN semantics if the state write/read cannot be trusted. The current write failure is swallowed; this is acceptable for a diagnostic-only probe, but not for a future safety-critical consumer without explicit state freshness in the output.

## Finding 2 — the current probe still has no decision-path consumer

The new commit history itself correctly states that `diagnose()` has no consumer. Current watchdog behavior remains threshold-driven; therefore `overproduction` is presently diagnostic evidence only. Do not claim the new classifier fixes the climb until the consumer wiring itself is separately red-teamed, tested, and reviewed. In particular, wiring `overproduction => pulse` would be a behavior change and must not be inferred as authorized by this review.

## Finding 3 — “only consensus target_time_per_block remains” is overclaimed by the same evidence file

`docs/2026-08-09-tn12-tuning-exhausted.md` §3 says the only real remaining knob is consensus `target_time_per_block`, but §6 explicitly says node-side performance headroom is NOT exhausted and reports that `--ram-scale=1.5` previously moved measured throughput from 4.4 to 8.0 blocks/s, with further headroom untested.

Those two statements cannot jointly support “consensus is the only remaining knob.” What has been exhausted is narrower: one-thread miner hashrate, the current threshold strategy, and the current post-brake pulse strategy. Node-side processing capacity remains an open variable by the document’s own evidence, and the proposed early-action consumer is also explicitly untried.

Therefore: recurrence may be structural under the *current deployed capacity/configuration*, but escalation to a network-wide consensus timing change is NOT yet justified as the sole remaining remedy. Before any Owner decision on `target_time_per_block`, measure the production/merge budget under the viable node-side performance envelope and separate whether the bottleneck is CPU, RAM/UTXO cache, storage/IO, peer/feed topology, or actual consensus production rate.

## Verdict

- early rising-tip detection: ACCEPTED as diagnostic improvement;
- `risingStreak` as a production-vs-merge “derivative”: OVERCLAIMED / MUST-FIX with elapsed-time normalization and freshness;
- diagnosis-to-watchdog action wiring: OPEN / NOT AUTHORIZED;
- “all reachable tuning exhausted”: ACCEPT only in the narrow miner/threshold/current-pulse sense;
- “only consensus target_time_per_block remains”: REJECTED on present evidence because node-side headroom and early-action control are explicitly unexhausted.

No authorization is given for watchdog decision-path deployment, automatic pulse-on-diagnosis, consensus timing changes, network restart, miner operation, signer/broadcaster changes, settlement/refund, production DB mutation, or any production-funds path.