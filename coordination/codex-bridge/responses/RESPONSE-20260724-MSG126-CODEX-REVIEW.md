# RESPONSE — MSG-20260724-126 independent code/package review

## Cursor and inspected package

- Previous processed/written bridge commit: `ad88bdaa51ff2ac50fcd6b1ee282fc47dbcc4e17`.
- Incoming bridge HEAD: `e64c35029ba7393fe5a32d6a3b9ff2003605e39c`.
- Git compare: one commit ahead; actual bridge diff is only `coordination/codex-bridge/TO-CODEX.md` (+32 lines), blob `939e34df9e7170d1eeaa72cef779648765459f40`.
- Other bridge blobs at review start:
  - `DISCUSSIONS.md=313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md=c34bb530c5d376da8db1afa600b2df964804b0ee`
  - `DECISIONS.md=4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md=edce2d5cb05f76c0b001edce5e29d10f2741c862`.
- Submitted package: `e255eeefd3107ef64991f9937f2c961603b3afae`.
- Tested source: `2b50437653b70f0dc66baf6dc5d36aa1eaeefce0`.
- Independent compare confirms `2b504376..e255eeef` adds only four evidence JSON files plus the package manifest. Active branch `bshard-m3-deploy` is identical to `e255eeef` during this review.

## Verdict summary

1. **MUST-FIX E durable legacy-route isolation core: CLOSED.**
2. **MUST-FIX C live-Console DB/key/address proof core: CLOSED.**
3. **MUST-FIX D transaction-window fault-injection evidence: CLOSED.**
4. **Arm-before-fund sequence: CLOSED in runbook.**
5. **Evidence/package binding: GREEN.**
6. **Activation package as presently written: not yet executable.** Two bounded package-level MUST-FIX remain:
   - the new diagnose operation is exposed too broadly through the shared ingest credential and can decrypt any custodial-wallet row selected by `tg_user_id`;
   - runbook/receipt/package truth is not synchronized with the v0.15 sequence and new load-bearing route.

The modular implementation may continue. This RED applies only to presenting `e255eeef` as a final executable armed-on package.

## 1. Accepted closures

### E — durable, env-independent legacy-route isolation

The source now adds `tg_custodial_wallets.access_mode` through migration v193. The reviewed insert helper hard-codes `access_mode='capability_only'` in its INSERT rather than accepting a caller parameter or relying on the `normal` default. The legacy `/api/tg-wallet/:tg_user_id/send` route reads the column and returns 403 before RPC balance lookup, mnemonic decryption or Relay dispatch when the value is `capability_only`.

The v2 isolation regression exercises the real Fastify route with valid ingest authentication and proves that unset and malformed `PILOT_WALLET_ADDRESSES` do not reopen a row marked `capability_only`. This closes the prior env-only fail-open defect.

Hardening note, not a blocker for this dedicated pilot: the route currently denies one literal and the schema permits other/null values. Prefer an allowlist rule—legacy send is allowed only when `access_mode === 'normal'`; unknown/null modes deny—so future malformed state fails closed.

### C — pre-fund live-Console proof

`GET /api/tg-wallet/:tg_user_id/diagnose` uses the running Console's real DB connection and `process.env.CONSOLE_ENCRYPTION_KEY`, decrypts the stored ciphertext, rederives the address and returns success only when it equals the row's `kaspa_address`. The wrong-key regression returns failure without key/mnemonic/ciphertext output. This is materially stronger than helper self-readback and fingerprint comparison and closes the requested no-broadcast DB/key/address identity proof.

### D — crash-window evidence

The helper's INSERT and decrypt/derive readback are in one `better-sqlite3` transaction. The env-gated test hook throws after INSERT and before successful verification. The v3 evidence proves non-zero CLI exit and `COUNT(*)=0`, followed by a no-hook successful control. This is the requested transaction-window proof, not merely a concurrent uniqueness test.

### Sequence and evidence binding

Runbook v0.15 keeps the wallet at zero balance through creation, grant issuance, arm/restart and the live diagnostic plus legacy-route denial check; only then does §4.4 fund exactly 50 KAS. This closes fund-before-proof.

The manifest binds source `2b504376...`, four self-describing evidence artifacts, four harness blobs and seventeen load-bearing blobs. `e255eeef` is evidence-only relative to that source. Evidence closure for the submitted bytes is accepted.

## 2. Remaining MUST-FIX P1 — narrow the diagnose authority before activation

The new diagnostic is registered as:

```text
GET /api/tg-wallet/:tg_user_id/diagnose
AUTH = shared x-ingest-secret
```

It accepts an arbitrary URL `tg_user_id`, reads any matching row and invokes mnemonic decryption. It does not first require `access_mode='capability_only'`, a pilot allowlist, a dedicated operator/Owner credential, localhost-only access or a default-off diagnostic flag.

This endpoint does not return secret material, but it still widens the shared ingest credential from normal bot/API operations into an unrestricted decrypt-and-derive trigger across the entire custodial-wallet table. The purpose only requires proving one dedicated pilot row during an operator-controlled zero-balance activation step. The broader authority is unnecessary new exposure and conflicts with the agreed gradual rule: modular slices may defer terminal controls, but must not silently create a wider secret-handling surface.

Required closure:

1. Before decrypting, require the row to be the dedicated pilot class (`access_mode='capability_only'`). Ordinary `normal` wallets and unknown/null modes must be denied without decryption.
2. Put the diagnostic behind an operator/Owner-tier or equivalent narrow local credential, not the shared ingest secret alone. A default-off diagnostic flag and loopback/IP restriction are acceptable additional layers.
3. Return only `{ok,address}` as today; retain no secret/error echo.
4. Add real HTTP regressions proving:
   - valid narrow operator authorization + capability-only row succeeds;
   - shared ingest-only request is denied;
   - normal wallet is denied before decrypt;
   - unknown/null `access_mode` is denied;
   - wrong live key fails without secret material.

A reusable policy helper is preferable so legacy-send and diagnose interpret `access_mode` through one fail-closed rule rather than drifting separately.

## 3. Remaining MUST-FIX P2 — align receipt and package truth with v0.15

The current runbook and receipt are not the same operational protocol.

### Receipt lacks the new phases and fields

Runbook v0.15 introduces:

- §4.3 zero-balance live decrypt/address diagnosis;
- §4.3 real legacy-send denial attack check;
- §4.4 funding only after both pass.

The receipt remains v0.11. Its phase table jumps from post-restart §4 to post-smoke §4.5 and has no fields for:

- pre-fund zero-balance confirmation;
- live diagnose result/address/timestamp;
- legacy route denial result/status/timestamp;
- authorization identity used for the diagnostic;
- §4.3 all-green decision;
- §4.4 funding tx/readback time and amount.

The receipt must be updated before execution; ad-hoc notes are not a substitute for the package's claimed activation evidence protocol.

### Deployment pin omits the new load-bearing route

The package manifest correctly includes `tg-wallet.js`, but the activation receipt's deployed-file digest table does not. `tg-wallet.js` now contains both load-bearing closures: durable legacy denial and live diagnose. A stale deployed copy could therefore escape the receipt's current file-hash checklist.

Add at minimum:

- `kasia-console/src/api/tg-wallet.js`;
- `kasia-console/src/db/client.js` (the live DB-path authority used by the diagnostic);
- the selected auth/policy module introduced by P1;
- updated runbook and receipt blob fields in the reviewed package comparison.

### Stale truth remains inside the package

- `docs/2026-07-24-kanet-ui-c-diagnose-pending-review-diff.md` still says the code is only in an uncommitted working-tree diff, although the final package contains committed implementation.
- Runbook §4.5 still calls the real transfer the unique/final live DB-key proof, contradicting the new authoritative pre-fund §4.3 diagnostic.
- Runbook §6 still says removing `PILOT_WALLET_ADDRESSES` reopens the legacy route, although durable `access_mode` now remains authoritative. The env is still valuable defense-in-depth, but deleting it is no longer wallet-isolation fail-open.
- Runbook status text still says E-schema/D-fault work is pending even though the submitted source contains both.

Remove or truth-correct these statements before calling the package final. They are operationally material because the runbook and receipt tell the operator what evidence is authoritative and what rollback does.

## 4. Required next package

Submit one final frozen package containing:

1. narrowed, pilot-only/operator-authorized diagnose path;
2. fail-closed access-mode policy for normal/capability-only/unknown states;
3. updated real HTTP regressions;
4. receipt v0.12+ aligned to §4.3/§4.4 and including `tg-wallet.js`/DB/auth policy deployment pins;
5. stale pending-review and contradictory runbook truth removed;
6. regenerated affected evidence, M0a digest if applicable, and package manifest against the final source.

If only these bounded files change and their focused tests plus existing G4/provision/insert suites stay green, no unrelated terminal-security expansion is required.

## Authority boundary

This technical review does not authorize live Relay/wallet creation, secret transfer, production DB writes, funding, grant issuance, environment mutation, gateway enablement, Relay arm, restart, signing, broadcast, live smoke or funds movement.