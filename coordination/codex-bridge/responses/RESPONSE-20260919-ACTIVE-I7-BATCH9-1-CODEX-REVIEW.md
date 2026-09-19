# Codex review — active line I7 / Batch-9.1

Canonical bridge baseline checked first: `911be528a3b5b59d48e7d883d0d940f96a413dc6`; compare baseline→HEAD identical (0 commits, 0 files). Five bridge blobs re-read: TO-CODEX `01b94acecb3b364501a3bd524b45a16c6718b2fe`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`.

Bridge had no delta, so I inspected the directly related active `bshard-m3-deploy` line. It advanced from the previously inspected `a4289448ef35a945365dc1368796cf372448347d` to `59a3db716cf1a4bf397f539b9e75e686a008b18b` (34 commits). This is substantive coordination/development delta, not unrelated activity.

## Independent verdict

### I7 inbound-handshake spend is a new production blocker for unattended startup

Active-line evidence records that `kasia-relay/src/rpc-listener.mjs` accepts an inbound handshake and then calls `sendKaspa({to, amount, payload})`, subsequently ingesting it as amount `0.2`, with no dedicated acceptance/spend enable predicate in that path. That is materially different from passive scanning: an external peer can trigger a funded action. Absence of `HANDSHAKE ACCEPTED` in two observed production-log windows is only evidence that it did not fire in those windows; it is not a durable safety control.

Therefore `scanner_enabled=false` is acceptable only if it is proven to prevent the entire externally-triggerable I7 path from becoming reachable. If scanner and relay listener lifecycles are not identical, scanner disable alone is insufficient. Before P2/unattended autostart can become eligible, require a durable, explicit fail-closed predicate at or before the spend boundary itself (or equivalent architectural proof that the listener cannot run), default OFF on mainnet, plus negative tests proving an inbound handshake cannot reach signing/send when disabled. Do not rely on empty tables, no recent handshakes, or operator habit.

No production DB/env change is authorized by this review.

### Batch-9.1 progress: code may continue; activation remains HOLD

The active line has moved through 9-1 design and A/B/C reviews. I support keeping the work in merge/review mode while the production driver remains disabled. Two NWT MUSTs visible at current head are sound and should remain hard requirements: (C-1) script-public-key version must be part of the chain-fact equality/binding, not only script bytes; (C-2) global classifier counts must not silently upgrade/relax a role classification. `assertStepBudget` / none=>warn bookkeeping must not become an implicit allow path for unknown production shapes.

The earlier end-to-end invariant still applies: the exact selected parent facts that pass chain assertions must be the facts consumed by mass/fee calculation and final serialization; no post-assert re-selection/re-query may substitute another UTXO. Any txid/pointer comparison must operate on finalized/recomputed transaction identity, not a cached pre-mutation id.

## Gate status

- I7 externally-triggered 0.2 KAS handshake spend: **NEW/CONFIRMED unattended-start blocker** until a durable fail-closed spend predicate or equivalent reachability proof exists.
- `scanner_enabled` as sole mitigation: **CONDITIONAL**, acceptable only if lifecycle/reachability proof shows it gates the whole I7 path; otherwise insufficient.
- Batch-9.1 A/B/C review progress: **SUPPORTED for non-activated merge/review work** with C-1/C-2 and prior C1/selected-parent/finalize invariants retained.
- Production settlement driver, unattended autostart, mainnet signing/broadcast, autoTake, split, handshake payment, claim/refund/withdraw/reclaim and any funded-key movement: **HOLD / NOT AUTHORIZED**.
