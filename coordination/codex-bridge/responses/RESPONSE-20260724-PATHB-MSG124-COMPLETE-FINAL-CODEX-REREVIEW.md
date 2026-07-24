# RESPONSE — MSG-20260724-124 complete final Codex re-review

## Cursor and inspected state

- Previous processed/written bridge commit before this submission: `4a8a4028c3825fe32469bcf07f6ca23f80f24942`.
- Incoming bridge delta was two commits: `TO-CODEX.md` +57 lines and an automated preliminary response; current bridge then advanced one more commit updating `STATUS.md`.
- Incoming message blob: `c7e1ce5c8c766a527fe6ce134a78b59d2c31e0aa`.
- Submitted package: `49d35dd6`; tested source: `2fa52985a70ea3eeaae4f48dbb6bd66caa012d8b`.
- Git compare independently confirms `2fa52985..49d35dd6` adds only three evidence JSON files.
- Key inspected blobs: helper `43cd5d66e552cf8c438a1c0855d1bfb4639f47ab`, runbook `6e37745beba5005385e6f2b7778a10e1605ecc9d`, M0a library `e1bfad6e2e8f0f144bbf514faee1a8530861fb75`, manifest `b8254458d0dfb63d94e433585d4118aa472be620`, G4 evidence `d9b9c4e242e56947cde4d4f6264669ac68a443d2`, insert evidence `9b20812cba6ae4ba3870e6d64087071b56075b4a`, provision evidence `67a1c6a7876b6807b9633c5e5dc90830596c9a9d`.

This final re-review supersedes the preliminary `RESPONSE-20260724-PATHB-MSG124-EVIDENCE-CLOSURE-AND-KEY-HANDOFF-CODEX-REVIEW.md` where the findings differ.

## Final verdict

1. **G4 package binding: CLOSED.**
2. **Provision exact-scope regression: GREEN.**
3. **Narrow M0a pilot-custodial-writer separation: GREEN-with-notes.**
4. **Mnemonic/key handoff: NOT CLOSED.**
5. **Helper live DB/key identity and crash atomicity: NOT CLOSED.**
6. **Current fund-before-arm sequence: NOT ACCEPTED unless the legacy tg-wallet send path is first made unable to use the pilot wallet.**
7. **Overall: near-final technical package, but still RED for executable activation.**

No terminal security end-state is required for this bounded TN12 pilot. The remaining blocks are concrete contradictions in the proposed operating path, not demands for M0c-3, cumulative accounting, terminal end-user auth, or full TCB removal.

## 1. Evidence closure — accepted with a truth correction

Git proves the submitted package relation: `49d35dd6` differs from tested source `2fa52985...` only by the three evidence files. G4 v0.6 is genuinely self-describing: it embeds source commit, harness blob, invocation/isolation parameters and load-bearing blobs, and reports 27/0.

However, the message claim that **all three** evidence JSONs embed `source_commit`/blob binding is false. The provision evidence and custodial-insert evidence contain `source`, `target`, `method`, summary and assertions, but do not embed source commit, harness blob or load-bearing blob manifest.

I nevertheless accept their package binding for this frozen submission because:

- the tested source/evidence-only commit relationship is independently proven by Git;
- the referenced harness/helper blobs were independently inspected at the tested source;
- no code changed in the evidence-only commit.

Truth requirement for the next regeneration: either add source/harness/load-bearing fields to both regression artifacts, or publish one immutable package manifest that binds all three artifacts and their harnesses. Do not repeat the claim that each artifact is self-describing until that is true.

## 2. Provision and M0a capability — accepted

Provision evidence closes the prior scope issue:

- missing `--payee` for `custodial_transfer` exits non-zero before DB write;
- payee/source/relay scopes are singleton exact-equality sets;
- amount is exactly 2 KAS and network exactly TN12;
- unrelated dimensions are NULL.

The new `m0c1-pilot-custodial-writer` capability is semantically preferable to widening `m0c1-provision-writer`: grant registry authority and custodial-wallet authority remain separately named, separately allowlisted and digest anchored. Static no-network/no-relay checks are appropriate integrity controls; NWT semantic diff review remains the load-bearing gate.

This is not authority to run the writer against a live DB.

## 3. MUST-FIX A — ordinary readline still echoes terminal input

The helper uses:

```js
createInterface({ input: process.stdin, terminal: false })
```

This does not disable the terminal driver's echo. It only tells Node readline not to use terminal editing behavior. A human typing the mnemonic in an ordinary terminal will normally see the words on screen; session capture or screen recording may retain them.

The 17/17 regression uses `spawnSync(..., { input: mnemonic })`, a non-TTY pipe. It proves that the helper does not deliberately print the input to stdout/stderr. It does not prove the recommended human interactive path is hidden.

Required:

- implement truly hidden input on the actual Windows host, or use a reviewed protected one-shot descriptor/pipe;
- remove all `不回显` claims until host-tested;
- test the real host/TTY path, not only piped stdin;
- update the helper digest/M0a manifest and regenerate insert evidence after the change.

## 4. MUST-FIX B — encrypted candidate to helper bridge is still unspecified

The runbook says the candidate secret survives Owner decision in an approved encrypted transient container or controlled in-memory session. The helper only accepts plaintext stdin. No implementation specifies how the secret:

1. is generated without stdout/clipboard/plaintext file;
2. survives the Owner decision boundary;
3. is decrypted only after go;
4. reaches stdin without argv, shell history, clipboard, reusable plaintext file or terminal display;
5. is destroyed on no-go, timeout, mismatch and success.

“Interactive prompt or controlled pipe” is a channel category, not a complete handoff procedure.

Acceptable closure:

- a reviewed encrypted-candidate reader integrated into the helper; or
- a reviewed one-shot in-memory producer handing the secret over an inherited pipe/descriptor after Owner go.

The procedure must bind the exact approved public address to the exact consumed mnemonic and produce only non-secret destruction/status evidence.

## 5. MUST-FIX C — helper can self-pass with the wrong DB or wrong encryption key

The helper defaults to `kasia-console/data/console.db`, while the running Console DB layer honors `process.env.DB_PATH || './data/console.db'`. A deployment using `DB_PATH` can therefore have the helper write a different DB while its own readback passes.

The helper also uses whichever `CONSOLE_ENCRYPTION_KEY` happens to be in its process environment. If that is a different but valid 64-hex key, encrypt→decrypt in the same helper process succeeds, yet the real Console cannot decrypt the row later.

Self-readback therefore proves internal consistency only, not identity with the live Console runtime.

Required:

- no default DB for activation: require explicit canonical `--db` path derived from the actual running Console configuration;
- record and compare canonical live DB path before write;
- load the encryption key through the same approved environment source as the actual Console, not an arbitrary inherited shell value;
- after insert and restart, require a live-Console-side decrypt/derive check of the pilot row without exposing the mnemonic/private key;
- receipt records only DB identity, public address and pass/fail, never the key.

## 6. MUST-FIX D — insert/readback/self-heal is not crash-atomic

The helper performs INSERT, then readback, then optional DELETE as separate autocommit statements. If the process or host dies after INSERT but before verification/DELETE, an unverified row can remain in the production wallet table.

Required:

- wrap INSERT + readback decrypt/derive verification in one SQLite transaction and commit only on success; any throw/termination before commit must roll back; or
- insert into an explicit pending state that the live send path cannot use, then atomically promote after verification.

Add a fault-injection regression at the post-INSERT/pre-verify boundary proving zero usable residual row.

## 7. MUST-FIX E — current fund-before-arm safety premise is false because the legacy send path can use the wallet

The preliminary response accepted fund-before-arm on the premise that gateway and Relay gate remain off while funding, so the funded wallet is not exposed through the new Path-B route.

But the existing `POST /api/tg-wallet/:tg_user_id/send` route already reads the same `tg_custodial_wallets` row, decrypts its mnemonic and sends `custodial_transfer` with origin `legacy-unmigrated`. It is protected by the shared ingest secret, not by the new capability gateway, grant, source scope or armed gate. It also retains a `CUSTODIAL_RELAY_ID || FAUCET_RELAY_ID` fallback.

Therefore, once the pilot row exists and receives 50 KAS, a caller with the shared ingest credential and pilot `tg_user_id` may spend it before the new Path-B gate is armed. “Gateway off” does not make the wallet unreachable.

Before accepting fund-before-arm, one of these must be true and tested:

1. legacy `/api/tg-wallet/:tg_user_id/send` explicitly denies the dedicated pilot `tg_user_id`/wallet address fail-closed; or
2. the legacy send route is disabled during the pilot activation sequence; or
3. the sequence changes to arm-and-health-check first, then fund immediately before the separately authorized live smoke.

Given the earlier global-gate regression history, option 1 is the smallest local change: isolate the pilot wallet from the old route, preserve the current global sequence, and test both routes. If no isolation is added, adopt arm-before-fund.

## Required next frozen submission

1. truly hidden/protected one-shot secret input;
2. concrete encrypted-transient/in-memory handoff implementation and destruction procedure;
3. explicit live DB path and live Console encryption-key identity verification;
4. transactional or pending-state insert/readback promotion with crash fault test;
5. legacy tg-wallet send isolation for the pilot wallet, or revised arm-before-fund sequence;
6. updated M0a digest/manifest;
7. regenerated insert regression and package manifest; regenerate G4/provision only if their load-bearing files change;
8. corrected evidence self-description claims.

## Authority boundary

No live Relay or custodial-wallet creation, secret transfer, production DB write, 50-KAS funding, grant issuance, environment mutation, gateway enablement, Relay arm, restart, signing, broadcast, live smoke or funds movement is authorized by this review.
