# Codex review — unsynced Path B fixes after four-MUST-FIX verdict

## Git/blob cursor

- Last processed bridge commit: `ee57d3575bc72c8d50f4dd8369f1235c74eeba29`.
- `coord/codex-bridge` is Git-identical to that commit; no bridge file diff.
- Current bridge blobs:
  - `TO-CODEX.md`: `50ebb39016321d7a89948f75630b0ab86d622862`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `3cc3bc861f4df3043a7f910c9e9342447315157f`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`
- Active source advanced from `45b4382fa2331dab6f665a205bcc032a1e014b0e` to `26a232920b5ca067be5ce7d12009d647c4b198ac` with 11 commits directly addressing the prior verdict.

Document timestamps were not used as cursors.

## Verdict

- **MF1 source-wallet identity/balance/runbook separation: CLOSED.**
- **MF2 isolated G4 vs live smoke separation: CLOSED at runbook/design level.**
- **MF3 structured authorization result and false-positive LAND guard: CLOSED for authorization-vs-execution classification.**
- **MF4 rate-limit arbitrary-grant write amplification: SUBSTANTIALLY CLOSED, one cleanup-index hardening item remains.**
- **Full-output no-key-leak evidence: still incomplete.**
- **Path B readiness: GREEN-to-present-to-Owner with two pre-activation implementation/evidence notes; actual activation remains Owner-only and requires the runbook live smoke/receipt.**

This is not production authorization and does not authorize flags, funding, grant issuance, restart, signing, broadcast or funds movement.

## Closed items

### 1. Executor Relay and custodial source are now correctly separated

The runbook and receipt now distinguish:

- executor Relay identity from `relay_nodes`;
- actual spending wallet from `tg_custodial_wallets` selected by signed `fromAddress`;
- Relay balance from custodial-source balance;
- Relay `split-utxos` from any future custodial-wallet UTXO operation.

The revised checklist queries the custodial address through `get_address_utxos`, requires exactly 50 KAS on that address, and requires equality across:

1. `PILOT_WALLET_ADDRESSES`;
2. grant `source_scope`;
3. signed intent `fromAddress`;
4. funded `tg_custodial_wallets.kaspa_address`.

This closes the prior entity-confusion defect.

### 2. G4 is now honestly classified as isolated preflight

The runbook no longer claims the scratch-DB/dead-RPC/throwaway-key G4 harness validates live environment configuration. It now requires a separately Owner-authorized, minimum-value TN12 live smoke using the real Console, real grant and real custodial source, followed by txid and landed-state evidence in the activation receipt.

This is the correct separation:

- G4 proves authorization and containment logic;
- runbook/receipt prove live deployment configuration and one real execution.

### 3. Structured Relay decision closes the GATE-DENY false-positive class

Relay authorization responses now carry stable `phase` and `reason_code`; gateway maps Relay authorization denial to structured HTTP responses; G4 checks `reason_code` and includes a meta-test feeding a real `source_scope` denial into the LAND classifier.

The current v0.3 evidence shows:

- `VALUE_NOT_IN_SCOPE_SOURCE` → HTTP 403;
- `RELAY_ID_MISMATCH` → HTTP 403;
- `ENVELOPE_EXPIRED` → HTTP 403;
- `CUSTODIAL_PILOT_TTL_EXCEEDED` → HTTP 403;
- valid cases have no Relay-denial `reason_code` and enter the execution branch.

The old `reachedExecLayer()` helper remains broad, but the additional `!isRelayDeniedResponse()` assertion now prevents a Relay authorization denial from satisfying LAND overall. The permanent meta-check demonstrates this with a real denial response.

### 4. Arbitrary unknown grant IDs no longer create limiter rows

Gateway now:

1. validates structure;
2. performs indexed grant lookup;
3. rejects unknown grants;
4. only then writes rate-limit state;
5. caps `grant_id` length;
6. wraps count+insert in a SQLite transaction.

This closes the prior unbounded random-grant persistent-write path and the count/insert race.

## Remaining note 1 — add a time-leading cleanup index

The limiter performs a global cleanup:

```sql
DELETE FROM pilot_rate_limit_log
WHERE requested_at < ?
```

but migration v192 only creates:

```sql
(grant_id, requested_at)
```

SQLite cannot efficiently use that composite index for a predicate on `requested_at` alone because `grant_id` is the leading column.

Before activation, add one of:

```sql
CREATE INDEX IF NOT EXISTS idx_pilot_rate_limit_requested_at
ON pilot_rate_limit_log(requested_at);
```

or change cleanup to a grant-scoped predicate that matches the existing composite index. For the intended tiny pilot this is not a funds-integrity blocker, but it is the remaining part of the requested cleanup hardening and prevents per-request full-table scans as the log grows.

Also update the runbook/receipt code coordinates after this migration change.

## Remaining note 2 — TAINT still does not scan the complete output stream

The current E2E TAINT case compares the exact derived secret against:

- HTTP response body;
- one `relayManager.getStatus().lastLog` value.

That is better than shape matching, but it does not prove absence from:

- earlier/later Relay stdout lines;
- Relay stderr;
- Console/gateway stdout/stderr;
- persisted test evidence generated during the complete run.

Before claiming **full external-output no-key-leak evidence**, capture the complete child stdout/stderr and Console-side emitted output for the test run, then exact-match the fresh per-run private key against the entire captured corpus plus HTTP/evidence JSON. The current code paths avoid intentional key interpolation, so this is an evidence-completeness note rather than a newly found key leak.

For the bounded pilot, this note may be closed before activation or explicitly recorded as a constrained residual if Owner accepts it; do not describe the current single-`lastLog` test as a full-stream proof.

## Evidence assessment

Published source HEAD `26a232920b5ca067be5ce7d12009d647c4b198ac` adds tracked G4 v0.3 evidence with 24 pass / 0 fail and source-commit/remediation metadata. It is adequate evidence for:

- structured authorization denial propagation;
- source-scope enforcement;
- Relay ID binding;
- five-minute pilot TTL;
- gateway amount cap and rate limit;
- replay residual;
- immediate grant revocation;
- execution-branch reach under dead-RPC isolation.

It is not live-chain activation evidence. That remains intentionally deferred to the Owner-authorized live smoke and filled receipt.

## Readiness disposition

The package is now technically coherent enough to be presented to Owner for the bounded TN12 Path B decision, subject to:

1. add/fix the limiter cleanup index;
2. either complete full-stream exact-secret capture or state the narrower current TAINT evidence honestly;
3. complete every pre-activation receipt field from the running system;
4. Owner explicitly authorizes the two flags, 50-KAS custodial funding and minimum-value live smoke;
5. abort/rollback if four-address equality, source balance, Relay armed status, gateway flag, live smoke txid or landed evidence is missing.

Multi-user rollout remains outside this verdict and still waits for M0c-3 durable nonce/cumulative accounting and stronger end-user authorization.

## Authority boundary

Codex does not authorize activation, live grant issuance, wallet creation/funding, UTXO modification, process restart, signature generation, broadcast, settlement, refund or funds movement. Those actions remain with Owner/delegate under the existing protocol.
