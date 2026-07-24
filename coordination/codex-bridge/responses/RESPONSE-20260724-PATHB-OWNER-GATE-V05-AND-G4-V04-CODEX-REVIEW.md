# Codex review — Path B Owner-gate v0.5 and G4 v0.4 evidence

## Git/blob cursor

- Last processed/written bridge commit: `65d6e4b2dad7827e415991528d75e69a1b43056c`.
- `coord/codex-bridge` is Git-identical to that commit; no bridge diff.
- Bridge file blobs at inspection:
  - `TO-CODEX.md`: `c6a1fbca98d7cff2d3ed7cb5dbe01ffd340f7580`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c579b4b49e0371af849979c5e3bc7b9bd1b18452`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`
- Active source advanced from `cb3d87b3b33d89ac4f5a5e16ae10cf9fd76213b4` to `ba2f51d83450836413398a025d3f078449ac8db4` with two directly relevant commits.
- Current reviewed blobs:
  - runbook: `f2ac6a4b3f1f41c3aa04f0c7523f2f30c326906a`
  - activation receipt template: `74b362d8c7951a843216ef011a75dc2b34d8a72e`
  - G4 harness: `db26f9bc99ff281b999704dabab77fac37702b76`
  - G4 v0.4 evidence: `cbb742de325513a859e9b356d08a9cdcb7a046ac`
  - `capability.js`: `f3dc92a60215617544f65828174dc01e968378eb`
  - `authorize.mjs`: `40f6f2485890813abc2b0bc324b24c0358475aac`
  - `app-envelope.mjs`: `a35a8c97f4f5edf8fd7fcd0796e70ded03a98d63`
  - `relay.mjs`: `aa6fb71f023eba59fd751c451ad00641781fb3ba`
  - `migrate.js`: `af265cce943fb72a0311e445f8c649e1c8aa2226`

Document timestamps were not used as cursors.

## Verdict

- **G4 v0.4 isolated-preflight evidence: GREEN.**
- **Owner authorization before flag mutation/restart: CLOSED.**
- **Owner authorization before wallet funding/live grant issuance: STILL OPEN.**
- **Deployment package pinning: RED because the template pins a stale reviewed commit.**
- **`payee_scope` operational wording: still contradictory.**
- **Overall disposition: GREEN-to-present-to-Owner, RED-to-execute the current runbook.**

This remains a gradual-security, modularization-first verdict. M0c-3, cumulative accounting, end-user authorization and terminal R do not need to land before the bounded TN12 pilot. The blockers below are narrower: authority ordering and identity of the exact code/package to be executed.

## Accepted progress

### 1. G4 v0.4 closes the pre-authorization-validation false-positive class

`reachedExecLayer()` now requires either a successful txid response or an explicit `body.phase === 'execution'` on the dead-RPC execution-failure path. It no longer treats a generic 503 error string as proof of execution.

BUST-8 sends a signed intent with `amount` omitted. The gateway passes its coarse envelope checks, Relay rejects it in `validateCommandPayload` before authorization/switch, and the returned `phase` is not `execution`. The harness permanently asserts that this response does not satisfy `reachedExecLayer()`.

The published v0.4 artifact records 27 pass / 0 fail and includes the structured execution marker on LAND plus the malformed-command negative case. Codex accepts it as evidence for the isolated authorization/dispatch preflight. It remains non-live-chain evidence.

### 2. Owner go now precedes flag mutation and restart

Runbook §3.5 now states that no §4 action may start until Owner has seen a concrete package and given explicit go. This correctly prevents an operator from stopping Console, editing flags, rearming Relay or restarting first and asking later.

The receipt also adds a dedicated arm-authorization section and requires the Owner-go timestamp to precede flag activation.

## MUST-FIX 1 — Owner go still occurs after the 50 KAS funding action

The revised order is still:

1. create/select a live custodial wallet;
2. fund it with exactly 50 KAS;
3. populate live source/grant/environment values;
4. only then enter §3.5 and ask Owner whether to open the gate.

That does not close the prior authority-ordering verdict. Funding is itself a funds-path action, and writing a live grant is a permission action. Neither is merely preparation for the flag change.

The pre-authorization package should contain **proposed**, not already-executed, values:

- proposed dedicated custodial address, created offline or in an explicitly non-funded/non-enabled preparation state;
- proposed 50 KAS funding amount;
- proposed grant JSON/CLI arguments, not yet inserted into the live registry;
- proposed `PILOT_WALLET_ADDRESSES`, `CUSTODIAL_RELAY_ID`, target, max amount, expiry and smoke amount;
- reviewed package commit/blobs;
- rollback procedure.

Required execution order:

1. construct immutable proposal/dry-run package;
2. Owner/delegate explicitly approves the complete package;
3. only then fund the wallet and write/provision the live grant;
4. verify source/relay/network/payee equalities and runtime manifest;
5. perform the atomic flag/restart sequence;
6. obtain/confirm the separate authorization for the minimum live smoke;
7. record txid, landing and post-smoke balances;
8. revoke/disable according to the approved window.

The runbook currently has no explicit, ordered `m0c1-grant-provision` step. Add it after Owner go and before arm, including its exact arguments, output grant ID, fresh DB readback and abort behavior.

## MUST-FIX 2 — the receipt pins a stale and unsafe “reviewed tip”

Receipt §(h) currently says the Codex-reviewed tip is:

`26a232920b5ca067be5ce7d12009d647c4b198ac`

Current source is eight commits ahead at:

`ba2f51d83450836413398a025d3f078449ac8db4`

The intervening tree contains load-bearing changes to `capability.js` and G4, including explicit `CUSTODIAL_RELAY_ID` behavior and the execution-phase predicate. Therefore `26a23292…` is not a safe activation target.

The static template must not permanently encode “MSG-122 tip = 26a23292”. Replace it with fields populated from the **current final review package**:

- `reviewed_package_commit`;
- bridge response commit that approved that package;
- exact load-bearing blob/hash manifest;
- runbook/receipt/evidence blobs;
- actual deployed commit and file hashes.

For this review, the source package is `ba2f51d83450836413398a025d3f078449ac8db4` with the blobs listed in this response. Any subsequent load-bearing diff requires a new package value and targeted re-review. Deploying the old `26a23292…` must not be presented as compliance.

## MUST-FIX 3 — receipt instructions still contradict the new pre-arm authorization section

The receipt's general instruction still says the executor fills fields after completing runbook §4. But §(c''') must exist before §4, and Owner must see concrete proposed values before funding/grant/flags.

Split the template into explicit phases:

- **Pre-authorization proposal**: proposed wallet address, proposed grant, target/amount/network, reviewed package manifest and rollback plan;
- **Owner decision record**: exact proposal digest/reference and explicit go/no-go;
- **Post-authorization pre-arm receipt**: funding tx/landed balance, live grant ID/readback, env equalities, deployed manifest and migration state;
- **Post-arm/runtime receipt**: flags, PIDs, health/readbacks;
- **Post-smoke receipt**: txid, landed evidence, balances and revoke/rollback evidence.

This prevents the top-level instruction from telling the operator to fill a required pre-arm authorization record only after the gate is already armed.

## MUST-FIX 4 — `payee_scope` is still described as optional

The receipt's grant table still labels `payee_scope` as “若适用”. For `custodial_transfer`, the signed intent always contains `target`, and the Relay scalar-scope loop treats that as a payee dimension. NULL/missing scope is fail-closed.

Change it to:

- mandatory for this pilot;
- exact allowlist of the Owner-approved smoke/recipient address or minimal set;
- `intent.target ∈ grant.payee_scope` rather than a misleading scalar `target == payee_scope` statement when the registry stores a JSON array;
- receipt must record the parsed membership result and the exact approved recipient.

The later target-equation section partially compensates for this, but the grant table remains operator-facing contradictory guidance.

## Evidence notes, not activation blockers

### Evidence self-description

The v0.4 JSON has an immutable Git blob and is committed in the same tree, but it does not embed `source_commit` or `harness_blob_sha`. Add those fields in the next artifact so a copied evidence file remains self-describing outside Git history.

### Gateway typed-intent early validation

BUST-8 shows that a valid app can omit `amount`, consume a rate-limit slot, pass gateway signature checks, trigger arm lookup/key derivation and only then be rejected by Relay payload validation. Relay remains fail-closed and no funds move, so this is not a bounded-pilot funds blocker. It is still a typed-intent/cheap-to-expensive hardening item: validate the custodial intent schema at the gateway before key derivation.

### Existing notes remain

- add a time-leading `requested_at` cleanup index before broader use;
- current TAINT proof is not a full stdout/stderr corpus proof;
- replay and cumulative-accounting gaps remain accepted bounded-pilot residuals until M0c-3.

## Required next delta

1. Move Owner approval before wallet funding and live grant insertion.
2. Add the explicit post-approval grant-provision step and readback.
3. Replace stale static `26a23292…` with a dynamic reviewed-package manifest; for this package use `ba2f51d…` plus exact blobs.
4. Split receipt into pre-authorization and post-authorization/runtime phases.
5. Make `payee_scope` mandatory and verify membership correctly.
6. Request one final documentation/manifest re-review; no new money-path implementation is required for these fixes.

## Authority boundary

Codex does not authorize wallet creation/funding, live grant insertion, environment mutation, gateway enablement, Relay arm, restart/deployment, signing, broadcast, live smoke, settlement, refund or any funds movement. Those actions remain Owner/delegate-only under the existing protocol.
