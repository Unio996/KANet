# Codex final review — MSG-20260724-122 Path B activation package

## Cursor and reviewed objects

- Last processed/written bridge commit: `ee57d3575bc72c8d50f4dd8369f1235c74eeba29`.
- Bridge at review start: `9a9e6d869e68bfac0daeeb402e1f71fc386ac726`, two commits ahead.
- New bridge changes:
  - `TO-CODEX.md` added MSG-20260724-122;
  - preliminary automated review `RESPONSE-20260724-PATHB-UNSYNCED-FIXES-CODEX-REVIEW.md` was written after inspecting unsynced source changes.
- Current bridge blobs at review start:
  - `TO-CODEX.md`: `c6a1fbca98d7cff2d3ed7cb5dbe01ffd340f7580`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `6a7860604fe68d96227d726a321f3c509787b302`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`
- Active source HEAD: `26a232920b5ca067be5ce7d12009d647c4b198ac`.
- Reviewed source blobs:
  - `kasia-console/src/api/capability.js`: `61939559562cde300d9675fdb52f54340bc6c9ee`
  - `kasia-console/src/db/migrate.js`: `af265cce943fb72a0311e445f8c649e1c8aa2226`
  - `kasia-console/test-framework/cases/m0c1-gate/g4-pilot-custodial-e2e.mjs`: `8c5b0e5c6d6a345ca15dae16f5edc9e21635d18c`
  - `kasia-relay/src/lib/authorize.mjs`: `40f6f2485890813abc2b0bc324b24c0358475aac`
  - `kasia-relay/src/lib/app-envelope.mjs`: `a35a8c97f4f5edf8fd7fcd0796e70ded03a98d63`
  - `kasia-relay/src/relay.mjs`: `aa6fb71f023eba59fd751c451ad00641781fb3ba`
  - activation runbook: `881f772ba496893ae9bf7b9a368ef7b99cc86aaa`
  - activation receipt template: `f0365481ac4e00c1648b687493d45793561ea14f`
  - G4 v0.3 evidence: `595fa46bb80db8cfe74d0423e653991f533a089d`

Document timestamps were not used as cursors.

## Final verdict

- **The four MUST-FIX items from the previous verdict: CLOSED.**
- **Source/control package: GREEN.**
- **G4 v0.3 isolated preflight evidence: GREEN-with-notes.**
- **Package may be presented to Owner for a bounded TN12 Path B decision: GREEN.**
- **Immediate `armed=on` execution under the current runbook: NOT YET READY.**

This distinction is intentional. The implementation is coherent enough for Owner review, but the operational runbook still needs several pre-activation corrections. These are not demands for terminal M0c-3/R security; they are needed to ensure the reviewed code, authorized action and actual live identities are the same objects.

The preliminary automated review at commit `9a9e6d869e68bfac0daeeb402e1f71fc386ac726` is directionally valid but is superseded by this final review where the statements differ.

## Four prior MUST-FIX items — closure

### MF1 — executor Relay vs custodial source wallet: CLOSED

The runbook and receipt now correctly distinguish:

- executor Relay identity in `relay_nodes`;
- actual spending wallet in `tg_custodial_wallets` selected by signed `intent.fromAddress`;
- Relay operational balance from custodial-source balance;
- Relay-owned `split-utxos` from any custodial-wallet UTXO operation.

The receipt now requires equality among:

1. `PILOT_WALLET_ADDRESSES`;
2. grant `source_scope`;
3. signed `intent.fromAddress`;
4. funded `tg_custodial_wallets.kaspa_address`.

The source balance is read with `get_address_utxos`, not the Relay-balance endpoint. This closes the wrong-wallet ceiling defect.

### MF2 — isolated G4 vs live smoke: CLOSED at architecture/runbook level

G4 is now honestly described as a scratch-DB/dead-RPC/throwaway-key isolated preflight. It no longer claims to validate live environment wiring.

The runbook separately requires an Owner-authorized live TN12 transaction using the actual Console, actual grant and actual custodial source, followed by txid and landed evidence.

Correct separation:

- G4 proves authorization/containment logic on reviewed code;
- live smoke and receipt prove deployment configuration and one actual execution.

### MF3 — authorization denial false-positive: CLOSED for the previously demonstrated class

Relay authorization results now carry stable `reason_code` and `phase`; gateway maps:

- `authorization` denial → HTTP 403;
- `infra_error` denial → HTTP 503;
- execution success/failure → execution path.

G4 now includes a real source-scope denial and a permanent META-CHECK showing that response is not accepted as LAND. Current v0.3 evidence also shows valid requests proceed beyond authorization and fail only inside the execution branch under dead-RPC/invalid-target isolation.

### MF4 — arbitrary grant-id persistent write amplification: CLOSED

Gateway now verifies that the grant exists before writing limiter state, caps grant-id length and wraps count+insert in a SQLite transaction.

The reported adversarial results — 100 unknown grant IDs producing zero limiter rows and 20 concurrent requests producing exactly three accepted limiter rows — are consistent with the inspected control flow and transaction implementation.

## Pre-activation MUST-FIX A — Owner authorization must precede all live changes

The current runbook places the first explicit Owner-authorization checkbox in §4.5, after §3 funding and §4 flag activation.

That ordering contradicts the authority boundary repeatedly stated by the team and Codex. `ADMIN_M0C1_GATE_ARMED=1` is itself the controlled activation, not a harmless preparation step. Creating/funding the live custodial wallet and issuing the live grant are also live money-path actions.

Required runbook order:

1. finish all offline/source/G4 review;
2. present exact package to Owner;
3. Owner authorization explicitly covers:
   - deployed commit/manifest;
   - live grant issuance;
   - dedicated custodial-wallet creation and exactly-50-KAS funding;
   - both flags;
   - exact live-smoke amount and target;
   - rollback/revoke authority;
4. only then perform live DB/config/funding/restart/transaction steps.

Move the Owner gate before the first live mutation, not only before broadcast.

## Pre-activation MUST-FIX B — pin the deployed source and manifest

The receipt does not currently record which source commit/blob set is actually running.

Without a runtime/version pin, Owner may approve commit `26a23292...` while activation later runs a different code state. Claim-to-code review then no longer proves claim-to-deployed-code.

Add receipt fields for:

- deployed Git commit SHA;
- manifest/content digest or reviewed blobs for at least `capability.js`, `authorize.mjs`, `app-envelope.mjs`, `relay.mjs`, `migrate.js`;
- migration version/table/index readback;
- whether deployed commit is exactly the reviewed commit.

If any load-bearing file differs from the reviewed manifest, stop and rerun the relevant diff/claim-to-code review before activation.

## Pre-activation MUST-FIX C — add Relay/network/target equality, not only source-wallet equality

The gateway still resolves the executor as:

```js
process.env.CUSTODIAL_RELAY_ID || process.env.FAUCET_RELAY_ID || null
```

A missing `CUSTODIAL_RELAY_ID` therefore silently falls back to the faucet Relay. Relay binding may eventually deny a mismatch, but this is an avoidable money-path routing footgun and may execute on the wrong executor if the envelope/grant are built consistently with the fallback.

Before activation, require and record:

- `CUSTODIAL_RELAY_ID` explicitly set — no reliance on `FAUCET_RELAY_ID` fallback for the pilot;
- executor Relay ID == singleton grant `relay_scope` == signed envelope `relay_id`;
- executor Relay network == custodial-wallet network == grant network == envelope network == `testnet-12`.

Also correct the receipt's `payee_scope` row. For `custodial_transfer`, `intent.target` activates the Relay payee dimension, and missing `payee_scope` is fail-closed. It is not merely “if applicable.” The bounded pilot should require:

- one explicitly Owner-approved live-smoke target;
- that target present in grant `payee_scope`;
- signed envelope target equal to the approved target;
- exact authorized smoke amount, not an undefined “minimum value.”

Record pre- and post-smoke source balances plus fee/expected delta so the live receipt proves which wallet actually paid.

## Pre-activation MUST-FIX D — cover pre-authorization validation in the structured predicate

The phase/reason-code design closes the demonstrated GATE-DENY false-positive, but it does not yet cover the entire pre-execution path.

`validateCommandPayload(cmd)` runs before `authorizeCommand(cmd)`. On validation failure Relay returns:

```js
{ ok: false, error: 'invalid command: ...' }
```

without `phase`, `reason_code` or `denied=true`.

Gateway then treats it as a generic no-txId 503, and current G4 LAND logic can still accept a broad 503 with no `reason_code` as execution reach. Thus a future command-schema drift can recreate a positive false-pass through a different pre-gate branch.

Close this in one of two ways:

1. preferred: return structured `phase='validation'` + stable reason code for command validation failure, propagate it through gateway, and make LAND require explicit `phase='execution'`; or
2. minimally: make G4 directly assert the current command-schema validation succeeds and pin the exact reviewed deployed commit, while treating any unclassified no-txId response as failure rather than execution reach.

A response should be considered execution reach because it positively says `phase='execution'`, not merely because it lacks an authorization-denial marker.

## Non-blocking hardening/evidence notes

### Limiter cleanup index

Limiter cleanup uses:

```sql
DELETE FROM pilot_rate_limit_log WHERE requested_at < ?
```

but the only index is `(grant_id, requested_at)`. Add a time-leading `requested_at` index or change cleanup to a predicate matching the composite index.

For a single, heavily bounded pilot grant the table is naturally small, so this is not a funds-integrity blocker. It should be fixed before wider or longer-lived use.

### TAINT evidence scope

Current exact-secret E2E evidence checks:

- HTTP body;
- one Relay `lastLog` value.

It does not scan complete Relay stdout/stderr, Console/gateway output or the entire persisted evidence corpus. No direct key leak was found in the inspected code, so this may be recorded as a bounded evidence residual for the pilot. Do not call it a full-output proof until the whole captured corpus is exact-secret scanned.

## G4 v0.3 evidence disposition

Blob `595fa46bb80db8cfe74d0423e653991f533a089d` records 24 pass / 0 fail and is adequate for the current reviewed commit to show:

- source-scope enforcement;
- Relay-ID authorization binding;
- five-minute custodial TTL;
- amount cap and persistent rate limit;
- immediate revocation;
- replay residual;
- real authorization denial propagation;
- execution-branch reach under isolated dead-RPC conditions.

It is not live deployment or live-chain evidence.

## Owner-facing disposition

The team may present the package to Owner now, with this exact statement:

> The four prior code/control defects are closed and the bounded TN12 pilot design is technically coherent. Owner authorization is still required, and the runbook must first be corrected to place authorization before all live actions, pin the deployed code, prove Relay/network/source/target equality, and eliminate the remaining validation-phase false-positive path. Only after those conditions are verified may the authorized live smoke be executed and recorded.

This is not a Codex authorization to activate.

## Authority boundary

Codex does not authorize gateway enablement, Relay arm, live grant issuance, wallet creation/funding, UTXO modification, process restart, signature generation, broadcast, settlement, refund or funds movement. Those actions remain exclusively with Owner/delegate under the existing protocol.