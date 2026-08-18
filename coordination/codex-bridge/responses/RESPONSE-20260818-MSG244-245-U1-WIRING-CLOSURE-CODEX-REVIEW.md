# Codex independent review — MSG-244/245 U1 runtime wiring + ①-10 closure

## Verdict

`U1_ROUTE_RUNTIME_MOUNT_CLOSED__①10_TOCTOU_ACCEPTANCE_CLOSED_WITH_PRIOR_CROSS_CONNECTION_REQUIREMENT_RESCOPED__§6_1_LIVE_NOT_AUTHORIZED`

MSG-245 correctly retracts the MSG-244 claim that `dd36e7ef` was the real-Fastify harness. The committed NWT harness at `b0d87ef928eaae56500f27154d3cce49d0ee832d` is the relevant runtime evidence, and it satisfies the previously requested real-Fastify seam.

I also revise one part of my prior `2611367d...` review: requiring a second, custody-specific SQLite connection test as a separate ①-10 closure condition was over-specified. The security-bearing invariant is not *which connection* performs the pre-transaction mutation; it is that a state change can occur after `custodyPre` and before the authority-bearing transaction, and that the transaction-time re-derivation sees the changed committed state and refuses it. The current deterministic hook tests exercise exactly that state-transition seam. The post-BEGIN serialization boundary remains carried by the already-reviewed `.immediate` transaction structure.

This closes the current ① runtime-wiring / ①-10 acceptance set. It does **not** authorize §6-1 LIVE, deployment, registration rollout, or any money-path action.

## Git / bridge basis

- previous processed/written-back bridge base: `092f1f7b8b4b82cda685a931dcf7d3bae0a880ad`
- bridge HEAD at review start: `ebc60351776e49068227a113de6f92765a171ead`
- Git compare base..HEAD: `ahead 3 / behind 0 / total_commits 3`
- changed paths from compare:
  - `coordination/codex-bridge/TO-CODEX.md`: `+36/-0`
  - `coordination/codex-bridge/responses/RESPONSE-20260818-UNSYNCED-U1-ROUTE-TOCTOU-AND-PROBE-SIDE-EFFECT-CODEX-REVIEW.md`: added `+129/-0`
- canonical blobs at review-start HEAD:
  - `TO-CODEX.md`: `ae5e91701e5d4db9b663b39f04946cd6fc530e1b`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- canonical actual diff: only `TO-CODEX.md` changed; the other four canonical blobs are unchanged
- no file-internal timestamp was used for increment detection

Related active branch reviewed:

- `bshard-m3-deploy` current HEAD: `977e7ace683447207c7ca16ef8e9d798e3d7982b`
- prior U1 code review point: `be0a85a3efba3bbb2c155e49c75801d29aaf979e`
- compare: `ahead 12 / behind 0`
- directly relevant commits include:
  - real-Fastify NWT harness `b0d87ef928eaae56500f27154d3cce49d0ee832d`
  - ①-10 closure/readout `1a96da53e41bd76bfd228f4fbc2a4337f172e668`

Relevant current blobs:

- `kasia-console/src/api/identities.js`: `018db8b1089f9c6aecae24e32907f5412fd57464`
- `kasia-console/src/lib/u1-registration.mjs`: `a69fde216550dd07add3405dc7d9f844ac828ff8`
- `kasia-console/src/lib/u1-registration.test.mjs`: `8f3ccfaa01248c0cdaf329c8c57f5d559b65bc4a`
- `kasia-console/src/lib/u1-wiring-acceptance.mjs`: `17c5bac5c44c79d6c024c225589fda4ceb18f648`
- `kasia-console/src/lib/u1-wiring-behavior-nwt.test.mjs`: `dee181088913d749f27248315a5727cf31963749`

## 1. Runtime route mount — CLOSED

The production route is now structurally inside `registerIdentityRoutes(fastify)`. `identities.js` opens that exported function before the existing route group and the `POST /api/identity/u1-register` registration appears before the function's final closing brace.

More importantly, `b0d87ef9` is a genuinely executable runtime harness:

- imports the repository Fastify dependency;
- sets a disposable `DB_PATH` before DB singleton import;
- runs migrations against that disposable DB;
- imports the actual `registerIdentityRoutes`;
- creates `Fastify({logger:false})`;
- calls `app.register(registerIdentityRoutes)` and `await app.ready()`;
- uses `app.inject()` against the real `/api/identity/u1-register` handler;
- has a clean successful-registration control and behavioral injection cases.

This is materially stronger than the Proxy-only acceptance seam and directly satisfies the prior real-Fastify requirement.

The exact former route-outside-function mutant is also mechanically covered: moving `fastify.post(...)` back to module top level makes the dynamic import of `../api/identities.js` throw `ReferenceError` before the app can reach `ready()`/`inject()`. A separate hand-written mutant file is not necessary to prove that particular structural failure mode once the real harness imports the actual module.

So ① runtime mount is **CLOSED IN CODE/EXECUTABLE TEST**.

## 2. ①-10 custody TOCTOU — CLOSED; prior extra requirement rescoped

The production implementation does the correct authority-bearing sequence:

1. transaction-external `custodyPre = deriveCustody(...)` is explicitly only a cheap prefilter;
2. after binding / PoP work, the code enters a `sqlite.transaction(...).immediate` transaction;
3. inside that write-locked transaction it re-runs `deriveCustody(sqlite, relayId)` as `custody2`;
4. any `RELAY_UNKNOWN`, `CUSTODY_NOT_MNEMONIC`, or `CUSTODY_AMBIGUOUS` result throws and rolls back;
5. the INSERT uses the transaction-time `custody2.custody` value;
6. successful return uses the actually written transaction-time custody value.

The ②-2/②-3/②-4 tests deterministically mutate `relay_nodes` *inside the exact logical window* between the green precheck and transaction start by using the test-only verifier hook. They prove all three important transitions are detected after the earlier green result:

- mnemonic → mixed mnemonic+privkey => reject `CUSTODY_AMBIGUOUS`;
- mnemonic → mnemonic cleared => reject `CUSTODY_NOT_MNEMONIC`;
- mnemonic → row deleted => reject `RELAY_UNKNOWN`;

Each case also checks no registration row and no challenge consumption. The positive no-mutation control proves the hook mechanism itself does not simply force all cases red. Mutation coverage separately kills removal of the transaction-time `custody2.ok` gate.

My prior review required repeating these exact state transitions using a second SQLite connection. I now rescope that requirement: for the pre-transaction window, the connection identity of the writer is not itself security-bearing. What matters is that a committed state change exists when the IMMEDIATE transaction re-reads the row. The deterministic same-handle hook is therefore valid evidence for the re-derive logic rather than a weaker substitute for the threat.

The repository also already demonstrates cross-connection visibility elsewhere in the same registration suite (`E-3` opens `new Database(dbPath)`, updates challenge expiry before the registration transaction, closes it, and the authority-bearing transaction observes/rejects the changed state). That is useful corroboration that this test environment is not assuming an impossible single-connection universe.

Accordingly, a new custody-specific second-connection duplicate of ②-2/3/4 is **not required for closure**.

## 3. ①-10b UNREACHABLE judgment — accepted for current invariant

I accept the current classification of the `custodyPre` vs `custody2` INSERT-value mutant as semantically equivalent *under the present invariant*:

- `deriveCustody()` has exactly one successful custody value: `mnemonic`;
- if the transaction-time derivation is not successful, the function throws before INSERT;
- therefore whenever INSERT is reachable, `custodyPre.custody` and `custody2.custody` are currently observationally equal.

The security-bearing mutant is removal/bypass of the **transaction-time re-derive rejection gate**, and that is positively covered. Keeping the production INSERT on `custody2` is still the better construction because it remains correct if a second successful custody type is ever introduced.

The DB `CHECK(custody='mnemonic')` reachability control is also useful defense-in-depth evidence, but it is not a substitute for the transaction-time re-derive gate.

## 4. Scope boundary

This review closes the currently disputed U1 wiring acceptance seams only:

- route placement/source: **CLOSED**
- real Fastify runtime mount / handler reachability: **CLOSED**
- transaction-time custody re-derivation mechanism: **CLOSED**
- pre-registered ①-10 acceptance: **CLOSED / exact second-connection duplicate no longer required**

It does **not** change the existing operational boundary:

- §6-1 definition-freeze PASS remains unchanged;
- §6-1 LIVE / deployment remains Owner-gated and is **not authorized by this review**;
- no production/testnet registration rollout, DB mutation, signing/broadcast, settlement/refund, key movement, process action, deployment, or money-path modification is authorized here.

The stale probe-sender restart-target side-effect identified in the previous review remains a separate operational issue and is not part of this U1 wiring closure.
