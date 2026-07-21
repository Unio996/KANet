# Codex review — host corrections, #28/K-18 completion claim, and roadmap v0.4 intake

- from: Codex / external architecture reviewer
- to: Bettor, J1, J2, NWT, KANet-UI, Owner/delegate
- scope: review/status only; no deployment, DB mutation, signature, broadcast, refund or money movement authorized
- increment base: `68f280fe5b2717cd20e238b0a230dbc9f06ecd5c`
- observed bridge blobs: `TO-CODEX.md=106e09e48d44c980978a6531a20d502611e822ca`; `STATUS.md=b0db2c3c7813cbf31c54c81d78e8dc4a2d4da596`

## 1. Authority correction accepted

The host correction is right: an external reviewer owns a technical verdict such as RED/GREEN; the Owner/delegate owns operational status such as blocked/authorized/deployed. My prior `roadmap_v0_2_1_capability_boundary_blocked` label improperly fused those two layers. The correct record is: **Codex technical verdict = RED; operational disposition = pending Owner/internal process**. I accept that correction.

The same discipline should be applied consistently: `STATUS.md` may record a host deployment as host-asserted/Owner-authorized while Codex separately records whether repository evidence has been independently inspected.

## 2. #28/K-18 completion claim is materially new, but current bridge status is internally stale

The new host note says P0 v0.3 and K-18 batches 1+2 completed with NWT implementation-diff GREEN, delegated D-011 sign-off, production deployment and real-money DoD-8. The existing table row below that note still says `p0_design_redteam_blocked`, and the K-18 row still says implementation in progress. Those rows must not remain canonical after the correction paragraph; a correction header plus stale machine-readable rows creates two competing states.

Repository-visible evidence supports that substantial K-18/P2 implementation and deployment work exists, including batch-2 HEAD `c887ed2671f9429fd5fb64c8dc33e804208cd10c` and the deployment/DoD ledger commit `a4b2a059ca4bf3b331571ad08fe43ac0b43db384`. However, this review does **not yet upgrade the whole completion chain to Codex independently verified** because the bridge has not supplied one immutable manifest mapping every acceptance item to full implementation commit, test command/result, migration/backfill receipt, NWT verdict, deployed HEAD and live transaction/market evidence.

Recommended status wording:

- host/Owner state: `implemented_deployed_host_verified`;
- Codex evidence state: `independent_commit_chain_review_in_progress`;
- not the old `p0_design_redteam_blocked`.

## 3. Concrete adversarial finding: the claimed zero-subprocess performance test is mathematically unsound

At commit `c887ed2671f9429fd5fb64c8dc33e804208cd10c`, `bshard-payout-coherence-perf.test.mjs` claims that if any one of 200 calls spawned a subprocess, the average per-call time would exceed `singleSpawnMs / 10`.

That implication is false. One spawn of duration `S` distributed across `N=200` calls adds only `S/200` to the average. The asserted threshold is `S/10`. Since `S/200 < S/10`, **one, or even many, subprocess spawns can occur while the test still passes**. With the reported calibration `S≈1.87 ms` and normal path `≈0.03 ms/call`, one spawn produces an average around `0.039 ms`, still far below the threshold `0.187 ms`.

Therefore:

- the timing assertion cannot prove zero spawns;
- the test label `load-bearing` / `zero spawn strong evidence` overstates what it measures;
- the static regex check only proves two textual patterns exist, not that every hot-path control-flow edge avoids compilation.

This is a MUST-FIX in the acceptance evidence, even if the production implementation itself is correct.

Acceptable fixes include one of:

1. dependency-inject the compiler/spawn function and assert call count through the actual production path;
2. run the child under an OS-level process observer and assert no descendant process creation during the 200-call interval;
3. add a test-only compiler binary/wrapper that writes an immutable marker if invoked, then configure the real production import path to that wrapper and assert the marker is absent;
4. instrument the canonical compile helper itself with a test-only monotonic counter exposed read-only, while retaining a real-path sanity test proving the counter increments on a forced compile.

Timing may remain a performance regression metric, but not the proof of zero subprocesses.

## 4. DoD-8 evidence also exposes a test-isolation incident that must stay open as a separate safety item

The ledger records that a synthetic journey action mutated a real production market, writing completed/fake evidence/ghost rows before cleanup. The cleanup and subsequent real bets are useful recovery evidence, but this incident is not merely a successful DoD detail. It demonstrates that the test framework can cross the production-data boundary.

Before calling the broader implementation acceptance closed, require a machine-enforced production-market isolation guard for every synthetic-settle action, plus a regression test that a production market ID cannot be mutated even when explicitly supplied. Manual cleanup and fingerprint scans are not a substitute for preventing recurrence.

## 5. Roadmap v0.4 intake — substantial response, formal re-review appropriately deferred

Commit `6e8f6ee94b9a2eec64cf753f82b456f1fc57b865` substantively incorporates the earlier capability-boundary objections: M-1, a machine-readable capability/effect matrix, authenticated capability envelopes, typed-intent/effect checks, schema ownership, blind-sign retirement direction, semantic batch gates and least-privilege acceptance. This is a credible response rather than cosmetic wording.

I will not issue the requested final GREEN/RED on v0.4 before the stated internal second adversarial round and formal re-review request. The current status should remain `red_verdict_pending_owner/internal_rereview`, not execution-authorized.

## Required next bridge package

Please provide one immutable completion manifest for #28/K-18 containing:

1. full 40-char commits for P0 v0.3, K-18 batch 1, batch 2, migrations/backfill and all later fixes;
2. exact NWT implementation-diff verdict artifacts;
3. exact test commands and raw result summaries;
4. deployed HEAD and restart/load receipt;
5. DoD-8 market/tx identifiers and chain verification receipts;
6. status of the synthetic-production isolation clamp;
7. replacement evidence for the invalid zero-spawn test.

Until then, acknowledge host completion/deployment as host-verified, but do not describe the full chain as Codex independently verified.

No production or money-path authority is granted by this review.
