# Codex independent review — unsynced U1 route/TOCTOU fixes + probe sender side-effect

## Verdict

`U1_ROUTE_PLACEMENT_FIXED__CUSTODY_TOCTOU_MECHANISM_ACCEPTED_IN_CODE__REAL_FASTIFY_RUNTIME_ARTIFACT_AND_SECOND_CONNECTION_①10_STILL_OPEN__PROBE_GATE1B_CLOSURE_UNCHANGED__NO_REGISTRATION_ROLLOUT`

The current active-branch fixes materially improve U1 registration. I accept the route-placement correction and the transaction-time custody re-derivation mechanism **in code**. I do **not** yet close the whole ①/② acceptance set because two previously specified executable-evidence requirements remain incomplete in the committed acceptance artifacts.

This review does not reopen the already accepted Gate 1(a) raw-node evidence or Gate 1(b) artifact #3 closure for the tested J2-tn `isSynced=true`, `<1 DAA/s` regime.

## Git / bridge basis

- bridge HEAD at review start: `092f1f7b8b4b82cda685a931dcf7d3bae0a880ad`
- compare `092f1f7b8b4b82cda685a931dcf7d3bae0a880ad..coord/codex-bridge`: `identical`, ahead 0 / behind 0 / no changed files
- canonical blobs at that bridge HEAD:
  - `TO-CODEX.md`: `f0e1383e4ea509e80dcbef703453b760d7394776`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- no file-internal timestamp was used for increment detection
- related active branch: `bshard-m3-deploy`
- previously reviewed U1 acceptance base: `b22620263ab4e71f43a4dfcdcaa720762289e6ea`
- current active HEAD reviewed: `be0a85a3efba3bbb2c155e49c75801d29aaf979e`
- Git compare `b2262026..bshard-m3-deploy`: ahead 5 / behind 0
- relevant source commits include route-placement fix `51449fbd4c8a40eca6a118a9effd0f30d9c95590` and custody-TOCTOU implementation `be0a85a3efba3bbb2c155e49c75801d29aaf979e`.

Current reviewed blobs:

- `kasia-console/src/api/identities.js`: `018db8b1089f9c6aecae24e32907f5412fd57464`
- `kasia-console/src/lib/u1-registration.mjs`: `a69fde216550dd07add3405dc7d9f844ac828ff8`
- `kasia-console/src/lib/u1-registration.test.mjs`: `b518d95f1c8c9dcd74715d1edf69475b9c691b3f`
- `kasia-console/src/lib/u1-wiring-acceptance.mjs`: `bb0eb691629292a41b763805c809637903eed097`

## 1. Route placement defect — FIXED IN SOURCE

The previous P0 shape is gone. `POST /api/identity/u1-register` is now inside `registerIdentityRoutes(fastify)` before the function's final closing brace. Importing the module therefore no longer executes a top-level `fastify.post(...)` against an undefined `fastify` binding.

The handler also preserves the intended narrow authority surface:

- explicitly copies only `relayId`, `rootXpub`, `identityIndex`, `identityPubkeyXOnly`, `challenge`, `signature`;
- does not forward caller `custody`, clock, verifier, or expected-table controls;
- creates the challenge store from the Console singleton sqlite handle and canonical challenge table;
- fails closed if that store cannot be constructed;
- calls production `registerIdentity({ sqlite, submission, challengeStore })` without widening the production signature.

So the concrete source defect from the prior Codex RED is closed.

## 2. ① runtime-mount acceptance — improved, but committed proof is still weaker than requested

`u1-wiring-acceptance.mjs` now really imports `identities.js`; that is valuable because it kills the exact former top-level-`fastify` failure mode.

However, its registration check still uses a `Proxy` fake Fastify object and merely records calls such as `post /api/identity/u1-register`. It does **not** instantiate the repository's real Fastify dependency, run `ready()`, or `inject()` the route.

The coordination ledger reports NWT separately ran a real `import()+fastify.inject()` temporary-DB behavioral suite with 4 PASS. That is useful host/team evidence, but those executable bytes/output are not part of the five-commit repository delta inspected here; the committed acceptance file still contains only the Proxy form. Therefore Codex cannot independently reproduce the claimed real-Fastify behavioral closure from the repository object alone.

To close this remaining acceptance seam, commit the real runtime harness (or upgrade `u1-wiring-acceptance.mjs`) so it mechanically:

1. imports the actual Fastify package;
2. uses a disposable DB before importing the DB singleton;
3. registers `registerIdentityRoutes` on a real Fastify instance;
4. `await fastify.ready()`;
5. proves `POST /api/identity/u1-register` is present and reaches the handler via `fastify.inject()`;
6. contains a control/mutant that would fail if the route were moved back outside `registerIdentityRoutes`.

This is a **test-evidence blocker**, not a claim that current route source is still misplaced.

## 3. Custody TOCTOU mechanism — ACCEPTED IN CODE

The new `u1-registration.mjs` correctly separates the transaction-external custody check from the authority-bearing write:

- `custodyPre = deriveCustody(...)` is only a cheap prefilter;
- after binding/PoP checks, an `.immediate` SQLite transaction is opened;
- inside that write-locked transaction, `custody2 = deriveCustody(sqlite, relayId)` is re-read;
- any `RELAY_UNKNOWN`, `CUSTODY_NOT_MNEMONIC`, or `CUSTODY_AMBIGUOUS` result throws `_RegTxError` and rolls the registration/challenge transaction back;
- the INSERT uses `custody2.custody`;
- the success return uses `custodyWritten`, so it cannot silently return the stale pre-check result.

This is the correct mechanism shape for closing the stale `relay_nodes` custody observation between pre-check and registration write.

The new ②-2/②-3/②-4 tests also have useful non-vacuity guards: they first prove the pre-check was green and prove the mutation hook actually fired, then verify rejection + no registration row + no challenge consumption.

## 4. ①-10 is not yet mechanically closed as pre-registered

The committed `u1-wiring-acceptance.mjs` still explicitly prints:

`①-10 (TOCTOU) = PENDING`

That is now stale with respect to implementation, because ② exists, but simply deleting the PENDING line would be premature.

The pre-registered ①-10 criterion describes **another SQLite connection** changing `relay_nodes` in the window between the transaction-external derivation and the authority-bearing write. The newly added ②-2/3/4 mutation tests change `relay_nodes` through the same `sqlite` handle inside the test-only verifier hook. They prove the re-derive logic catches state changes, but they do not exercise the exact cross-connection writer shape or demonstrate the intended SQLite locking boundary against another connection.

There is already precedent in this same test file for opening `new Database(dbPath)` inside a hook (`E-3`). Use the same pattern for ①-10:

- pre-check green on connection A;
- verifier hook opens connection B and changes/deletes the relay row;
- production transaction on A begins IMMEDIATE and re-derives;
- assert the request fails with the correct custody/relay rejection;
- assert no registration row and no challenge consumption;
- retain a positive no-mutation control.

After that exact test passes, update the acceptance suite so ①-10 is actually executed and counted rather than printed PENDING.

## 5. Artifact #3 side-effect found during independent re-read — does NOT reopen Gate 1(b)

At approved probe commit `06b3bb55b7380c5fb6e48d9acab39be9aff68d08`, the pinned sender still contains a hard-coded shell variable:

`RELAY="e7f51073-6b6c-41ea-b7fe-e82e98531a9a"`

and before each send it executes a restart against:

`POST /api/relay/$RELAY/restart`.

The actual `/api/chat/send` request sends the payload file, whose `relayId` in artifact #3 is J2-tn `102cbb99...`. The credited rows are additionally bound by the exact J2 sender address and the full submit txid. Therefore the stale `RELAY=e7f...` restart target does **not** show that the three credited samples were sent as J1tn, and it does not invalidate the existing Gate 1(b) closure.

It is nevertheless a real operational side effect: a J2-scoped probe run restarts the old J1tn relay before attempts. The excluded rows' raw logTail exposes this clearly. Track/fix this before any future probe run; do not describe the current sender as fully J2-scoped end-to-end. The failClass attribution precision issue remains separately tracked.

## Current state

- Gate 1(a) raw 46-sample console-node evidence: prior Codex closure unchanged for its exact sampled window.
- Gate 1(b) artifact #3, J2-tn `isSynced=true` + `<1 DAA/s`: prior Codex closure unchanged; `<=32.532 s` remains only a poll-limited upper bound.
- Probe sender stale restart target: **OPEN operational side-effect**, non-reopening for existing credited samples.
- U1 route placement: **FIXED IN SOURCE**.
- U1 custody transaction-time re-derivation: **ACCEPTED IN CODE**.
- U1 ① real-Fastify committed runtime acceptance: **OPEN**.
- U1 ①-10 exact cross-connection TOCTOU acceptance: **OPEN**.
- U1 overall wiring / registration rollout: **NOT CLOSED / NOT AUTHORIZED**.

No production/testnet registration rollout, DB mutation, signing/broadcast, settlement/refund, key movement, process action, deployment, or production money-path modification is authorized by this review.
