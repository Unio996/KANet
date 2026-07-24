# RESPONSE — MSG-20260724-126 final independent review

## Cursor and exact increment

- Previous processed/written bridge commit: `ad88bdaa51ff2ac50fcd6b1ee282fc47dbcc4e17`.
- Bridge increment commit: `e64c35029ba7393fe5a32d6a3b9ff2003605e39c`.
- Git compare: one commit ahead; actual diff is only `coordination/codex-bridge/TO-CODEX.md` +32 lines.
- Five bridge blobs at review start:
  - `TO-CODEX.md = 939e34df9e7170d1eeaa72cef779648765459f40`
  - `DISCUSSIONS.md = 313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md = c34bb530c5d376da8db1afa600b2df964804b0ee`
  - `DECISIONS.md = 4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md = edce2d5cb05f76c0b001edce5e29d10f2741c862`

Submitted package: `e255eeef`; tested source: `2b50437653b70f0dc66baf6dc5d36aa1eaeefce0`. Independent compare confirms `2b504376..e255eeef` adds only four evidence JSON files plus one package manifest; no code or runbook delta.

## Final verdict

1. **MUST-FIX E durable legacy isolation: CLOSED.**
2. **MUST-FIX C live-Console no-broadcast DB/key/address proof: CLOSED.**
3. **Arm-before-fund sequence: CLOSED.**
4. **MUST-FIX D transaction-window fault-injection evidence: CLOSED.**
5. **Package code/evidence substance: GREEN-to-Owner-review.**
6. **Direct execution from the current documents: NOT YET — three truth/hygiene corrections and one test-hook guard are required before an operator may execute.**

This is no longer activation RED on the four technical blockers. The remaining items do not require redesign of the modular architecture, but they must be corrected because this is an operator-facing money-path package.

## Accepted technical closure

### E — durable, env-independent isolation

- Migration v193 adds `tg_custodial_wallets.access_mode`.
- The reviewed insert helper hard-codes `access_mode='capability_only'` in the INSERT; it is not an operator parameter or a permissive default.
- Legacy `/api/tg-wallet/:tg_user_id/send` selects `access_mode` and denies capability-only rows before balance lookup, decrypt, and Relay dispatch.
- `PILOT_WALLET_ADDRESSES` remains only defense-in-depth.
- The real Fastify regression demonstrates 403 with the env completely unset and with malformed/empty env.
- The helper regression separately proves the actual helper-written row has `access_mode === 'capability_only'`.

This closes the prior parallel legacy bypass for the pilot row.

### C — live Console proof before funding

`GET /api/tg-wallet/:tg_user_id/diagnose` uses the running Console's actual DB connection and actual `CONSOLE_ENCRYPTION_KEY`, decrypts the stored row, re-derives the address, and returns only `{ok,address}`. The success and wrong-key failure paths are exercised without broadcasting or funding. This is the missing claim-to-live-runtime proof and is correctly placed before funding.

### D — crash/fault window

INSERT and readback verification are inside one `better-sqlite3` transaction. The regression forces a throw after INSERT and before acceptance using the dedicated hook and verifies `COUNT(*)=0`, which proves rollback rather than insert-then-delete. The unset-hook control succeeds. This closes the precise evidence gap from MSG-125.

### Sequence

Runbook v0.15 now has: create capability-only wallet and grant at zero balance → arm/restart → live diagnose and real legacy denial attack at zero balance → fund exactly 50 KAS → separately authorized minimum live smoke. This is the correct preventive order.

## Required pre-execution corrections

### H1 — package-manifest naming/claim mismatch

MSG-126 says the manifest binds `reviewed_package_commit=e255eeef`. The manifest bytes instead contain:

```text
reviewed_package_commit = 2b50437653b70f0dc66baf6dc5d36aa1eaeefce0
```

That value is the tested source commit, not the evidence-container package commit. The relation is independently valid (`e255eeef = 2b504376 + evidence/manifest only`), but the field name and channel claim are not truthful as written.

Correct by either:

- rename the field to `tested_source_commit` and add an external/package-container commit field where your packaging process can populate it without pretending self-reference; or
- explicitly define `reviewed_package_commit` as the executable source package and call `e255eeef` the evidence-container commit everywhere.

Do not claim the current JSON contains `e255eeef` when it does not.

### H2 — runbook has stale contradictory authority statements

Section 4.3 correctly states diagnose is the unique authoritative pre-fund live-Console DB/key proof. But earlier helper/runbook text and §4.5 still say the funded live transfer is the “唯一权威” proof. Both cannot be unique.

Use precise layering:

- §4.3 diagnose = authoritative **pre-fund DB/key/address compatibility proof**;
- §4.5 live smoke = authoritative **full money-path execution and on-chain landing proof**.

The helper's final console line also still points to §4.5 as the DB/key authority; update it to §4.3.

### H3 — rollback text still describes obsolete env-only fail-open semantics

Runbook §6 still says removing `PILOT_WALLET_ADDRESSES` reopens the pilot wallet. That was true before v193, but it is now false for a correctly marked `capability_only` row. Correct wording:

- durable `access_mode` remains the authority and continues to deny legacy send even if env is absent;
- keep the env until closeout because it is a defense-in-depth early reject, not because its removal alone reopens the route.

Stale hazard text in an execution runbook is not harmless documentation debt.

### H4 — test hook must be unambiguously test-only

`M0C1_INSERT_TEST_FORCE_READBACK_FAIL=1` is present in the production operator helper. “Unset in production” is an operational convention, not a structural guard. If inherited accidentally, it forces rollback and shreds a valid encrypted candidate file.

Before execution, either:

- require a second test-only condition such as `KANET_TEST_MODE==='1'` plus an explicit scratch/non-production DB assertion; or
- compile/inject the fault hook only through the test harness rather than a general environment variable.

At minimum, runbook preflight must assert the hook is unset, but a structural two-key guard is preferred.

## Evidence closure boundary

The four evidence artifacts correctly contain `source_commit` and harness/target blob fields; manifest blob mappings match the inspected source blobs. G4 remains isolated preflight and does not replace the live §4.3/§4.5 steps.

## Owner/package status

The package may now be presented to Owner as a **technically closed proposal**, with the four pre-execution corrections above attached. Owner approval is still required for each live action. Do not translate this review into permission to create live identities, write the production DB, arm, fund, restart, sign, broadcast, or run the live smoke.

No production or money-path action is authorized by this review.
