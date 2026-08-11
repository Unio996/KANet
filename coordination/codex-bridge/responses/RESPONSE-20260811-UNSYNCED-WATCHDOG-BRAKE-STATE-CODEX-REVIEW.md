# Codex review — unsynced watchdog brake-state exemption

Scope: active-branch review after `coord/codex-bridge` showed no increment beyond `408b94793b302a0be36a97295a5a62f18c1086e3`.

Source branch: `bshard-m3-deploy`

Relevant new commit reviewed:
- `c00ea646c38854147275cbb98dcfaa96dc28ca12` — adds brake-state reporting/exemption after a real false-positive `MINER=0` alert during a watchdog brake pulse.

Independent code-level judgment:

1. **The false-positive mechanism is real and the direction of the exemption is conceptually right.** A watchdog-controlled brake pulse can legitimately produce `MINER=0`; therefore process count alone is not enough to classify miner death. The implementation also correctly keeps WD-count and heartbeat checks active while braked, avoiding the earlier fail-open where a stale loop could be hidden by the brake exemption.

2. **However, the newly added brake authority is not yet trustworthy enough to suppress miner alerts. MUST-FIX.** The same commit records a real observation at 03:41:32Z where the probe reported `BRAKE=no` while the watchdog log showed an active brake episode, and explicitly says the cause is still unknown. Adding `BRKAT` makes the next mismatch diagnosable, but it does not fix the authority mismatch already observed.

3. **`BRKAT` is diagnostic-only in the committed sentinel.** `j1-watchdog-alive-probe.mjs` emits `BRAKE=<yes|no|unknown> BRKAT=<marker-time>`, but `j1-watchdog-sentinel-once.sh` parses only `BRAKE`; it never parses or validates `BRKAT`. Therefore no freshness, ordering, or bounded-duration rule is mechanically enforced on the marker that grants the silence exemption.

4. **This creates a concrete fail-open shape.** The probe defines brake state as the last `BRAKE ENGAGED/RELEASED` marker among the last 800 log lines. If an `ENGAGED` marker remains the last visible marker because RELEASED was not written/read, was lost/truncated, or the log-reader races the writer, then `BRAKE=yes` can persist beyond the real 20-second pulse. As long as WD=1 and the heartbeat remains inside its existing freshness window, `MINER=0` is silently accepted. The present tests explicitly assert `BRAKE=yes` => silence, but do not bind that exemption to marker age or a matching brake epoch.

5. **The tests prove parser and decision-table behavior, not brake-source correctness.** The 32-case sentinel suite injects synthetic lines (`J1_WD_TEST_LINE`) and correctly checks unknown/no/yes, WD and heartbeat interactions. It does not exercise the log-tail derivation under concurrent ENGAGED/RELEASED writes, stale ENGAGED, missing RELEASED, rotation/truncation, duplicate markers, or the already observed `BRAKE=no`/active-brake mismatch. Those are exactly the source-of-truth cases now carrying the exemption.

Required closure before treating the brake exemption as reliable supervision:
- parse and validate the marker timestamp/epoch that grants `BRAKE=yes`, rather than carrying `BRKAT` as display-only data;
- enforce a strict maximum age comfortably above the intended ~20-second pulse but far below the heartbeat stale ceiling, with stale/invalid/future marker => no exemption;
- preferably move brake state to an explicit state artifact written by the watchdog around the brake critical section, instead of inferring authority from an eventually-consistent log tail;
- add executable source-level tests for stale ENGAGED, missing RELEASED, concurrent/ordered ENGAGED→RELEASED, rotation/truncation/read failure, and the observed mismatch class;
- until that source authority is closed, a `BRAKE=yes`-suppressed `MINER=0` should not be treated as evidence of healthy miner supervision without corroboration.

Verdict:
- need to distinguish brake pulse from real miner death: **CONFIRMED**.
- heartbeat/WD checks remain active while braked: **ACCEPTED IN CODE**.
- current log-tail-derived `BRAKE=yes` as a reliable silence authority: **RED / MUST-FIX**.
- `BRKAT` instrumentation: **useful diagnostics, not a safety closure**.
- no watchdog/miner deployment or restart, production DB mutation, refund/settlement, signing/broadcast, key movement, or other production funds-path action is authorized by this review.
