# Codex review — Path B runbook/receipt v0.7 unsynced fixes

## Cursor and reviewed objects

- Last processed bridge commit: `405d56e2e51dc1fa5318076f74941c1a9bb0c1f5`.
- `coord/codex-bridge` remained Git-identical at check time; no bridge-file diff.
- Active source advanced from `ba2f51d83450836413398a025d3f078449ac8db4` by 2 commits to `cc805bf1312a28f46206751161e86c3fb2cb5336`.
- Directly relevant changed files:
  - `docs/2026-07-23-m0c-1-pilot-activation-runbook.md`, blob `dea2b64a8a328c13196dd231d11615f3631601a5`
  - `docs/2026-07-24-m0c-1-pilot-activation-receipt-template.md`, blob `faee6997bd23103afcfb62f150d8c6777fea69cc`
- Bridge cursor used Git commit/blob/diff only. Embedded document timestamps were ignored.

## Verdict

- **Pre-funding / pre-grant Owner gate: CLOSED.**
- **Explicit live grant provision step: CLOSED.**
- **Explicit `CUSTODIAL_RELAY_ID` configuration step: CLOSED.**
- **Architecture/package remains GREEN-to-present-to-Owner.**
- **Operator execution remains BLOCKED by four protocol/document integrity defects.**

The remaining defects are not terminal M0c-3/R requirements. They are contradictions in the procedure that can direct the operator to mutate live state before authorization, verify the wrong deployed package, or record a false runtime check.

## What is now correctly closed

### 1. Owner authorization now precedes funding and grant issuance

The runbook now separates:

1. candidate values only;
2. Owner go/no-go over the concrete candidate package;
3. post-go 50-KAS funding and formal grant provision;
4. flag/restart activation;
5. a second Owner checkpoint for the actual live smoke transaction.

It explicitly forbids funding or grant provision before the first Owner go. This closes the previous “money/grant already moved before Owner sees the package” inversion.

### 2. Grant provision is now an explicit ordered action

Section 3.6 now names `kasia-console/scripts/m0c1-grant-provision.mjs` as the formal writer and requires it to use the already-approved candidate fields. This is materially better than merely assuming a live grant exists later in the procedure.

### 3. `CUSTODIAL_RELAY_ID` now has a proposed value and an explicit write step

The candidate package includes the intended Relay ID, and the post-go sequence explicitly writes it to `kanet.env`. This closes the earlier gap where the receipt verified a value that the runbook never actually configured.

## MUST-FIX 1 — no live relay or custodial-wallet record before Owner go

The new ordering still permits live state mutation before Owner authorization:

- Section 2 says to create the pilot Relay before section 3.5.
- Section 3 permits creating a `tg_custodial_wallets` row before Owner go when needed to obtain the candidate address.

Even without funding, these are not purely descriptive candidate preparation if they occur in the live Console DB or start a real Relay process. They create operational identities, encrypted key material and durable live state before the Owner approves the activation package.

Required clarification and ordering:

- Pre-Owner candidate preparation may generate an address/Relay ID **offline or in an isolated scratch store only**.
- No insertion into live `relay_nodes` or live `tg_custodial_wallets`, no Relay process creation/start and no production key custody mutation before Owner go.
- After Owner go, create/read back the live Relay row and live custodial-wallet row, then prove they match the approved candidate values.
- If the team intentionally wants live row creation to be treated as harmless preparation, Owner must explicitly authorize that narrower preparatory action first; it cannot be silently assumed.

This preserves modularization-first while maintaining the stated authority boundary.

## MUST-FIX 2 — replace the stale reviewed-tip pin and stale fallback prose

Receipt section (h) still hard-codes `26a232920b5ca067be5ce7d12009d647c4b198ac` as the Codex-reviewed tip and requires the deployed commit to equal it.

That commit predates later load-bearing fixes. Current reviewed source is `cc805bf1312a28f46206751161e86c3fb2cb5336`, and the package has advanced through capability fallback removal, execution-phase evidence, runbook ordering and receipt corrections.

A static historical tip inside a reusable template is structurally wrong. Replace it with runtime-filled fields:

- `reviewed_package_commit`
- `review_response_commit`
- `runbook_blob_sha`
- `receipt_template_blob_sha`
- `g4_evidence_blob_sha` / evidence sha256
- load-bearing code blob/sha256 manifest
- deployed commit and deployed-file digests

The approval comparison must be:

> deployed package == package identified in the current Owner decision and current Codex/NWT review

—not “deployed package == MSG-122’s old tip.”

The receipt also still explains `CUSTODIAL_RELAY_ID` as falling back to `FAUCET_RELAY_ID`, although current capability code removed that fallback. Historical context may remain in a revision note, but the CURRENT operator instruction must say:

> explicit `CUSTODIAL_RELAY_ID` is required; missing value fails closed.

## MUST-FIX 3 — `payee_scope` is mandatory and target relation is membership

Receipt section (b) still labels `payee_scope` as “若适用”. For `custodial_transfer`, it is mandatory:

- signed intent contains `target`;
- Relay evaluates the payee dimension;
- NULL/missing `payee_scope` is fail-closed.

The receipt also expresses the relation as `intent.target == grant.payee_scope`. The registry field is a JSON array/set. The correct invariant is:

> `intent.target ∈ parsed(grant.payee_scope)`

For the first pilot, prefer an exact singleton set containing only the Owner-approved smoke destination. Record:

- the parsed full payee set;
- the Owner-approved destination;
- membership result;
- smoke amount;
- pre/post source balance and fee.

Remove “若适用” from the CURRENT table.

## MUST-FIX 4 — receipt phases and environment readback must describe real execution semantics

### A. Receipt filling order still contradicts itself

The template top still says the operator fills fields after runbook section 4, while section (c''') must be completed before section 3.6 and section 4.

Split or label the receipt into explicit phases:

1. **Pre-authorization proposal** — candidate package, reviewed commit/manifest, no live mutation.
2. **Owner decision record** — first go/no-go.
3. **Post-authorization / pre-arm execution receipt** — live Relay/wallet row creation, funding, grant provision, env-file writes and readbacks.
4. **Post-restart runtime receipt** — flags, runtime `process.env`, armed status, deployed PID/commit/schema.
5. **Post-smoke / revoke receipt** — second Owner authorization, txid, landed evidence, balances, revoke and rollback.

The top-level instruction must not say all fields are populated after section 4.

### B. Editing `kanet.env` does not immediately update a running process's `process.env`

Section 3.6 says to write `CUSTODIAL_RELAY_ID` to `kanet.env` and “immediately read back `process.env.CUSTODIAL_RELAY_ID`” before the section-4 restart.

A running Node process does not automatically refresh `process.env` when an env file is edited. Therefore the check as written can read the old value or no value and cannot prove the new file will be loaded.

Use two distinct checks:

- **Pre-restart file check:** parse/read `kanet.env` and verify the intended literal value.
- **Post-restart runtime check:** query the newly started Console process/health path or exercise a safe diagnostic to prove runtime `process.env.CUSTODIAL_RELAY_ID` equals the approved Relay ID.

Do the same distinction for gateway/armed flags. File content and runtime-loaded value are separate evidence layers.

## Additional notes, not current activation blockers

- Candidate address generation can be done offline before Owner go; the blocker is writing it into live state or starting live services before authorization.
- Rate-limit cleanup still lacks a time-leading `requested_at` index; bounded pilot scale keeps it a hardening note.
- TAINT evidence remains narrower than full stdout/stderr corpus capture.
- Replay and lack of cumulative accounting remain explicitly accepted Path-B residuals until M0c-3.
- G4 remains isolated preflight and does not replace the separately authorized TN12 live smoke.

## Required delta before execution can be considered

1. Move live Relay/live custodial-wallet creation after Owner go, or explicitly make candidate preparation isolated/offline.
2. Replace old static reviewed-tip/fallback language with a current package manifest populated per activation.
3. Make `payee_scope` mandatory and verify target membership in the parsed set.
4. Split receipt into pre/post authorization and pre/post restart phases.
5. Replace impossible pre-restart `process.env` readback with file-readback plus post-restart runtime-readback.
6. Request re-review with exact new source commit and runbook/receipt blobs.

## Authority boundary

This review does not authorize live Relay/wallet record creation, key custody changes, wallet funding, grant insertion, `kanet.env` mutation, gateway enablement, Relay arm, restart/deployment, signing, broadcast, live smoke or funds movement. Owner/delegate remains the sole operational authority.
