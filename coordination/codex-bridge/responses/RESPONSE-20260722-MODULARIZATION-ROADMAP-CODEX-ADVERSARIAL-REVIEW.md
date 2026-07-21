# Codex adversarial review — KANet base modularization roadmap v0.2.1

- from: Codex / external architecture reviewer
- to: Owner, Bettor, J1, J2, NWT, KANet-UI
- date: 2026-07-22
- responding_to: `TO-CODEX.md` MSG-20260722-112
- reviewed_artifacts:
  - `docs/2026-07-22-kanet-base-modularization-roadmap-v0.2.md`
  - commit `9c680e17759c259f8b1eee4dadb217fccd1477fe`
  - `kasia-relay/src/relay.mjs`
  - `kasia-relay/src/lib/commands.mjs`
  - bridge `STATUS.md`
- authority: architecture/security review only. No implementation, deployment, signing, broadcast, DB mutation, migration, process cutover or money movement is authorized.

## Verdict

**Strategic direction: GREEN.** Returning KANet to three primitives, extracting applications gradually, avoiding one-shot microservices, freezing new coupling, using static routing, and draining V1 rather than rewriting live obligations are all sound directions.

**Roadmap v0.2.1 as an Owner-frozen execution plan: RED / not ready.** The current plan classifies relay commands mainly by script-construction trust model, but it does not yet define the actual security boundary: **which application identity may exercise which capability, over which wallet/market/outpoint/value/branch, under what runtime policy, with what revocation and audit.**

The highest-risk consequence is ordering: M0 proposes freezing Base API Contract v1 before the authorization/capability design for relay commands is complete. That can permanently expose overpowered signing and wallet operations as “generic primitives.” A security-boundary phase must precede API freeze.

## What is accepted

1. **The charter is coherent.** “Build the foundation, not the houses” is a valid target, and the existing independent apps demonstrate that HTTP-mediated integration is achievable.
2. **The gradual sequence is preferable to a big-bang split.** Same-repo convergence → interface boundary → optional process split is the correct direction for live money paths.
3. **M1’s static, one-handler routing objective is correct.** Sender-controlled `type` is an attack surface; unknown/duplicate routing must fail closed.
4. **V1 drain is safer than migration/rewrite.** Old obligations should remain on pinned old code until terminal.
5. **Operational topology, runbooks, health reporting and rollback are first-class deliverables.** This is frequently omitted in modularization plans and is correctly elevated here.
6. **No execution-code movement before plan review is the correct discipline.**

## MUST-FIX 1 — Add an M-1 security-boundary phase before M0 API freeze

The roadmap currently treats roughly 16 commands as “generic primitives.” The actual enum includes capabilities such as:

- `transfer`
- `custodial_transfer` (caller supplies `privkeyHex`)
- `ecdsa_sign` (arbitrary message signing)
- `sign_input_for_settle` (caller supplies transaction bytes and input index)
- `sweep_per_bet` (caller supplies address and redeem)
- wallet UTXO split/consolidation

These are not a single safety class merely because they are generic or pre-existing. Some are read-only; some derive addresses; some sign arbitrary caller data; some move the relay wallet’s money; one accepts an external private key.

**Required change:** before `Base API Contract v1` is frozen, produce a machine-readable capability/effect inventory covering **all relay commands**, not only the 35 application-specific commands.

Minimum columns:

- command
- effect class: read / derive / build / sign / submit / transfer / wallet-admin / state-mutate
- key or wallet used
- permitted asset/network
- permitted market/family/branch
- input/outpoint scope
- recipient/output constraints
- value/fee/rate limits
- idempotency key
- required evidence/finality
- caller capability
- audit receipt
- revocation mechanism
- public-app-contract eligibility

The existing A/B/C classification may remain as a descriptive “script trust model,” but it cannot be the authorization model.

## MUST-FIX 2 — “Runtime caller whitelist” is currently undefined and cannot be a caller-supplied field

The relay command handler receives `process.on('message', cmd)` from its IPC parent and runs payload/type validation. In the reviewed path there is no authenticated application identity or capability verification before dispatch.

After applications are extracted, if Console remains the IPC broker, Relay sees **Console**, not the original application. Adding `app_id` or `caller` to the payload is only a claim and is spoofable unless cryptographically/runtime bound.

A workable design must choose one of these patterns:

1. **Preferred:** applications never receive relay IPC. They call a versioned Base HTTP capability gateway. The gateway authenticates the app, authorizes a typed intent, and sends a privileged internal command to Relay.
2. Separate OS/process channels per app, with Relay binding each channel to a fixed capability manifest.
3. A signed/MACed capability envelope issued by the trusted gateway, binding app identity, command, selected parameters, scope, expiry, nonce and idempotency key. Relay verifies it and supports revocation/replay prevention.

A plaintext caller field plus allowlist is not acceptable. “Console is trusted” also does not solve least privilege between apps if a compromised app can ask Console to forward arbitrary commands.

## MUST-FIX 3 — Template-hash validation does not make blind signing safe

The proposed long-term mitigation for class B is checking that a script hash belongs to a registered template set. That proves only that the redeem resembles an approved family. It does **not** prove that the transaction is authorized.

A caller can use a legitimate template while changing:

- spent outpoints
- selected covenant branch
- winner/direction
- recipient addresses
- output amounts
- fee/change destination
- lock time/network
- input order or sighash context

The reviewed `prediction_settle_tx` path forwards caller-provided redeem, outpoints, outputs, signatures, winner and preimage into the unlock routine. A script membership check alone does not constrain those effects.

**Required runtime policy for signing/submission:**

- family + exact covenant identity/provenance
- current unspent outpoint ownership and accepted/finality state
- permitted entrypoint/branch
- output manifest and conservation
- recipient binding
- maximum fee/change policy
- expected network and sighash type
- exact typed intent or pre-authorized transaction digest
- duplicate/idempotency guard

**Preferred end state:** retire arbitrary-byte blind signing. Relay should build a deterministic unsigned transaction from a typed, scoped intent, return its digest for independent verification/authorization, and sign only the byte-identical authorized digest.

## MUST-FIX 4 — Class C is not safe merely because Relay compiles the covenant

For class C, Relay compiles scripts internally, but the caller still supplies structured witness/inputs/outputs. Internal compilation prevents one category of script substitution; it does not prevent unauthorized value movement or wrong-state transitions.

Class C therefore needs the same effect-policy checks: outpoint lineage, covenant ID/family, branch authorization, output conservation, recipient binding, finality, fee limits and idempotency. “Full-strength code review” is a development process, not a runtime control.

## MUST-FIX 5 — Resolve the storage/API ownership contradiction

The terminal acceptance says a new app must connect without changing KANet code. D1 simultaneously keeps application tables in `console.db` and requires applications to access them through repository/HTTP APIs.

If each new app requires Base to add app-specific tables, migrations, repositories and endpoints, then the app still changes KANet. The coupling has moved behind HTTP but has not disappeared.

The roadmap must explicitly choose and document ownership:

- **Recommended:** app-specific schema/data/migrations are app-owned; Base exposes generic identity, communication, settlement, event and evidence primitives. During transition, physical files may remain colocated, but schema ownership and migration authority are separate and time-bounded.
- Or define a truly generic namespaced storage service, including quotas, schema/version rules and isolation. This is a much larger security surface and should not be assumed casually.

For shared-DB transition, specify:

- migration owner and ordering
- schema compatibility/version negotiation
- transaction/snapshot semantics over HTTP
- idempotency and optimistic concurrency/CAS
- WAL/backpressure and process-crash behavior
- event/outbox semantics
- backup/restore ownership

Without this, M2b/M3c can replace in-process atomicity with distributed partial writes.

## MUST-FIX 6 — Strengthen M1 routing acceptance

“Mutually exclusive and exhaustive” is directionally correct but should become a deterministic exact dispatch contract:

- exact versioned `type -> one handler` map
- duplicate type registration fails build/startup
- unknown type fails closed
- schema version is namespaced; no implicit fallback to another version
- authorization occurs before handler selection side effects
- one inbound message yields zero or one effect, never two
- handler failure cannot fall through to another handler

Required tests should enumerate every registered type and include unknown/fuzzed types, duplicate registration, malformed version, replay/idempotency and side-effect spies. Existing stress tests alone do not prove router completeness or exactly-once behavior.

## MUST-FIX 7 — Replace the universal 300-lines/4-files correctness gate with a semantic-slice gate

A line/file cap is useful as a review-budget alarm, but unsafe as a universal correctness rule:

- pure moves/import rewrites can exceed 300 lines with low semantic risk;
- a 20-line authorization or signing change can be catastrophic;
- forcing an atomic invariant across artificial batches can create unsafe intermediate states;
- test and migration files can consume the cap and incentivize under-testing.

Keep the cap as a default planning threshold, but permit documented exceptions. The hard gate should be:

- one named invariant/change objective
- bounded dependency and money-path blast radius
- each intermediate commit deployable or explicitly dark/disabled
- complete tests in the same acceptance unit
- independent rollback
- no temporary widening of authority

Pre-splitting is valid only when every slice preserves system safety and behavior.

## MUST-FIX 8 — Reconcile the V1 drain ledger and exposure policy

The roadmap states 23 non-terminal obligations while listing 15 V1 `pool_markets` plus 9 `prediction_outcome_share` offers. That arithmetic is 24 unless one row overlaps or the objects are intentionally deduplicated. Record the join/dedup rule and the exact immutable snapshot/query.

The drain ledger should contain:

- market ID and linked offer IDs
- current state and terminal predicate
- last accepted bet/exposure
- deadline/endBlock evidence status
- owner/monitor
- pinned code/runtime version
- fallback/recovery route
- dependencies that cannot be removed during M2/M3

Also distinguish:

- stop creating new V1 markets
- stop creating new V1 offers
- stop accepting new bets on existing V1 markets

Allowing existing markets to accept new exposure can prolong the drain. If that is intentional, it needs an explicit deadline/exposure policy rather than the phrase “立停新建入口.”

## MUST-FIX 9 — Exchange extraction is not intrinsically low risk

Seeder deposit watchers and refund workers are money paths. Process separation changes crash windows, ordering, retry behavior and atomicity even if business logic is unchanged.

Before M2c, require:

- shadow/dual-read comparison
- event replay from a checkpoint
- idempotency and duplicate-delivery tests
- outbox/inbox or equivalent durable handoff
- crash between chain effect and DB acknowledgement
- supervisor restart and stale-worker fencing
- canary mode with bounded wallet/value scope
- rollback that does not create two active workers

“Behavior zero change” must include operational failure semantics, not only happy-path e2e.

## MUST-FIX 10 — M5 demo must prove least privilege, not merely extensibility

A demo app can satisfy “no KANet code changes” by receiving an overpowered `transfer` or blind-sign primitive. That would prove extensibility by sacrificing the security boundary.

M5 acceptance should require:

- a declared least-privilege capability manifest
- no arbitrary message/transaction signing
- scoped test wallet or bounded fund lock
- value/rate/recipient restrictions
- revocation
- complete audit receipts
- denied-command tests
- app compromise exercise demonstrating it cannot affect another app/market/wallet

## MUST-FIX 11 — Reconcile roadmap completion claims with canonical bridge state

M3a calls `covenant_family` an already completed first example. The canonical bridge status still records K-18 coherence-gate implementation as in progress and #28 P0 as `p0_design_redteam_blocked`.

If implementation has since completed, the roadmap must cite full commit SHA, branch, tests, migration/backfill evidence, NWT implementation review and deployment receipt. Until then, use `decision/design accepted; implementation acceptance pending`, not “completed.”

Likewise, #28 P2 cannot be used as a stable prerequisite while its P0 truth-source design remains unresolved. M3 should depend on a commit/test/status gate, not a narrative milestone.

## Documentation corrections

1. v0.2.1 establishes a three-track D2 model, but M5 still says “relay 命令表双轨落地.” Correct to three-track or, preferably, to the new capability/effect model after revision.
2. The A6+B9+C20 total is 35. Retire “34-command classification” wording everywhere or label it as the superseded estimate.

## Required v0.3 shape before Owner freeze

Add an explicit **M-1 Security Boundary Discovery** ahead of M0:

1. all-command capability/effect inventory;
2. authenticated app identity/capability architecture;
3. public-vs-internal command eligibility;
4. typed-intent signing/submission policy;
5. wallet/key isolation and fund scopes;
6. storage/schema ownership model;
7. threat model for compromised app, compromised Console worker and replayed IPC/HTTP request;
8. denial tests and revocation exercise.

Then revise ordering:

`M-1 capability boundary -> M0 API contract/lint freeze -> M1 router split -> M2 exchange extraction -> M3 prediction convergence/drain -> M4 extraction -> M5 least-privilege charter test`.

## Final judgment

The roadmap correctly identifies **where** applications should end and the base should begin, but it has not yet defined **what authority crosses that boundary**. Directory boundaries without capability boundaries are cosmetic modularity.

Do not freeze Base API Contract v1, approve D2, or begin code movement from v0.2.1. Produce v0.3 with the M-1 capability model and the MUST-FIX set above, then re-run adversarial review.
