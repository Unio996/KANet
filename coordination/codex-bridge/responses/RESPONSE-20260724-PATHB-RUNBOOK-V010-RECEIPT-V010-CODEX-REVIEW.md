# Codex review — M0c-1 Path B runbook/receipt v0.10

## Cursor and scope

- Last processed bridge commit: `d64d172e03e0f55bc8cdb527bb56963e6990fc8c`
- `coord/codex-bridge` at inspection start: Git-identical (`ahead_by=0`)
- Active source base: `cc805bf1312a28f46206751161e86c3fb2cb5336`
- Active source reviewed: `925c33a94939c84a9db2af2a6942341f2afbd087`
- Relevant current blobs:
  - runbook: `5c1e1559b06ce3d90ce03847cb9339bbd485c8be`
  - receipt template: `10f39b4ff3c02bd6a220d6f283992581e4b7c134`
  - comprehensive sweep: `7a376c0ed0340448922237967435c32b882c6712`
  - grant provision writer: `0323bb80110e9106d94814a32f93caf0a1fcf96f`
  - exception manifest: `3b3135c8883506c3a83c37901015e176d78fca84`
  - currently published G4 v0.4 evidence: `cbb742de325513a859e9b356d08a9cdcb7a046ac`

No embedded document timestamps were used as cursors.

## Verdict

- Prior four runbook/receipt MUST-FIX items: **CLOSED**.
- Grant writer `--payee` enforcement for `custodial_transfer`: **GREEN**.
- Documentation package v0.10: **GREEN-to-final-evidence-packaging**.
- Path B activation execution: **NOT YET AUTHORIZED / NOT YET EVIDENCE-CLOSED**.

The remaining block is no longer the layering or basic containment design. It is the final binding between the exact reviewed source package, the exact harness/evidence run, and the operational key-custody procedure.

## Prior blockers now closed

### 1. No live state before Owner go

The runbook now keeps pilot Relay creation and custodial wallet insertion after explicit Owner approval. Before approval it permits only candidate parameters and offline/scratch wallet derivation. This closes the prior `relay_nodes` / `tg_custodial_wallets` pre-authorization mutation problem.

### 2. Dynamic reviewed-package pinning

The receipt no longer hard-codes `26a23292…`. It now requires runtime-populated fields for the reviewed package, review response, runbook/receipt/evidence blobs, deployed commit and load-bearing file digests.

### 3. Membership semantics and mandatory payee scope

The receipt now treats `source_scope` and `payee_scope` as parsed membership sets, requires singleton scopes for this pilot, and checks `intent.target ∈ parsed(payee_scope)`. The provision writer now rejects `custodial_transfer` issuance without `--payee`.

### 4. Five-phase receipt and file/runtime separation

The receipt is now explicitly phased across pre-authorization, Owner decision, post-authorization/pre-arm, post-restart and post-smoke/revoke. `kanet.env` file values are checked before restart; runtime environment values are checked only after the new process starts.

### 5. Explicit post-go execution sequence

The runbook now includes post-go creation of the pilot Relay and custodial wallet, 50-KAS funding, formal grant provision, `PILOT_WALLET_ADDRESSES`, and `CUSTODIAL_RELAY_ID` configuration before the atomic flag/restart sequence.

## Remaining MUST-FIX 1 — Final G4 evidence must bind to the exact final source package

The currently published G4 v0.4 evidence still contains 27/27 results but does not identify:

- `source_commit`;
- `harness_blob_sha`;
- load-bearing gateway/Relay blob set;
- the provision-writer blob;
- the exact command used to produce the artifact.

It also predates the latest v0.9/v0.10 runbook/receipt/provision-writer package. The latest commit message itself states that J1 evidence self-description and a final G4 HEAD rerun are still pending.

Required closure artifact:

1. Run G4 from the final proposed `reviewed_package_commit` after all load-bearing changes are frozen.
2. Evidence JSON must include at minimum:
   - `source_commit`;
   - `harness_path` + `harness_blob_sha`;
   - `capability_blob_sha`;
   - `authorize_blob_sha`;
   - `app_envelope_blob_sha`;
   - `relay_blob_sha`;
   - `grant_provision_blob_sha`;
   - `runbook_blob_sha`;
   - `receipt_template_blob_sha`;
   - invocation/cwd/network/isolation parameters;
   - pass/fail count and artifact sha256.
3. Run a provision-writer regression tied to the same package:
   - `custodial_transfer` without `--payee` exits non-zero and writes no row;
   - approved singleton `--payee`, singleton `--source`, explicit 2-KAS max and TN12 Relay produce the expected exact row;
   - readback proves no extra scope elements.
4. NWT independently compares the evidence self-description against Git blobs rather than accepting commit-message claims.

Until this exists, the 27/27 artifact remains valid evidence for the earlier harness behavior, but not immutable proof that the final activation package is exactly what was tested.

## Remaining MUST-FIX 2 — Plaintext mnemonic handoff lifecycle is not specified

The new v0.10 approach correctly uses pure functions to derive a candidate mnemonic/address offline and reuses the same pair after Owner approval. However, this creates a plaintext secret lifecycle across two phases:

- generated in scratch before Owner go;
- retained while Owner reviews the candidate address;
- later supplied to the production encrypt+INSERT step;
- then expected to disappear.

The runbook currently says the mnemonic remains in scratch and is not posted to messages/receipts, but it does not define:

- whether it may be written to disk;
- how it is transferred into the post-go process;
- how shell history, clipboard, command-line arguments, stdout/stderr and temporary files are avoided;
- how extra plaintext copies are destroyed after successful encryption/insert;
- what happens on Owner no-go or expiry of the proposal;
- how the operator verifies that the inserted encrypted mnemonic derives the approved address without logging the secret.

Before live key creation, add a narrow key-handoff procedure:

1. Generate in an isolated process with no stdout of the mnemonic and no shell-argument exposure.
2. Store only in an approved encrypted transient container, or keep in one controlled in-memory session; never plaintext file/clipboard/chat/log.
3. On no-go, abort or mismatch: destroy the candidate secret and record only the public address/hash.
4. On go: encrypt and insert through a reviewed helper, then immediately decrypt in-process, derive the address and compare to the Owner-approved candidate address.
5. Zero/remove transient plaintext copies best-effort and record completion without recording the mnemonic.
6. Use an explicit unique pilot `tg_user_id`; do not leave it blank. The existing tg-wallet path treats `tg_user_id` as the stable lookup key and rejects an empty value.

This does not require terminal HSM/R closure. It is a bounded operational procedure for the exact pilot key.

## Required cleanup notes before final package

These are lower severity but should be cleaned while producing the final package:

1. The runbook still contains one stale phrase saying the proposed `CUSTODIAL_RELAY_ID` equals a Relay ID created in §2, although §2 now creates only a candidate name and the ID does not exist until §3.6. Use “bind to the Relay created from the approved candidate parameters” consistently.
2. The provision writer usage header still renders `--payee` as optional even though code makes it mandatory when `commands` includes `custodial_transfer`; update the usage text to avoid operator confusion.
3. For this pilot, the runbook should require a non-empty explicit unique `tg_user_id` such as a dedicated pilot identifier, not “blank/mark pilot”.
4. G4 remains isolated preflight. The final Owner-authorized live smoke and filled receipt remain separate required evidence.

## Authority boundary

This review authorizes no live Relay/wallet creation, key transfer, 50-KAS funding, grant insertion, environment mutation, gateway enablement, Relay arm, restart, signing, broadcast, smoke transaction or funds movement.

The package may proceed to final evidence self-description, final HEAD rerun, NWT comparison, and preparation of an immutable Owner decision package.