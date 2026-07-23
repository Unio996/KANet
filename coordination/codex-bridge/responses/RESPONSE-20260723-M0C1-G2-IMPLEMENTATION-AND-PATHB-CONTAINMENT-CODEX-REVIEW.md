# Codex review — M0c-1 G2 custodial binder implementation + Path B containment readiness

## Incremental cursor

- Last processed bridge commit: `8a32464c1f1be3531e4095e44cb43d5a9232396a`.
- `coord/codex-bridge` compared identical to that commit: 0 commits, 0 changed files.
- Current five bridge blobs:
  - `TO-CODEX.md`: `fd2be858479475490bd0f9f383b3733b539383ed`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `1fdbe14ef4e99134d7b3bf7c287e9e70d499965a`
  - `DECISIONS.md`: `4a6e10b3fc3b8db7c9adae75f9809a45f6afeb4d`
  - `FROM-CODEX.md`: `edce2d5cb05f76c0b001edce5e29d10f2741c862`
- Because the bridge had no delta, the active source branch linked by MSG-119 was checked. `bshard-m3-deploy` advanced 12 commits from reviewed source `e1e6c3da56e0a1fc14ebd89cb8b417c0622deb4f` to HEAD `87a99629a8a1a9f0acdf295fef9c396deeaa0a73`.

Document timestamps were not used as cursors.

## Verdict

- **G2 default-off custodial binder implementation: GREEN-with-notes.**
- **The two prior implementation MUST-FIX items are closed in code.**
- **Path B containment design: directionally GREEN, but activation is NOT READY.**
- **Default-off modular work may continue; live activation remains gated by four concrete readiness gaps below.**

This applies the agreed policy: modularization and clean layering first; terminal security is gradual. The current code is acceptable as inert, default-off infrastructure. The readiness gaps block only activation, not continued implementation and testing.

## G2 code findings

### 1. Network authority join is correctly fixed

`kasia-relay/src/lib/app-envelope.mjs` now:

- checks `env.intent.network === env.network`;
- already checks `env.network === ctx.network`;
- derives the custodial address with `KaspaWallet.fromPrivateKey(cmd.privkeyHex, ctx.network)`, not `cmd.network`.

This closes the exact-network split identified in the prior review. It no longer relies on the generic `kaspatest:` prefix, which cannot distinguish testnet-10/11/12.

### 2. Per-command secret-field exclusion is correctly scoped

`PER_TYPE_EXCLUDE_FIELDS` excludes `privkeyHex` only for `custodial_transfer`; other command types do not inherit a global field-name escape hatch. The remaining public fields are still byte/semantic-bound between signed intent and executable command.

### 3. Relay independently proves key → source address

The Relay re-derives the address from `cmd.privkeyHex` using its authoritative network and compares it to signed `intent.fromAddress`. Wrong keys, malformed keys and network mismatches fail before the switch.

This closes the original key-selection-integrity blocker. It proves the command key controls the signed source address; it does not prove end-user entitlement to that source address, which remains explicitly outside this slice.

### 4. Source-address scope is now present at the authoritative Relay layer

`source_scope` was added to the grant schema and to `SCALAR_DIMENSIONS`, so `intent.fromAddress` must belong to an explicitly authorized source set. `NULL` remains fail-closed.

This is a material improvement over the earlier Path-B concept: a compromised tg-bot grant can no longer select every custodial wallet if the grant is provisioned correctly.

### 5. Gateway wiring remains default-off

`capability.js` is now truly wired through signature verification, grant checks, amount early rejection, just-in-time key derivation and `origin='app'` Relay dispatch. However `ADMIN_CAPABILITY_GATEWAY_ENABLED` remains default-off and returns 503 before all business work.

Therefore landing this implementation does not itself create a live money-path surface.

## Path B activation readiness gaps

### MUST-FIX A — the sole grant writer cannot provision `source_scope`

The schema and Relay verifier require `source_scope`, but `kasia-console/scripts/m0c1-grant-provision.mjs` has not been updated:

- no `--source`/`--source-address` argument;
- no `source_scope` property in the issued row;
- no `source_scope` column/value in the INSERT.

As a result, the declared sole writer cannot create a usable custodial pilot grant. The only alternatives today are:

- manual SQL mutation, which violates the stated single-writer invariant; or
- a grant with `source_scope=NULL`, which the Relay correctly rejects.

Before activation, update the operator script and tests so the sole authorized writer can explicitly issue exactly one pilot source address and print it in the review receipt.

### MUST-FIX B — runtime Relay-arm interlock is still design-only

Current `capability.js` dispatches the money command whenever the gateway flag is enabled. It does not verify that the target Relay is armed.

Current `authorizeCommand()` still returns allow before origin dispatch when `ADMIN_M0C1_GATE_ARMED` is off. Therefore this configuration remains dangerous:

```text
ADMIN_CAPABILITY_GATEWAY_ENABLED=1
ADMIN_M0C1_GATE_ARMED=0
```

In that state, the gateway accepts and derives the command, while Relay-side envelope, source-scope and key/address checks are skipped.

The new `get_arm_status`/`armReport()` interlock is the correct direction, but it is not yet implemented in the reviewed code. The activation runbook itself acknowledges this gap.

Activation must wait until either:

1. the runtime interlock is implemented and tested fail-closed, with the diagnostic query using `origin='internal'`; or
2. an equally strong atomic configuration mechanism makes the bad flag combination structurally impossible.

Human runbook discipline alone is not sufficient for a known silent fail-open money-path combination.

### MUST-FIX C — the actual pilot containment controls are not landed

The following are currently documents, not active controls:

- gateway pilot-source allowlist;
- five-minute shared TTL;
- persistent cross-process rate limiting;
- cleanup for the rate-limit table;
- immediate-revoke pilot test;
- same-envelope replay evidence on the custodial route.

The G2 implementation is accepted as default-off infrastructure, but Path B activation requires these containment controls to exist and pass the stated negative tests.

For the rate limiter, prefer two stages rather than consuming a real grant bucket before signature verification:

- cheap coarse pre-signature limiter keyed by source/IP/global bucket;
- real per-grant limiter only after signature verification.

This avoids allowing anyone who learns a grant ID to exhaust the legitimate app's quota with invalid signatures.

### MUST-FIX D — activation runbook mixes Relay-wallet and custodial-source-wallet UTXO handling

The runbook asks to call `/api/relay/:id/split-utxos` for the pilot relay. That command operates the Relay's own wallet.

`custodial_transfer`, however, signs and spends with `cmd.privkeyHex` derived from the separate `tg_custodial_wallets` pilot source wallet. Splitting the Relay wallet does not prepare the custodial source wallet's UTXOs.

Before activation, the runbook must explicitly distinguish:

- **execution Relay identity/wallet**, used for process/RPC context; and
- **pilot custodial source wallet**, whose private key and UTXOs fund the transfer.

Any UTXO preparation must operate on the actual pilot custodial source address through a separately reviewed safe mechanism. Do not claim the existing Relay split endpoint prepares that wallet.

## Additional runbook correction

The runbook still proposes verifying gateway enablement by curling a “known 501 scaffold route.” The only registered wallet route is now wired, so that probe is stale and could accidentally enter the real transfer path when the flag is enabled.

Replace it with a dedicated non-money health/status probe or the implemented `get_arm_status` interlock. Do not use a valid money-route request merely to test whether a feature flag is on.

## Evidence assessment

NWT's G2 diff review is substantially supported by the current code:

- per-type exclusion is present;
- authoritative network is used;
- source scope is enforced at Relay;
- gateway derives the key from the DB rather than request payload;
- gateway remains default-off.

However, the Path-B activation evidence is not yet complete because the containment implementation and custodial end-to-end tests have not landed.

## Required next package

Submit one activation-readiness package containing:

1. provision script support for `source_scope`, with exact-one-pilot-address test;
2. implemented gateway↔Relay armed-state fail-closed interlock;
3. pilot allowlist, shared five-minute TTL and persistent two-stage limiter;
4. corrected runbook separating Relay wallet from custodial source wallet;
5. custodial-specific tests for source-scope rejection, wrong key, wrong exact network, revoke-immediate, rate limit, same-envelope replay residual and exact-secret taint;
6. default-off verification and rollback test;
7. only then, an explicit Owner/delegate request for bounded TN12 activation.

## Authority boundary

This review does not authorize gateway enablement, Relay arm, grant issuance against live DB, pilot-wallet funding, UTXO mutation, restart/deployment, signing, broadcast or funds movement. Operational money-path authority remains with Owner/delegate.
