# Codex review — Batch 9 wiring design / NWT review / host incident

## Scope and compare basis

Canonical bridge was checked first at `0a0cae0411796214499239fcf7eaaf8f6a333c61`, which is also the last Codex write-back SHA. Git compare is identical: ahead 0 / behind 0 / 0 commits / 0 changed files. The five bridge blobs were re-read from GitHub tree/contents, not inferred from in-file timestamps: TO-CODEX `01b94acecb3b364501a3bd524b45a16c6718b2fe`; DISCUSSIONS `313bb29aabc3fe906c721beb528735400de2969c`; STATUS `c4be60e4c4380e1401f2f718d17d94dc19ff7809`; DECISIONS `895334928a0ff58c1b9ca795ea3a27d328005fa4`; FROM-CODEX `0023782bbe6f0fa649100ac726f1c4fbadd3e769`. No canonical bridge delta exists.

The directly related active branch `bshard-m3-deploy` has advanced to `a02cb60b777850346dbc241b28b6cb1522ba2270`. Relevant new coordination/design evidence includes Batch-9 design `ee76d679df6935cf3d391169acf9bf983bf3179d`, NWT review recorded at `a4e8158a932fff7bd801fd045fe59ed401099b5d`, and host-incident follow-up through `a02cb60b777850346dbc241b28b6cb1522ba2270`.

## Independent judgment

### 1. Batch-9 reduced scope remains the right boundary

SUPPORT the four-step scope only: `market_seal`, `close_commit`, `convert_to_claim`, `claim_draw`. `withdraw` and `ticket_reclaim` must remain unreachable from the driver/HTTP wiring. The reclaim fee-estimator deadlock is not repaired merely by the new wiring design.

### 2. NWT M1/M2/M3/M6 are security/correctness requirements, not optional polish

I independently agree with the NWT corrections:

- `covenantId` must be read from the actual wasm UTXO entry location and absence of the expected structural field must fail closed rather than silently normalize to `null`.
- settlement facts and PMT must use the relay's shared RPC client/path used for the submission environment; per-call clients weaken the intended same-node evidence and add avoidable resource churn.
- every new read command must be registered in every authorization/dispatch surface; a partial registration is not a harmless integration bug because it can make the gate appear armed while the read is silently unavailable.
- C1 must compare the selected outpoint and exact expected covenant id, not merely amount/SPK and covenant yes/no. Otherwise two same-value/same-script UTXOs remain substitutable at the assertion boundary.

One additional requirement: C1 should bind **one canonical selected-parent object** through assertion → mass/fee calculation → builder serialization. Do not re-select or reconstruct the outpoint after C1 passes. A correct assertion followed by a second UTXO lookup/reselection would recreate the TOCTOU/parallel-facts class we were trying to remove. Add a mutation test where the candidate set changes after assertion; serialized input must still be the asserted outpoint or the operation must abort.

### 3. R1/R2 read expansion is acceptable only as a narrow 9-0 change

SUPPORT `get_address_utxos facts:true` plus `get_past_median_time` as read-only prerequisites, with unchanged legacy response when `facts` is absent. This is preferable to having Console create its own RPC connection. Keep 9-0 isolated from signing/broadcast behavior and verify the returned SPK/covenantId byte-for-byte against direct node data.

For PMT evidence, record the relay/node identity/configured endpoint together with the PMT observation and submission evidence. Sharing one client object is necessary but the audit artifact should still make it possible to prove which node endpoint supplied both facts; do not treat object identity alone as durable evidence.

### 4. `/resolve` authorization design is directionally sound, but IP is defense-in-depth only

SUPPORT a dedicated `ADMIN_SECRET_SETTLEMENT`, write-once semantics, and checking both proxy-derived `request.ip` and TCP `remoteAddress`. The secret remains the authorization primitive; IP allowlisting is only an additional boundary. Do not weaken the secret requirement for loopback. The XFF-spoof negative arm is required because `trustProxy` changes the meaning of `request.ip`.

### 5. Settlement driver switch separation must be enforced at the single send boundary

SUPPORT a dedicated settlement switch and prefix-based gate at the common send path. Required invariant: `settle:` traffic cannot pass with only legacy `PROTO_DRIVER_ENABLED`, and legacy traffic cannot become enabled by the settlement switch. The 2x2 switch matrix belongs at the final IPC/send boundary, not only in the scheduler. NWT should separately review that diff as planned.

### 6. Host crash is operationally relevant and raises the activation bar

The active branch now records a mainnet-host crash attributed to AI inference exhausting commit memory, with kaspad exiting cleanly and node/Console not auto-started. This is not merely unrelated ops noise because Batch-9 depends on same-node chain facts, PMT and liveness. It does **not** justify auto-restart or production activation.

Before any later Owner production GO, require an explicit host readiness check: node fully synced/healthy, Console connected to the intended node/network, settlement driver still disabled after restart, no stale prepared intent is auto-broadcast merely because services returned, and restart/resume behavior is exercised in an isolated environment. Host recovery and settlement activation must remain separate decisions.

## Decision

- Batch-9 design direction: **SUPPORTED WITH GATES**.
- NWT M1–M6: **ACCEPT**.
- Additional C1 invariant: **MUST bind asserted selected-parent object through serialization; no post-assert re-selection**.
- R1/R2 read-only 9-0: **SUPPORTED**, separately reviewed/tested.
- dedicated settlement switch + final-send 2x2 gate: **REQUIRED**.
- host recovery: **operational prerequisite only; NOT production authorization**.
- production settlement driver, mainnet signing/broadcast, claim/refund/withdraw/reclaim and funded-key movement: **HOLD**.

No production funds-path modification or deployment is authorized by this review.
