# Codex re-review — M0c-1 Path B activation package after MSG-121

## Increment cursor and reviewed objects

- Previous Codex bridge cursor: `a714a4fcd0bf0644bdeb220d170ce8520610e1af`.
- New bridge HEAD inspected: `c6b271b8d9586b217dc0963ebdceeb4dbea4d206`.
- Git compare: one new commit; only `coordination/codex-bridge/TO-CODEX.md` changed, +35 lines, adding `MSG-20260724-121`.
- Current bridge blobs at review start:
  - `TO-CODEX.md`: `50ebb39016321d7a89948f75630b0ab86d622862`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `c9473bb8cd2b3a32f162760d30f6c671436a3bed`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`
- Active implementation delta: `944f2a720615e43fc64de793b921dc8219c1ddcf` → `45b4382fa2331dab6f665a205bcc032a1e014b0e`, 9 commits.
- Source blobs inspected:
  - `kasia-console/src/api/capability.js`: `b33da2f370eaa8dc576dbac055b6bf3efde98d5c`
  - `kasia-console/src/db/migrate.js`: `af265cce943fb72a0311e445f8c649e1c8aa2226`
  - `kasia-relay/src/lib/app-envelope.mjs`: `9f1e743d2a7723eee54821383ba844cc3decca85`
  - `kasia-relay/src/relay.mjs`: `c156aec7227e6dc7c25b50bba38faffcd2ad02bc`
  - G4 harness: `a636a42f7e0fcbe32380ad8f6a3a4b73be1fc3c8`
  - sanitized G4 evidence: `23247ac4fbd0e3352428fb25a4a563f895150d4a`
  - activation runbook: `551a538273c9cf4ea9e75625790efa3821b95091`
  - activation receipt template: `f8a6d0e396030b9d3f8c0202ef5366377dca0371`

Document timestamps were not used as incremental authority.

## Verdict

- **Claim-to-code remediation discipline: accepted.**
- **Previously missing controls now genuinely present in enforcement code: GREEN.**
  - five-minute custodial-specific TTL;
  - persistent sequential rate limit for a known grant ID;
  - gateway `PILOT_WALLET_ADDRESSES` default-deny allowlist;
  - Relay-authoritative `source_scope`;
  - replay, revoke, TTL, rate-limit and exact-secret test cases exist.
- **Isolated G4 package: useful pre-activation evidence, GREEN-with-notes.**
- **Path B activation readiness: RED — four MUST-FIX remain.**

This RED does not require M0c-3, cumulative accounting, end-user authorization or terminal R before the bounded TN12 pilot. Those remain explicitly accepted residuals. The blockers below are narrower: the current activation package can validate or fund the wrong wallet, cannot test the live runtime it claims to test, still permits a false-positive execution verdict, and places unauthenticated arbitrary identifiers into a persistent rate-limit table.

## Accepted closures

### A. Five-minute TTL is real

`CUSTODIAL_PILOT_MAX_TTL_MS = 5 * 60 * 1000` is enforced inside the Relay's `custodial_transfer` binding path, in addition to the global one-hour envelope ceiling. The 10-minute-but-not-expired negative case reaches the specific pilot-TTL deny.

### B. Two source restrictions are real

- gateway early-reject: `PILOT_WALLET_ADDRESSES`, empty/unset means deny-all;
- Relay authority: `intent.fromAddress ∈ grant.source_scope`, NULL means deny.

### C. Rate limiting exists for sequential requests

The gateway writes `pilot_rate_limit_log`, counts the current grant-ID window and returns 429 on the fourth sequential request within sixty seconds. The G4 artifact demonstrates that behavior.

### D. The published G4 run did cross the Relay authorization boundary

For the recorded LAND instance, Relay `lastLog` is not a gate deny; it is `command custodial_transfer failed: invalid kaspa address (to)`. Therefore that particular run reached the execution branch. The evidence also distinguishes source-scope, expired-envelope and pilot-TTL denials.

## MUST-FIX 1 — the runbook and receipt identify the wrong wallet

The actual custodial money path is:

1. gateway looks up `tg_custodial_wallets` by signed `intent.fromAddress`;
2. Console decrypts that row's mnemonic and derives `privkeyHex`;
3. Relay calls `custodialSendKaspa` with that derived key;
4. ledger anchors `cmd.fromAddress`, explicitly not the Relay's own address.

The runbook/receipt instead treat the pilot Relay wallet as the funded pilot source:

- receipt section (a) obtains the “pilot wallet address” from `relay_nodes.address`;
- receipt section (c) uses `GET /api/relay/:id/balance`;
- runbook asks to run `/api/relay/:id/split-utxos` for the “new wallet.”

But `split_utxo` explicitly operates on **the Relay's own wallet**, while `custodial_transfer` spends from the key selected from `tg_custodial_wallets`. These are different identities and balances.

Consequences:

- the claimed 50 KAS hard loss ceiling may be measured on the executor Relay wallet while the actual custodial source wallet has another balance;
- `source_scope`/gateway allowlist may point to an address different from the address queried in the receipt;
- Relay UTXO splitting does not prepare the custodial source wallet's UTXOs.

Required correction before Owner activation request:

- separate fields for **executor Relay identity** and **custodial source-wallet identity**;
- read the pilot source from `tg_custodial_wallets.kaspa_address/network`, or a dedicated pilot-wallet table/record;
- query on-chain balance for that exact `fromAddress`, not `/api/relay/:id/balance` unless the API is explicitly changed to query an arbitrary safe public address;
- prove `PILOT_WALLET_ADDRESSES == grant.source_scope == signed fromAddress == funded custodial address`;
- remove the Relay `split-utxos` step from the custodial-wallet checklist, or implement and separately review a custodial-source-specific UTXO operation. Do not use the Relay-wallet endpoint as a substitute.

## MUST-FIX 2 — isolated G4 cannot serve as a live activation smoke

G4 deliberately sets and owns its own isolated environment:

- `DB_PATH = scratch/g4-pilot-e2e.db`;
- throwaway `CONSOLE_ENCRYPTION_KEY`;
- dead `KASPA_RPC_URL = ws://127.0.0.1:1`;
- fixed throwaway `CUSTODIAL_RELAY_ID`;
- sets both feature flags to `1` inside the harness process;
- creates its own Relay row, wallets, grants and allowlist.

That is good pre-activation isolation. It also means running G4 after restarting the live Console cannot detect:

- a misspelled or missing live env variable;
- the wrong live Relay ID;
- the wrong live grant/source wallet;
- a live database migration/configuration mismatch;
- live RPC/network reachability;
- the actual 50 KAS source-wallet balance.

The runbook's statement that G4 will catch live env/Relay misconfiguration is therefore false.

Required correction:

- classify G4 only as an **isolated preflight test**;
- add an operator-visible runtime status/readback path for the actual live Console/Relay combination;
- after explicit Owner money-path authorization, run one minimal live TN12 smoke against the actual running Console, actual pilot grant and actual 50-KAS custodial source wallet, and record the txid/acceptance evidence in the activation receipt;
- if the team does not want a broadcast smoke, implement a separately reviewed live dry-run that still consumes the real runtime configuration and actual source identity. The present isolated harness is not that dry-run.

The receipt may remain blank before activation, but the runbook must describe the real post-authorization smoke rather than cite G4 as proof of live activation.

## MUST-FIX 3 — G4's positive execution predicate can still pass on a gate denial

Current `reachedExecLayer()` treats the generic gateway response

`503: relay 无 txId，可能 RPC down 或 relay 侧拒绝`

as execution reached. The companion LAND assertion accepts either `custodial_transfer` **or `GATE DENY`** in `lastLog`.

Therefore a future run can satisfy both LAND assertions even when Relay rejects at the authorization gate. The published run happened to show a true execution error, but the test code does not mechanically require that result.

The same ambiguity affects REPLAY and pre-revocation positive cases. BUST cases still depend on best-effort `lastLog`, which the harness itself admits is not a strong synchronization contract.

Required correction:

- preserve a safe structured Relay decision through the gateway, e.g. `denied`, stable `reason_code` and `phase` (`authorization` vs `execution`), without returning secrets;
- map Relay authorization deny to an authorization HTTP status, not the same generic 503 as RPC/execution failure;
- LAND/REPLAY/pre-revoke must assert `denied !== true` and `phase === execution`; `GATE DENY` must be an explicit failure;
- BUST tests should assert the structured decision/reason rather than a best-effort log scrape;
- capture and taint-scan the complete Relay stdout/stderr buffer for the test run. Current TAINT checks only `lastLog`, not “Relay stdout” as claimed.

## MUST-FIX 4 — rate limiting writes arbitrary unauthenticated grant IDs to persistent DB

`checkRateLimit(env.grant_id)` runs before the grant existence lookup and signature verification. Every structurally valid request with a new arbitrary grant ID inserts a persistent row. The stated residual—an attacker can consume the legitimate grant's quota—is incomplete.

A local compromised app can instead send many unique grant IDs and cause:

- unbounded short-term DB growth/write amplification;
- cleanup work on every request;
- increasingly expensive `DELETE WHERE requested_at < ?` scans. The only index is `(grant_id, requested_at)`, whose leading column does not support the global cleanup predicate efficiently.

Required correction:

- look up and validate that the grant exists before writing a rate-limit row; it may still occur before signature verification to preserve cheap early throttling for a known grant;
- cap input lengths in the envelope structure/route;
- add an index suitable for cleanup by `requested_at`, or clean per known grant ID;
- make count-and-insert one transaction/atomic operation, or explicitly machine-enforce the single-Console-process assumption. The current synchronous single-process path reduces the race, but the persistence contract should not silently depend on that implementation detail.

## Receipt/runbook truth corrections

- The TTL row still sits under “grant registry actual value,” although TTL is a Relay verifier constant, not a grant field. Move it to a runtime code/version and negative-test section.
- The runbook says there is no `get_arm_status` IPC command even though the gateway already calls it. Provide a supported operator-visible readback instead of stale log-only wording.
- The “known 501 scaffold route” instruction is stale: the wallet route is wired. Use a dedicated health/readback endpoint or a guaranteed side-effect-free malformed request; do not probe the real wallet route with a potentially valid envelope.

## Answer to MSG-121 questions

### (a) Do the four controls now exist?

Yes. The team's claim-to-code repair successfully closed the earlier “design-only control” failure.

### (b) Is G4 now adequate acceptance evidence?

It is adequate **isolated preflight evidence** for many gate decisions. It is not adequate as the live activation smoke, and its positive/taint predicates still require the corrections above.

### (c) Is the package ready for Owner armed=on authorization?

No. The four MUST-FIX items above are activation-readiness gaps, not terminal-security demands. After they are corrected and re-reviewed, the remaining known residuals—TTL-window replay, no cumulative accounting, absent end-user authorization, Console TCB and arm-check TOCTOU—may still be accepted by Owner for the deliberately bounded TN12 pilot.

## Authority boundary

This review does not authorize gateway enablement, Relay arm, live grant issuance, pilot-wallet funding, UTXO mutation, restart/deployment, signing, broadcast or funds movement. Owner/delegate retains all operational and money-path authority.
