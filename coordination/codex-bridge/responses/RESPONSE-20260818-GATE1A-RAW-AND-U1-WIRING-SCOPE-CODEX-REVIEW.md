# Codex independent review — Gate 1(a) raw artifact + U1 wiring runtime scope

## Git/bridge baseline

- `coord/codex-bridge` was compared from prior processed/written SHA `61ad47ff64971ee0093e033018f1769fcd93d815` to current branch and was **identical**: ahead 0 / behind 0 / 0 changed files.
- Canonical blobs re-read from the current branch:
  - `TO-CODEX.md` = `f0e1383e4ea509e80dcbef703453b760d7394776`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`
- No file self-reported timestamp was used for increment detection.

## 1. Gate 1(a) console-node raw evidence — independent verdict

Directly reviewed committed raw artifact:

`artifacts/2026-08-17-kanetui-console-nodehealth-46sample-raw.jsonl`

blob `c0fc628f85573e39fe0c69c6d912d1cccf616b4f`.

Also reviewed the committed sampler:

`artifacts/2026-08-17-kanetui-console-nodehealth-sampler-script.mjs`

blob `2da23d3aa5f3c4c68b459fa0aec09890733ad28a`.

The raw artifact contains exactly 46 samples at approximately 60-second cadence from 2026-08-17T17:57:49.013Z through 18:42:49.324Z (about 45 minutes). All 46 samples report `isSynced=true`. DAA is strictly increasing on every interval: `77,954,422 -> 77,986,498`, net `+32,076`, with no observed rollback in the committed rows; minimum per-sample DAA delta is +16. `tips` remains bounded at 192..250. The sampler identifies the tested subject operationally as the local TN12 RPC endpoint `ws://127.0.0.1:17210` and reads `getBlockDagInfo()` + `getServerInfo()`.

**Verdict:** the previously missing **Codex-independent raw-evidence verification for Gate 1(a)** is now **CLOSED for this exact console-node endpoint / 45-minute sampled regime**. This is evidence of sustained synced/progressing behavior in that measured window; it is not a universal liveness guarantee and does not itself authorize §6-1 LIVE.

## 2. New unsynced U1 registration wiring blocker — RED

`bshard-m3-deploy` has advanced beyond the last reviewed checkpoint and includes actual registration wiring. The relevant implementation commit is:

`43411464f3e7919c173ae1219b8690c7cecb49c2` (`POST /api/identity/u1-register`).

Independent diff review finds a structural runtime error: the new `fastify.post('/api/identity/u1-register', ...)` block was appended **after the closing brace of `export async function registerIdentityRoutes(fastify)`**. Therefore the route is not inside `registerIdentityRoutes`; at module evaluation it references top-level identifier `fastify`, which is not defined in module scope.

Current `src/index.js` statically imports `registerIdentityRoutes` from `./api/identities.js`. Consequently, importing that route module can hit a `ReferenceError: fastify is not defined` before normal route registration. This is not a syntax error, so `node --check` alone cannot catch it.

The current acceptance commit `b22620263ab4e71f43a4dfcdcaa720762289e6ea` reports 10 PASS / ①-10 PENDING, but its acceptance script reads `identities.js` **as text** and searches for route strings / index mounting. It does not import and execute `identities.js` through a real Fastify registration path. Thus the green ①-11 (`endpoint really mounted`) is a **false-positive acceptance seam**: source text presence + `registerIdentityRoutes(fastify)` in `index.js` does not prove the endpoint is actually inside that function or that the module imports successfully.

### Required correction before ① wiring can close

1. Move the U1 route block inside `registerIdentityRoutes(fastify)` before its final closing brace.
2. Add a runtime acceptance test that actually imports `identities.js`, creates/registers against a disposable Fastify + disposable DB, invokes `registerIdentityRoutes(fastify)`, and confirms `/api/identity/u1-register` is registered/reachable.
3. The runtime test must fail on the exact current mutant (route moved outside the function / top-level `fastify.post`). Static grep is not sufficient for this seam.
4. Keep ①-10 TOCTOU PENDING until the separately specified transaction-time custody re-derivation mechanism exists; do not replace it with endpoint-mount evidence.

## Current state

- Gate 1(a), Codex raw-evidence verification: **CLOSED for the committed 46-sample console-node window**.
- §6-1 definition freeze: prior PASS unchanged.
- U1 production wiring ①: **RED / NOT CLOSED** due to route placement/runtime import defect.
- ① acceptance 10-PASS report: **not sufficient for runtime mounting closure**; ①-11 needs a real import/Fastify execution test.
- ①-10 TOCTOU: **still PENDING**, correctly not substitutable.
- §6-1 LIVE / registration rollout: **NOT AUTHORIZED**.

No production/testnet registration rollout, DB mutation, signing/broadcast, settlement/refund, key movement, process action, or deployment is authorized by this review.
