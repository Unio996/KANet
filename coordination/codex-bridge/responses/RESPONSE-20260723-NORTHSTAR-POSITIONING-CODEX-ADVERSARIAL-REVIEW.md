# Codex adversarial review — North-star positioning truth boundaries

- review_scope: `docs/KANet-Positioning.md`, `docs/DEVELOPER-GUIDE.md`
- source_branch: `bshard-m3-deploy`
- reviewed_head: `759c115405cb277f26117644d4cdb0279975a266`
- relevant_commit: `af952dd92113ac2619242bea83e968ea33896666`
- positioning_blob: `f820c0c24147d540d4bd8d5dba9d6b122c1fe58c`
- developer_guide_blob: `3be9e74671e12d628ae41aefe157af61d59b4f09`
- bridge_cursor_before_review: `e20fdc82ec86dbcae2d1a3a2d0c8d2446e84ede1`
- authority_boundary: technical/document-integrity verdict only; no production or money-path authority

## Verdict

- North-star direction: **GREEN**.
- The four-pillar framing (OS-like base, open participation, pay-for-effect, covenant-enforced settlement): **GREEN as a target vision**.
- `KANet-Positioning.md` as a canonical statement of current architecture and verified capabilities: **RED — target/protocol/current/demo layers are conflated**.
- Making that document the mandatory pre-code authority through `DEVELOPER-GUIDE.md`: **RED until the factual boundaries below are corrected**.

The problem is not ambition. The problem is that several target-state or layer-scoped claims are written as unconditional present-tense facts, while the repository and already accepted evidence directly refute them. A north star may point beyond the current system; it must not erase the ground beneath it.

## Verified contradictions

### 1. “DB data can be fully reconstructed from the chain” is false

`KANet-Positioning.md` states under the core principles that the chain is the truth source, DB is only an index, and data can be completely rebuilt from the chain. It also describes the chain as the permanent truth source in the persistence section.

Gate 0 already proved the opposite for TN12: transaction bodies and accepting-block evidence below the pruning boundary can be physically unavailable, while RPC may return empty transaction data rather than an explicit reconstruction error. `side_lock_daa`, bet-level accepting-block evidence and other preimages cannot always be recovered after the fact.

Required replacement model:

1. **Current canonical chain state** — UTXO/current consensus authority.
2. **Durable evidence ledger** — transaction bytes, prevouts, accepting block/DAA, script/redeem, family, amounts, state/preimage hashes and receipts that pruning may otherwise destroy.
3. **Rebuildable cache/index** — DB projections that really can be regenerated from layers 1 and 2.

“DB is only an index” is acceptable only for fields demonstrably derivable from retained authoritative evidence. It is not a universal architecture rule.

### 2. “Console only transmits and does not touch the chain” is false in the current system

The role table says:

> Console — transmits, does not decide, does not touch the chain.

Current code makes Console part of the chain-key custody and lifecycle control plane:

- `relay-manager.js` calls `getRelayPrivkey()` / `getRelayMnemonic()` inside the Console process;
- it receives plaintext Relay signing material;
- it injects `KASPA_PRIVKEY` / `KASPA_MNEMONIC` into the Relay child environment;
- it owns all child handles and can stop, kill and restart Relays;
- the current M-1.6 v0.3.1 therefore correctly records Console and its key holders/OS principal/writable Relay code+DB as part of the gradual-phase TCB.

The positioning document must distinguish:

- **current state**: Console is an orchestration, key-custody and Relay-lifecycle control plane;
- **target R state**: Console no longer reads Relay keys or controls a mutable verifier/key boundary.

Writing the target role as the current role would undo the honesty gained in M-1.6.

### 3. “KANet does not custody funds” conflicts with the current TN12 demo implementation

The Track B legal/positioning boundary is valid as a protocol aspiration: an open-source protocol need not itself operate a market.

But the current repository includes an explicit custodial wallet path:

- `tg_custodial_wallets` stores encrypted mnemonics;
- Console decrypts a user mnemonic just in time;
- derives `privKeyHex`;
- sends it to Relay through `custodial_transfer`;
- the subject-binding containment remains technically RED for implementation readiness.

Therefore the canonical wording must be layered:

- **protocol/target**: KANet base should not require custody and third parties may self-host/fork;
- **current TN12 demonstration**: includes an opt-in custodial convenience path controlled by the operator, with known subject-binding and key-custody debt;
- **team/business claim**: whether a particular operator “operates” a market is a separate factual/legal statement and cannot be inferred solely from MIT licensing.

A Track B label does not make Track A code disappear.

### 4. “Permissionless access” is being confused with unrestricted capability use

The new north-star text says any program or Agent can connect permissionlessly. M0c, however, correctly requires:

- non-self-asserted caller identity;
- default-deny command exposure;
- authoritative grants and scoped typed intents;
- durable replay protection, audit and revocation;
- no extracted-app Relay reachability until M0c GREEN + R closure.

These are not contradictions if the terms are separated:

- **permissionless protocol participation**: anyone may run/fork compatible software, publish an identity or communicate under protocol rules;
- **authorized use of a particular deployed instance’s wallets, Relays and money paths**: requires scoped capability grants;
- **end-user authorization**: remains distinct from app/service identity.

“Permissionless” must never be read as “any caller may ask this operator’s Relay to sign or spend.”

### 5. “No controller / no administrator” is true only at a narrowly named layer

The consensus layer may be described as lacking a single application administrator. The present KANet application stack nonetheless has:

- Owner/delegated authority for deployment and money paths;
- operator-controlled processes and databases;
- admin endpoints and shared secrets;
- committee/oracle attestations;
- feature flags, migrations, restarts and recovery decisions;
- explicit human adjudication/refund exceptions.

Required wording:

> Kaspa consensus is not controlled by the KANet operator; the current KANet testnet implementation still has application-level operators, authorities and trusted components, whose scope is being reduced through M0c, R, covenant enforcement and evidence continuity.

Do not project a consensus-layer property upward onto every application layer.

### 6. “Covenant judges the effect correctly and automatically pays” is too universal

Covenants can enforce rules and state transitions encoded in the script and committed state. They do not independently know every real-world fact.

Current prediction paths still involve external predicate evidence, judge/oracle outputs, committee signatures, abstention and evidence-continuity requirements. A covenant can verify that an authorized/committed result is used consistently; that is not always the same as independently determining the external truth.

Required calibration:

> Where an effect and its proof can be encoded or committed, covenants mechanically enforce the authorized transition and payment. External facts may still require independently accountable oracle/attestation inputs, deterministic derivation, abstention and durable evidence.

This is stronger and more credible than claiming all effects are already machine-judged without external authority.

### 7. “Zero-change HTTP access is already the default” is premature

The KAS Market Maker demonstration is useful evidence that an external system can integrate through HTTP. But the roadmap itself says the secure, least-privilege default interface is not complete until M0c and R are closed and M5 acceptance passes.

The document should say:

- a host/demo integration has demonstrated the shape;
- turning it into a safe default capability for arbitrary third-party applications remains a roadmap deliverable;
- no app receives Relay reachability merely because an HTTP endpoint exists.

## Required document structure

Before these files are treated as canonical engineering guidance, add explicit statement classes, for example:

- `[PROTOCOL]` stable protocol/layer property;
- `[CURRENT]` repository-verified current implementation;
- `[TARGET]` desired end state gated by named milestones;
- `[DEMO]` host/testnet demonstration, not a general public guarantee;
- `[OPERATOR POLICY]` a chosen organizational/legal boundary, not a protocol theorem.

At minimum, revise the claims listed above and link the relevant grounding:

- Gate 0 evidence-continuity result;
- M-1.6 v0.3.1 and R acceptance baseline;
- M0c default-deny/grant boundary;
- custodial subject-binding containment status;
- Track A versus Track B distinction.

## Acceptance criteria for re-review

1. No statement says all DB data can be rebuilt from the chain.
2. Current Console key/lifecycle custody is stated honestly; “does not touch chain” is target-only or removed.
3. Protocol non-custody and current custodial demo are explicitly separated.
4. Permissionless participation is separated from scoped money-path capability.
5. “No controller” is scoped to the consensus/protocol layer, not the current application stack.
6. Covenant claims distinguish mechanical enforcement from external-fact acquisition/attestation.
7. HTTP zero-change integration is labelled a demonstration; safe general access remains gated on M0c + R/M5.
8. `DEVELOPER-GUIDE.md` points to a document whose current/target labels are machine-reviewable or at least visually unambiguous.

## Scope boundary

This review requests documentation corrections only. It does not authorize or request production code changes, process restarts, credential provisioning, database mutation, signing, broadcasting, settlement, refunds or fund movement.
