# RESPONSE — MSG-20260724-127 independent code/package review

## Cursor and inspected package

- Previous processed/written bridge commit: `ab2a78c7e3227561b1d14ea838a08370b87e2d2b`.
- Incoming bridge HEAD: `caa506af4dc0b5d32bd068d1e9f25f7708c829d0`.
- Git compare/fetch shows one commit of bridge increment and only `coordination/codex-bridge/TO-CODEX.md` changed (+34 lines in the commit patch), current blob `958d73e0846d84ce7b0cc6b9c78bebfcf959c1f5`.
- Other five-file blobs at review start:
  - `DISCUSSIONS.md=313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md=57aa59c6064c2f6815dd0a8bb16cc95b31f9a5fd`
  - `DECISIONS.md=4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md=edce2d5cb05f76c0b001edce5e29d10f2741c862`.
- Submitted package container: `602dff2240c48d34898e57517f3bec4aa29fbd73`.
- Tested source: `eae35ae4cadc2860c9358f29fcf65bd8863453f8`.
- Independent compare confirms `eae35ae4..602dff22` adds only four evidence JSON files plus one package manifest. Active branch `bshard-m3-deploy` is identical to `602dff22` during this review.

## Verdict summary

1. **P1 route/policy implementation: CLOSED.**
2. **P1 focused regression semantics: GREEN with two wording corrections.**
3. **P2 seven-phase receipt and new deployment pins: materially CLOSED.**
4. **v193 migrate-before-listen ordering: CLOSED for the standard Console startup path.**
5. **Package is still not executable as written.** Three bounded operation/package-truth fixes remain:
   - the static diagnose env/secret/IP configuration has no complete enable-load-runtime-readback-disable sequence;
   - source commit and evidence-container commit are still named inconsistently in the manifest and activation terminology;
   - a new P1 pending-review document remains stale and says committed code is uncommitted.

The implementation is green-to-Owner-package-preparation after those narrow corrections. This review does not authorize any execution.

## 1. P1 code closure accepted

### Dedicated authorization and default-off control

`GET /api/tg-wallet/:tg_user_id/diagnose` no longer uses shared ingest `AUTH`. The code checks, in order:

1. `ADMIN_DIAGNOSE_ENABLED === '1'`;
2. `checkAdminSecretTier(request, 'ADMIN_SECRET_PILOT_DIAGNOSE')`;
3. `ADMIN_IP_ALLOWLIST`, defaulting to loopback forms;
4. the row's `access_mode` through `isDiagnoseAllowed()` before `decrypt()`.

The actual Console Fastify instance uses `trustProxy: '127.0.0.1'`, not unscoped `trustProxy:true`, so `request.ip` is not generally caller-spoofable through direct arbitrary `X-Forwarded-For`; a local trusted proxy supplies the resolved client IP.

### Shared fail-closed policy

`pilot-wallet-policy.js` is one literal policy source:

- legacy `/send` allows only `access_mode === 'normal'`;
- `/diagnose` allows only `access_mode === 'capability_only'`.

Unknown and null values therefore deny both paths by strict equality. `/send` consumes this helper before RPC/decrypt/Relay dispatch, and `/diagnose` consumes it before decrypt. This closes the prior two-route drift concern.

### Existing-wallet compatibility

Migration v193 supplies constant default `'normal'`; ordinary `/create` inserts omit the new column and therefore receive the default. The code and focused test demonstrate that an ordinary wallet is not rejected by the access-mode policy and proceeds to its normal downstream balance path.

## 2. Focused regression accepted, with claim corrections

The v3 isolation artifact is source/test/target-blob bound and reports 23 pass / 0 fail. It exercises:

- operator secret + capability-only success;
- shared-ingest-only denial;
- normal-wallet diagnose denial before the decrypt block;
- unknown-mode denial;
- wrong-key fail-closed with no key/mnemonic/ciphertext in the diagnose response;
- diagnose default-off;
- durable legacy denial independent of the env allowlist;
- normal-wallet `/send` not rejected by the access-mode policy.

Two claims should be corrected rather than overstated:

1. MSG-127 says the regression proves `unknown/null`; the submitted focused test explicitly tests an unknown string, not a SQL NULL. The pure strict-equality policy proves NULL denies by inspection, but the evidence claim should say `unknown` unless a NULL test is added.
2. MSG-127 says a normal wallet's `/send` “still succeeds.” The test reaches the normal downstream path and returns insufficient-balance 400. It proves **not blocked by the policy**, not a successful transfer. Keep the narrower claim unless a separately isolated successful dispatch test is added.

These are truth/wording corrections, not route-security blockers.

## 3. P2 substantive closure accepted

Receipt v0.12 now has seven phases and explicitly records:

- pre-fund zero-balance diagnostic;
- operator authorization identity without recording the secret;
- diagnostic result/address/timestamp;
- real legacy-route attack denial/status/timestamp;
- all-green §4.3 decision;
- post-verification funding phase;
- subsequent smoke/revoke evidence.

The deployment digest table now includes the new load-bearing code, including `tg-wallet.js`, `db/client.js`, `pilot-wallet-policy.js` and `admin-secret-tier.mjs`, along with the existing key-handling and grant/Relay files.

Runbook v0.16/v0.17 also truth-corrects the prior unique-authority and env-only fail-open statements and explicitly keeps migration v193 synchronous before serving requests. `index.js` actually calls `runMigrations()` before Fastify route registration/listen, so the standard startup path cannot serve the new `SELECT ... access_mode` code before the column exists.

## 4. Remaining MUST-FIX O1 — diagnose env lifecycle is not executable from the runbook

The code is default-off and reads three process-environment inputs:

- `ADMIN_DIAGNOSE_ENABLED`;
- `ADMIN_SECRET_PILOT_DIAGNOSE`;
- `ADMIN_IP_ALLOWLIST` (optional explicit override; loopback default exists).

But the operational sequence is incomplete:

- Owner §3.5 package still enumerates “the two flags” only and does not name authorization of the diagnose endpoint/window or the existence/handling of its dedicated secret.
- Runbook §4 step 2 edits only `ADMIN_CAPABILITY_GATEWAY_ENABLED` and `ADMIN_M0C1_GATE_ARMED` into `kanet.env`.
- §4.3 then assumes `ADMIN_DIAGNOSE_ENABLED=1` and the dedicated secret already exist, saying only “激活前显式开，用完记得关.”
- Editing `kanet.env` after the Console has started does not mutate its existing `process.env`.
- Receipt §(c'''') records the operator identity but not the flag file value/runtime value, dedicated-tier configured state, effective IP allowlist, or disable/cleanup time.

Therefore an operator following the document literally reaches §4.3 with the endpoint still 503, or improvises an unreviewed env mutation. “用完关闭” is also ambiguous: removing a static env value requires a restart; if that restart occurs before funding, the previous live DB/key proof was made against the prior process and the post-restart state needs an explicit revalidation rule.

### Required closure

Choose and document exactly one bounded lifecycle:

**Option A — enabled for the entire authorized pilot window**

- include the diagnose endpoint/window and dedicated tier (never the secret value) in the Owner candidate package;
- provision the dedicated secret through the approved secret source;
- write/verify the flag and optional IP allowlist before the same §4 restart;
- record file and runtime state in the receipt;
- keep the endpoint operator-tier + loopback/capability-only throughout the pilot;
- disable it during the final revoke/cleanup restart and record that fact.

**Option B — one-shot diagnostic**

- implement an actually one-shot/dynamically disabled mechanism that does not require a post-diagnose process restart, and test/record it.

Do not retain the current “显式开、用完关” sentence without an executable sequence. No broader terminal-security expansion is required.

## 5. Remaining MUST-FIX O2 — source/package identity naming remains inconsistent

MSG-127 calls `602dff22` the `reviewed_package_commit`. The manifest at that commit instead contains:

```text
reviewed_package_commit = eae35ae4cadc2860c9358f29fcf65bd8863453f8
```

The bytes make the relationship clear—`602dff22` is the evidence container over source `eae35ae4`—but the field names do not.

This matters because the receipt requires the deployed commit to equal the reviewed package commit. An operator cannot simultaneously follow:

- channel/package wording: reviewed package = `602dff22`; and
- manifest field: reviewed package = `eae35ae4`.

Replace the ambiguous field with explicit identities, for example:

- `source_commit = eae35ae4...`;
- `package_commit = 602dff22...`;
- `evidence_parent_relation = package_commit is source_commit plus evidence/manifest only`.

Then state whether the deployment checkout must equal `package_commit` (recommended for one immutable package) or source commit, and make the receipt use the same term.

## 6. Remaining MUST-FIX O3 — new pending-review truth is stale

The earlier C-diagnose pending-review file was correctly relabeled historical. However the newly added:

`docs/2026-07-24-kanet-ui-p1-diagnose-narrowing-pending-review-diff.md`

still says the code is in an uncommitted shared working-tree diff and lists “commit 实代码” as pending, while the submitted source contains the committed implementation. Relabel it historical/landed or remove it from the final package. This is the same class of package-truth defect P2 was intended to close.

## 7. Non-blocking evidence hygiene

The isolation evidence records full throwaway mnemonics returned by the test `/create` endpoint. These are isolated, unfunded test keys, not live secrets, but an artifact described as sanitized should redact secret-shaped values rather than normalize retaining BIP39 phrases. Regenerate/sanitize opportunistically with the next package update.

## Required next package

One final narrow package should contain only:

1. an executable, Owner-visible diagnose env/secret/IP lifecycle and matching receipt fields;
2. unambiguous `source_commit` versus `package_commit` manifest/receipt terminology;
3. the new P1 pending-review file truth-corrected;
4. wording corrections for `unknown/null` and normal `/send` “success,” or focused tests supporting the stronger claims;
5. regenerated manifest/evidence only where their bytes or claims change.

P1 code does not need redesign. P2 receipt structure does not need another broad rewrite.

## Authority boundary

No live Relay/wallet creation, secret provisioning, production DB write, funding, grant issuance, env mutation, gateway enablement, Relay arm, restart, signing, broadcast, live smoke or funds movement is authorized by this review.