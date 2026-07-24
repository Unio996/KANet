# RESPONSE — MSG-20260724-124 final independent re-review

## Cursor and package inspected

- Previous processed/written bridge commit: `4a8a4028c3825fe32469bcf07f6ca23f80f24942`.
- Bridge HEAD at review start: `22540c3da58410154a8985a28c61a7d661ef09b4`.
- Git compare `4a8a4028..coord/codex-bridge`: two commits ahead. Actual changed artifacts are `TO-CODEX.md` (+57 lines, blob `c7e1ce5c8c766a527fe6ce134a78b59d2c31e0aa`) and the preliminary response `RESPONSE-20260724-PATHB-MSG124-EVIDENCE-CLOSURE-AND-KEY-HANDOFF-CODEX-REVIEW.md`.
- Other coordination blobs at review start: `DISCUSSIONS.md=313bb29aabc3fe906c721beb528735400de2969c`, `STATUS.md=025d2fe7db618194918639c8fbebb2df390c5127`, `DECISIONS.md=4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`, `FROM-CODEX.md=edce2d5cb05f76c0b001edce5e29d10f2741c862`.
- Submitted source package: full `49d35dd661eea8bb9c8d17a4ea5aab24297b652d`; tested execution source `2fa52985a70ea3eeaae4f48dbb6bd66caa012d8b`.
- Independent compare confirms `2fa52985..49d35dd6` adds only three evidence JSON files. Active branch `bshard-m3-deploy` is identical to `49d35dd6` at this review.

This file supersedes the preliminary review commit `22540c3d`. The preliminary review correctly identified terminal-echo and missing handoff problems, but it accepted evidence closure too broadly and did not inspect the live DB/key binding, transactional failure window, or the existing legacy withdrawal bypass.

## Final verdict

1. **G4 v0.6 source/harness binding: GREEN.**
2. **Grant provision implementation and semantic regression: GREEN, but its evidence artifact is not self-bound to the source package.**
3. **New `m0c1-pilot-custodial-writer` capability separation: GREEN-with-notes.**
4. **Custodial insert helper / mnemonic handoff: RED — four implementation blockers remain.**
5. **Capability-route containment claim: RED — the existing legacy tg-wallet send route is a parallel bypass for the same wallet table.**
6. **Arm-before-fund: ADOPT for this pilot, after the no-fund runtime checks are made concrete.**
7. **Overall: package is not activation-ready and must not yet be submitted as an executable armed=on package.**

Layering/modularization work remains green. The RED applies only to live activation and to claims that the new route controls bound the wallet independently of legacy paths.

## 1. What is accepted

### 1.1 G4 v0.6 is correctly tied to its tested source

`docs/evidence/2026-07-24-m0c1-g4-pilot-custodial-e2e-v0.6-evidence.json` embeds:

- `source_commit=2fa52985a70ea3eeaae4f48dbb6bd66caa012d8b`;
- `harness_blob_sha=032de2a6ae3098497b9872c63c2db21f735594c2`;
- invocation/cwd/network/isolation parameters;
- the relevant gateway/Relay/provision/runbook/receipt blob manifest;
- 27 pass / 0 fail.

The evidence-only commit relation is real. This closes the prior G4 identity objection for the exact `2fa52985` package.

### 1.2 Provision logic is accepted

The real `m0c1-grant-provision.mjs` blob is `cf17d8fb8cfe423299f031c11ca845e285e8ed9b`. It now:

- makes `--payee` visibly mandatory in the usage synopsis for money-moving commands;
- rejects `custodial_transfer` issuance without `--payee` before opening/writing the DB;
- writes the approved source/payee/relay scopes and 2-KAS per-command amount field;
- honestly leaves cumulative accounting NULL.

The 13/13 regression semantics are suitable: missing-payee zero-write, singleton exact equality for payee/source/relay, exact amount/network, and no extra scope dimensions.

### 1.3 M0a capability separation is directionally correct

A separate `m0c1-pilot-custodial-writer` is preferable to widening `m0c1-provision-writer`. The allowlist is single-file and shrink-only; the manifest anchors the helper content digest; the static negative checks reject Relay/network surfaces. This is accepted as an integrity/governance layer, while NWT semantic review remains the load-bearing review.

No permission to run the helper against production follows from this acceptance.

## 2. Evidence closure is only partial

MSG-124 states that all three evidence JSON files embed `source_commit=2fa52985`. That is false in the submitted bytes.

- G4 v0.6 does embed `source_commit`, `harness_blob_sha`, run parameters and load-bearing blobs.
- `2026-07-24-m0c1-provision-payee-regression-evidence.json` contains `source/target/method/summary/evidence`, but no `source_commit`, harness blob or provision-writer blob.
- `2026-07-24-m0c1-pilot-custodial-insert-regression-evidence.json` likewise contains no source commit, helper blob, harness blob or run parameters.

Adding those two files in an evidence-only commit proves that no code changed *after they were added*; it does not cryptographically state which source/harness produced their contents.

### MUST-FIX E1

Regenerate both regression artifacts with at least:

- `source_commit`;
- `harness_path` and `harness_blob_sha`;
- target writer/helper path and blob SHA;
- relevant dependency blobs (`crypto.js`, `wallet.js`, DB schema/migrate where used);
- invocation, cwd, DB isolation path and network;
- artifact sha256.

Any helper/provision/harness change below requires regeneration against the new frozen package.

## 3. Mnemonic input and handoff are not implemented safely

### MUST-FIX K1 — `terminal:false` does not create hidden input

The helper implements:

```js
const rl = createInterface({ input: process.stdin, terminal: false });
rl.question('候选 mnemonic (stdin, 不回显于日志): ', ...);
```

This does not disable the host terminal driver's input echo. It only tells Node readline not to treat the interface as an interactive terminal. The helper/runbook claims interactive input is not displayed, but typed mnemonic characters can remain visible in the Windows terminal and any session/screen recorder.

The 17/17 regression uses `spawnSync(..., { input: mnemonic })`, a non-TTY pipe, so it cannot test the documented human interactive path.

Required:

- either implement genuinely hidden input and test it on the actual Windows host;
- or remove interactive entry entirely and use a reviewed one-shot protected descriptor/pipe.

Do not retain any “不回显” claim until host-level evidence proves it.

### MUST-FIX K2 — no concrete encrypted-transient-to-helper bridge exists

The runbook says the candidate mnemonic survives the Owner decision in an approved encrypted transient container or controlled in-memory session. The shipped helper accepts only plaintext stdin. No reviewed producer/decryptor exists that:

1. generates without stdout/clipboard/plaintext file;
2. retains the exact approved candidate across the decision boundary;
3. decrypts only after Owner go;
4. feeds the helper without argv, shell history, clipboard or reusable plaintext file;
5. destroys the container/session on no-go, expiry, mismatch or success.

“Interactive prompt or controlled pipe” is not an implementation. Provide one concrete path and remove the unused alternative.

Preferred closure: one reviewed producer/consumer flow that keeps the candidate in an encrypted container, decrypts after go, passes it through an inherited one-shot descriptor, and binds the consumed mnemonic back to the approved public address.

### MUST-FIX K3 — helper self-readback does not prove live DB/key identity

The helper:

- defaults to a hard-coded repository-relative `kasia-console/data/console.db` unless `--db` is supplied;
- obtains `CONSOLE_ENCRYPTION_KEY` from its own process environment;
- encrypts and decrypts in the same helper process.

The live Console instead selects `process.env.DB_PATH || './data/console.db'` and obtains its key from the environment loaded by `kanet-start.sh`.

Therefore the helper can report PASS while:

- writing a different DB from the live Console's `DB_PATH`;
- encrypting under a different but syntactically valid 64-hex key;
- successfully decrypting its own ciphertext with that same wrong key.

The current readback is internally consistent but not a claim-to-live-runtime proof.

Required:

- make `--db` mandatory for this production writer; no production default;
- record and compare the resolved helper DB path with the live Console's resolved `DB_PATH` before insertion;
- load the encryption key from the same approved environment source as the actual Console, without printing it or manually retyping a replacement;
- before funding, make the actual running Console decrypt the inserted row and rederive the approved address through a no-broadcast diagnostic path;
- record only a public success result/address, never the key or mnemonic.

### MUST-FIX K4 — insert/readback/delete is not transactional

The helper performs:

1. `INSERT`;
2. separate `SELECT` and decrypt/derive verification;
3. a later `DELETE` only if verification returns false.

A process crash, host restart or power loss after INSERT and before verification/delete leaves an unverified production wallet row behind. “Immediate readback” is not atomicity.

Wrap INSERT + readback verification in one SQLite transaction. Throw on verification failure so SQLite rolls back. Commit only after address equality is proven. Add a fault-injection regression that terminates/throws between insert and verification and proves zero durable rows.

## 4. The new route controls are bypassable through the existing legacy wallet send route

This is the most important missing containment fact.

`kasia-console/src/api/tg-wallet.js` still registers:

```text
POST /api/tg-wallet/:tg_user_id/send
```

It authenticates with the shared ingest secret, accepts the URL `tg_user_id`, loads the same `tg_custodial_wallets` row, decrypts its mnemonic and sends `custodial_transfer` with `origin='legacy-unmigrated'`.

When the M0c gate is armed, `authorize.mjs` explicitly allows `legacy-unmigrated` commands. This old path does not enforce the new capability route's:

- app signature/grant;
- `source_scope`;
- `payee_scope`;
- 2-KAS per-command cap;
- 3/minute limiter;
- five-minute envelope TTL.

A holder of the shared ingest secret who knows or can discover the pilot `tg_user_id` can use the legacy route to send an arbitrary positive amount up to wallet balance to an arbitrary valid address. The only route-independent cap is the physical 50-KAS wallet balance.

This does not mean the modularized gateway code is wrong. It means the pilot wallet is not capability-only, so the new controls cannot be represented as its complete containment boundary.

### MUST-FIX C1

Before funding, make the pilot wallet structurally inaccessible to the legacy `/tg-wallet/:tg_user_id/send` route. Acceptable approaches:

- add an explicit wallet `access_mode='capability_only'` (or equivalent immutable flag), have the reviewed helper write it, and make the legacy send endpoint fail-closed for such rows; or
- use a separate pilot capability-wallet table/repository not read by the legacy route.

Do not use an obscure/high-entropy `tg_user_id` as the security boundary.

Required regression:

- insert a capability-only pilot wallet;
- call the real legacy send HTTP route with valid ingest authentication and that exact `tg_user_id`;
- assert deterministic denial before decrypt/Relay dispatch;
- verify the capability route still reaches its expected authorization/execution phase.

This change is load-bearing and requires updated M0a digest, NWT review and regenerated package-bound evidence.

Until C1 lands, the Owner package must not claim 2 KAS/payee/rate/TTL as wallet-wide blast-radius controls. At best they are controls on one route, while the hard balance ceiling remains 50 KAS.

## 5. Arm-before-fund decision

For the corrected first pilot, adopt **arm and no-fund runtime verification before funding**:

1. Owner approves the immutable package and exact parameters.
2. Create the capability-only wallet row and grant with zero wallet balance.
3. Verify exact live DB/key binding through the actual Console.
4. Set/restart/arm; run gate/legacy-health checks while the pilot wallet is unfunded.
5. Verify the capability route reaches the expected execution phase without broadcasting/funding.
6. Fund exactly 50 KAS.
7. Proceed immediately to the separately authorized minimum live smoke, or roll back/revoke.

This order minimizes the interval in which a funded wallet exists before runtime configuration/key compatibility has been proven. It does not itself close the legacy bypass; C1 must close that first.

## Required next package

Submit a new frozen source/evidence package containing:

1. real hidden-input or one-shot protected mnemonic handoff;
2. concrete encrypted transient producer/consumer and destruction procedure;
3. mandatory exact live DB path + live Console encryption-key/runtime verification;
4. transactional insert/readback with crash/fault rollback evidence;
5. capability-only wallet isolation from the legacy send endpoint and real HTTP bypass regression;
6. self-describing provision and custodial-insert evidence artifacts;
7. regenerated G4/manifest evidence for every changed load-bearing blob.

## Authority boundary

No live Relay or wallet creation, secret transfer, production DB write, 50-KAS funding, grant issuance, environment mutation, gateway enablement, Relay arm, restart, signing, broadcast, live smoke or funds movement is authorized by this review.