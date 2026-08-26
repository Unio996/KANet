# Codex review — unsynced gate (d) claim-depth sampler v0.1

Verdict: **MATERIAL PROGRESS / NOT ACCEPTED AS DEPLOYMENT EVIDENCE YET.**

Bridge canonical was unchanged at the start of this run, so this review is triggered only by the directly-related `bshard-m3-deploy` increment. I independently reviewed commit `673dbf81964ad7f2ca80beb5a287382e23a314f0` and the current ledger state at branch head `0627791d3f43b0d40a83f8726127f1df30e71f1b`.

## What is good

The v0.1 method gets several important boundaries right:

- proxy samples are explicitly labeled as **not T5-shape**, instead of silently treating current Pool/Shard spends as equivalent to the future Shape-B claim;
- Leg A (submit→inclusion) and Leg B (inclusion→depth-20) are separated, and DAA vs wall-clock are reported as distinct quantities;
- `n < 30` is fail-closed rather than producing a weak percentile;
- historical Leg A DAA is not fabricated when only wall-clock submission data exists;
- current `REORG_SAFE_MIN_DEPTH=20` semantics are reused rather than inventing a different finality metric;
- the method acknowledges that true T5 mass/script behavior still needs real-shape evidence after implementation.

Those are all **PASS as method direction**.

## MUST-FIX 1 — canonical inclusion must not trust `kaspa_tx_log`

The current method joins candidate txids to `kaspa_tx_log` and uses that row to identify the inclusion block. This is not sufficient for a funds-safety parameter. `kaspa_tx_log` is an indexer/logging surface, not consensus authority.

The team has already noticed this in the current ledger and routed v0.2: every `kaspa_tx_log` hit used as an inclusion anchor must be independently rechecked against the node/RPC canonical block data. That correction is **required**, not optional hardening.

Minimum acceptance condition:

- obtain the claimed block from consensus RPC (`getBlock` or equivalent authoritative path);
- verify the exact txid is actually present in that block;
- reject/fail-closed on missing block, tx mismatch, malformed response, or ambiguous/cannot-verify state;
- only after this recheck may the block DAA/timestamp feed the Leg-B sample.

A log hit that cannot be corroborated by the canonical block must be excluded and surfaced as `inconclusive`, never silently counted.

## MUST-FIX 2 — the executable sampler is still gitignored

The method document explicitly says the actual sampler is `scratch/_j2_claim_depth_sampler.mjs` and gitignored. Therefore I can inspect the proposed method, but I cannot independently inspect or rerun the code that will produce the deployment number.

This is the same evidence-durability problem previously fixed for B_win and toolchain provenance.

Before any `N_claim` / `S_unalloc` output is accepted as gate-(d) evidence, the exact executable sampler source must be committed to a durable reviewed path, together with:

- deterministic CLI/options used for the official run;
- the commit/ref of KANet code and RPC semantics it targets;
- output schema/version;
- raw sample rows (or a durable machine-readable evidence file sufficient to recompute the percentiles);
- SHA-256 for the official output.

A prose method + host-local script is **not** independently auditable deployment evidence.

## MUST-FIX 3 — Leg A `live` start point is not a true submission timestamp

The v0.1 live mode defines Leg A start as the first time the sampler sees the txid appear in DB on a 30-second poll. That is not transaction submission, and it is biased late, therefore it biases measured submit→inclusion time **downward**.

The document does disclose this and proposes a 30-second correction, which is better than hiding it, but a fixed polling correction is still only an approximation. For a final funds-bearing `N_claim` value, prefer a real submit/attempt timestamp emitted by the actual claim sender/harness and bound to the exact txid. If that is not available, the proxy Leg-A result must remain explicitly labeled a lower-bound proxy and compensated by separately-allocated uncertainty/slack; it must not be presented as measured T5 submit→inclusion latency.

This does not block using the current proxy to characterize Leg-B finality physics, but it **does** block treating Leg-A proxy output as the final T5 claim-land bound.

## Quantile / slack boundary

Using proxy Leg-B `p100` as an empirical lower bound is acceptable only within the observed sample. `p100` of N observations is not a mathematical worst-case upper bound on future inclusion/finality delay. Therefore the eventual gate-(d) closure still needs the previously-agreed conservative structure:

`N_claim = measured operating envelope + explicitly justified unallocated/model slack`

not “historical maximum = future hard bound.” The separate `S_unalloc` concept remains load-bearing and must not be double-counted with named reorg/observation/congestion margins.

## Current status

- claim-depth method direction: **PASS**;
- proxy-vs-T5 honesty: **PASS**;
- canonical inclusion verification: **OPEN / MUST-FIX**;
- durable sampler source: **OPEN / MUST-FIX**;
- Leg-A true submit timestamp for final T5 bound: **OPEN**;
- official post-sync >=30 sample evidence: **NOT YET PRESENT**;
- gate (d): **OPEN / PROVISIONAL**.

This does not reopen the conditionally-closed same-chain Shape-B design spec. It only governs the operational `N_claim`/`S_unalloc` evidence required before funds-bearing deployment.

No covenant build, deployment, signing/broadcast, DB mutation, settlement/refund, key movement, or production money-path action is authorized by this review.