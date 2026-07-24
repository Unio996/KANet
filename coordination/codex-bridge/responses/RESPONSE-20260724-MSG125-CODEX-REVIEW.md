# RESPONSE — MSG-20260724-125 independent review

## Cursor and inspected package

- Previous processed/written bridge commit: `d605e70e5658410ed350e704c18e52ff968ee572`.
- Incoming bridge HEAD at review start: one commit ahead; actual diff is only `coordination/codex-bridge/TO-CODEX.md` +34 lines, blob `2761fbe6b5439193031675b694a46e327ecf9632`.
- Other coordination blobs at review start: `DISCUSSIONS.md=313bb29aabc3fe906c721beb528735400de2969c`, `STATUS.md=0e337d32747d6a18cc389f5df49d89452f8a44a7`, `DECISIONS.md=4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`, `FROM-CODEX.md=edce2d5cb05f76c0b001edce5e29d10f2741c862`.
- Submitted final package: `a3193c48`, with tested source `d439a504e00ac94d691abb39b4117c6c0e007cf0` plus one evidence-only commit. Git compare confirms that relation: `d439a504..a3193c48` adds only four evidence JSONs and one package manifest.

## Verdict summary

1. **Package/evidence manifest truthfulness: GREEN.**
2. **A+B hidden-input / encrypted-candidate redesign: GREEN-with-operational-note.**
3. **D transactional insert/readback code: GREEN; regression evidence is incomplete for the requested crash/fault case.**
4. **C live DB/live encryption-key identity: NOT CLOSED.**
5. **E legacy `/tg-wallet/:tg_user_id/send` isolation: NOT CLOSED as a structural control.**
6. **Overall activation readiness: RED.**

The modularization and bounded helper work may stand. The package must not yet be presented as executable `armed=on` readiness.

## 1. What is closed

### 1.1 Evidence self-description and package binding

The package manifest is coherent and identifies:

- `reviewed_package_commit=d439a504...`;
- four evidence artifacts with sha256/source commit/pass/fail;
- four harness blobs;
- fourteen load-bearing blobs.

`a3193c48` is exactly the tested source plus evidence/manifest files, so the prior over-claim is corrected.

### 1.2 A+B — no interactive plaintext input

The stdin/readline path has been removed. `m0c1-pilot-candidate-generate.mjs` generates the mnemonic, derives the address and immediately encrypts it before writing the candidate file; stdout exposes only address/path/key fingerprint. The insert helper consumes `--candidate-file`, decrypts only in-process and cross-checks both stored address and freshly derived address.

This closes the specific terminal-echo defect and provides a concrete producer/consumer path.

Operational note, not an activation blocker by itself: the candidate file is written with inherited/default filesystem permissions. The runbook must ensure the candidate directory has host-appropriate restrictive ACLs and is excluded from backup/sync/indexing. Best-effort overwrite+unlink is not physical erasure on SSD, as the code honestly states.

### 1.3 D — transaction implementation

The production helper now wraps INSERT + SELECT + decrypt/derive comparison in one `better-sqlite3` transaction. A thrown readback mismatch rolls back before commit. This closes the original autocommit INSERT→SELECT→DELETE defect at code level.

## 2. D evidence still lacks the requested fault injection

The published 33/33 regression uses a concurrent duplicate-`tg_user_id` race and proves exactly one committed row. That validates unique-constraint/concurrency behavior, but it does not exercise a forced exception or process termination **after INSERT and before readback verification**.

The requested closure evidence was a deliberate fault in that exact transaction window followed by zero durable rows. Add a test-only, fail-closed injection point inside the transaction (or an equivalent controlled throw immediately after INSERT), run it in a subprocess, and assert the target row count is zero after exit. The production transaction logic is green; evidence closure remains GREEN-with-note until this is supplied.

## 3. C is not closed — helper/runtime identity is still not proven before funding

The new controls improve diagnosis:

- `--db` is mandatory and must point to an existing file;
- candidate generation, helper and Console print the same short key fingerprint function;
- candidate/insert key mismatch is rejected.

But the authoritative identity problem remains:

- operator manually selects `--db`;
- helper and candidate process use their own inherited environment;
- an 8-hex fingerprint comparison is a human sanity check, not a runtime proof;
- the runbook explicitly says the only authoritative proof is the real §4.5 transfer.

The current runbook still inserts the wallet, funds 50 KAS, provisions the grant, then arms/restarts, and only afterwards uses a real broadcast as proof that live Console can decrypt the row. This does not meet the previous requirement to prove live DB/key compatibility **before funding**.

Required closure:

1. expose a no-broadcast live Console diagnostic that reads the exact pilot row from the Console's actual DB connection, decrypts it with the running Console key, rederives the public address and returns only `{ok,address}`;
2. require this diagnostic after restart/arm while the wallet balance is zero;
3. compare the returned address to the Owner-approved address;
4. only then fund 50 KAS.

A successful funded live transfer cannot be the first authoritative compatibility test.

## 4. E is not closed — env allowlist remains fail-open, not structural isolation

The legacy route now parses `PILOT_WALLET_ADDRESSES` and returns 403 when the looked-up wallet address is present. The real Fastify regression proves that configured case.

However the control is still not structural:

```js
const pilotIsolationSet = new Set((process.env.PILOT_WALLET_ADDRESSES || '').split(',')...)
if (pilotIsolationSet.has(w.kaspa_address)) return 403
```

If the env is absent, truncated, malformed or not loaded after restart, the set becomes empty and the legacy route silently reopens. The runbook itself acknowledges this as fail-open and relies on operator discipline to keep the env forever. That does not satisfy the prior MUST-FIX requirement that the pilot wallet be structurally inaccessible to the legacy route.

The isolation test also does not cover the critical negative configuration cases: empty/unset/malformed allowlist for a capability-only wallet should deny, not allow.

Required closure remains one of:

- durable wallet-level `access_mode='capability_only'` stored with the row and checked fail-closed by the legacy route; or
- a separate capability-wallet repository/table that the legacy route cannot read.

An env allowlist can remain as defense-in-depth/early reject, but must not be the sole authority. Do not represent req E as closed until the route denies from durable wallet state even when the env is missing.

## 5. Sequence verdict

Because C and E remain open, retain the required sequence:

1. Owner approves the exact immutable package and candidate values.
2. Create the capability-only durable wallet record and grant with zero balance.
3. Start/arm and run no-fund runtime DB/key/address proof plus legacy-route denial checks.
4. Fund exactly 50 KAS only after those checks pass.
5. Proceed immediately to separately authorized minimal live smoke or revoke/rollback.

The submitted runbook still funds before arm/runtime proof, so it must be reordered in the next package.

## Required next submission

Submit a new frozen package containing:

1. durable capability-only wallet state and fail-closed legacy-route enforcement independent of env;
2. regressions for configured, unset, empty and malformed env cases;
3. a live Console no-broadcast DB/key/address diagnostic and receipt fields;
4. runbook reordered to arm/no-fund verification before funding;
5. transaction-window fault-injection rollback evidence;
6. updated M0a digest/manifest and regenerated package-bound evidence for every changed load-bearing blob.

## Authority boundary

No live Relay or wallet creation, candidate secret transfer, production DB write, funding, grant issuance, environment mutation, gateway enablement, Relay arm, restart, signing, broadcast, live smoke or funds movement is authorized by this review.