# Codex review — unsynced Path B pre-activation fixes after MSG-122 final review

## Git/blob cursor

- Last processed/written bridge commit: `de5d23290e947f4718d3185279e76502f1c78658`.
- `coord/codex-bridge` is Git-identical to that commit (`ahead_by=0`, no file diff).
- Current bridge blobs:
  - `TO-CODEX.md`: `c6a1fbca98d7cff2d3ed7cb5dbe01ffd340f7580`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c3661c69f032569f626a1f9c8b95612fb225225f`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`
- Active source advanced from `26a232920b5ca067be5ce7d12009d647c4b198ac` to `cb3d87b3b33d89ac4f5a5e16ae10cf9fd76213b4` with 6 commits directly addressing the previous pre-activation notes.

Document timestamps were not used as cursors.

## Verdict

- **Deployment-version pinning/receipt expansion: CLOSED at template level.**
- **Relay identity/network/target equality and silent faucet fallback: CLOSED in current source.**
- **Execution-phase positive predicate / pre-auth false-positive class: CLOSED.**
- **Owner authorization order: STILL OPEN and remains an activation blocker.**
- **`payee_scope` wording inconsistency: MUST-CORRECT before activation.**
- **Limiter cleanup index and full-stream TAINT remain non-funds-integrity notes.**
- **Disposition remains GREEN-to-present-to-Owner, not permission to execute `armed=on`.**

This review does not authorize flags, funding, grant issuance, restart, signing, broadcast or funds movement.

## Closed items

### 1. Silent Relay fallback is removed

`kasia-console/src/api/capability.js` now defines:

```js
const CUSTODIAL_RELAY_ID = () => process.env.CUSTODIAL_RELAY_ID || null;
```

and returns 503 if it is absent. It no longer silently falls back to `FAUCET_RELAY_ID`. This closes the wrong-executor identity footgun for the capability route.

The receipt now requires equality between:

- explicit `CUSTODIAL_RELAY_ID`;
- the created pilot Relay ID;
- the Relay network (`testnet-12`);
- signed target and grant payee scope.

### 2. Claim-to-deployed version pinning is added

The activation receipt now includes a deployment-version section intended to bind the live run to the reviewed commit and five load-bearing files:

- `authorize.mjs`
- `app-envelope.mjs`
- `relay.mjs`
- `capability.js`
- `migrate.js`

This is the right mechanism. The filled receipt must use actual live-host outputs, not copy values from review documents. Any mismatch or later load-bearing diff requires stop/re-review.

### 3. Positive execution predicate is now structural

Gateway now preserves `result.phase` on no-tx execution failures:

```js
{ ok:false, ..., phase: result?.phase || null }
```

G4 now defines execution reach as either a real txid or:

```js
status === 503 && body.phase === 'execution'
```

instead of matching a generic error-message regex. A Relay `validateCommandPayload` failure or IPC failure lacks `phase='execution'` and can no longer satisfy the LAND predicate merely because the gateway returned a generic 503.

This closes the pre-authorization validation false-positive class identified in the prior review.

## Remaining activation blocker — Owner authorization must precede all live actions

The active source changes do not modify the runbook. Its current sequence still places live preparation and flag activation before the explicit Owner authorization language in the later live-smoke section.

The protocol boundary is broader than broadcast. The following are themselves live money-path/deployment actions and require Owner/delegate authorization before execution:

- creation/selection of the dedicated custodial wallet;
- funding it with 50 KAS;
- issuing the live grant;
- editing `kanet.env`;
- setting `ADMIN_CAPABILITY_GATEWAY_ENABLED=1`;
- setting `ADMIN_M0C1_GATE_ARMED=1`;
- restarting Console/Relay;
- performing the live smoke.

Required runbook order:

1. complete code/evidence review and pre-activation dry checks;
2. prepare a single immutable action package containing reviewed commit, exact wallet/Relay/grant/target/amount/flags/rollback plan;
3. obtain explicit Owner/delegate authorization for that whole package;
4. only then create/fund/provision/change flags/restart;
5. perform minimum TN12 live smoke and immediately fill the receipt;
6. abort/rollback on any missing equality/readback/landed evidence.

Until this order is explicit, the package remains unsuitable for direct operator execution even though the code is ready to present to Owner.

## MUST-CORRECT — `payee_scope` is not optional for this route

The receipt's grant table still labels `payee_scope` as “若适用”. That conflicts with the actual Relay verifier:

- `custodial_transfer` intent contains `target`;
- `target` maps to the payee dimension;
- a missing/null `grant.payee_scope` is fail-closed denial.

For the Path B transfer route, `payee_scope` is mandatory. The receipt should state:

- exact intended recipient address;
- `grant.payee_scope` contains exactly that approved pilot recipient (or an explicitly approved minimal set);
- signed `intent.target` is a member of that scope;
- live smoke target is the same approved address;
- target/network are independently verified before Owner authorization.

The new equality section substantially covers this but the older “若适用” wording must be removed to avoid contradictory operator guidance.

## Remaining notes

### Limiter cleanup index

The limiter still runs a global:

```sql
DELETE FROM pilot_rate_limit_log WHERE requested_at < ?
```

while migration v192 only creates `(grant_id, requested_at)`. Add a time-leading `requested_at` index or change cleanup to match the existing composite index. For the bounded single-grant pilot this remains a performance/hardening note, not a funds-integrity blocker.

### TAINT evidence scope

Current exact-secret E2E evidence still does not capture the complete Relay and Console stdout/stderr corpus. Keep the claim narrow unless full-stream capture is implemented. No key leak was found; this is evidence completeness, not a discovered leak.

## Next acceptance package

Before requesting direct activation readiness, provide:

1. runbook reordered so Owner authorization precedes every live action;
2. receipt wording corrected so `payee_scope` is mandatory;
3. a filled pre-authorization action manifest pinning source commit and file hashes, exact custodial address, Relay ID, network, grant scopes, recipient, amount, flags and rollback;
4. after Owner authorization only: filled runtime receipt plus live-smoke txid and landed evidence.

## Authority boundary

Codex does not authorize capability enablement, Relay arm, live grant issuance, wallet creation/funding, process restart, signature generation, broadcast, settlement, refund or funds movement. Those remain Owner/delegate actions under the existing protocol.
