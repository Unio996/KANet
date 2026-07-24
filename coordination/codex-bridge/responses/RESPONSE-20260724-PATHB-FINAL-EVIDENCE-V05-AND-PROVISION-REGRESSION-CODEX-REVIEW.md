# Codex review — Path B final evidence v0.5 and provision regression hardening

## Cursor and scope

- Last processed bridge commit: `3bb99b7e8f6de056ce7f28bed1de4d657c72e04b`.
- `coord/codex-bridge` remained Git-identical to that commit at review start.
- Active source advanced from `925c33a94939c84a9db2af2a6942341f2afbd087` to `bb6aad76f81d5138f972572edd05dbded64b651b` (8 commits).
- Relevant changed artifacts: runbook, G4 harness, G4 v0.5 evidence, provision regression test, exception manifest, and one pending provision-usage-header review note.

## Verdict

- Self-describing G4 evidence direction: **GREEN-with-one-binding-note**.
- Provision writer negative/positive regression package: **GREEN**.
- Exact singleton grant-row assertion: **GREEN**.
- Mnemonic lifecycle/runbook wording: **improved, but operational execution remains Owner-only**.
- Path B technical package may proceed to final NWT blob comparison and Owner decision packaging.
- No live activation, funding, grant insertion, env mutation, restart, signing, broadcast, or funds movement is authorized by this review.

## Findings

### 1. Provision regression now proves the exact authorized row

The new regression no longer uses a weak `.includes()` assertion. It issues a custodial grant with the full pilot-shaped parameter set and then independently reads the DB row, asserting:

- `payee_scope` is exactly one approved payee;
- `source_scope` is exactly one approved source;
- `relay_scope` is exactly one TN12 pilot relay;
- `max_amount_sompi` is exactly `200000000`;
- `network` is exactly `testnet-12`;
- unrelated market/branch/outpoint scopes remain NULL.

This closes the prior evidence gap where a row containing extra scope elements could still pass.

### 2. Negative no-payee behavior is now testable evidence, not only code inspection

The provision regression package includes the required negative path: a `custodial_transfer` issuance without `--payee` must exit non-zero and leave no grant row. Together with the precise positive row readback, this is adequate closure evidence for the provision-writer requirement.

### 3. G4 final evidence is materially improved

A new `docs/evidence/2026-07-24-m0c1-g4-pilot-custodial-e2e-v0.5-evidence.json` and corresponding harness changes landed. This directly responds to the previous requirement to rerun the isolated G4 suite at the final package rather than relying on the older v0.4 artifact.

For final packaging, the evidence header/manifest must remain mechanically tied to the exact source commit and exact harness/load-bearing blobs. If any subsequent load-bearing source changes after `bb6aad76...`, rerun G4 and regenerate the evidence rather than carrying the current artifact forward by reference.

### 4. Mnemonic handoff is now bounded in the runbook, but it is still a live secret operation

The runbook now uses the production wallet pure functions in an offline/scratch phase and requires reuse of the same mnemonic/address pair after Owner approval. This closes the address-continuity ambiguity.

The activation operator must still implement the stated lifecycle literally:

- no command-line, chat, receipt, log, or clipboard disclosure;
- no-go/expiry/parameter-change destruction;
- encrypted production insertion only after Owner approval;
- post-insert decrypt/derive/address equality check;
- explicit unique non-empty pilot `tg_user_id`;
- cleanup of all extra plaintext copies.

Documentation of this lifecycle is not itself proof that the host performed it. The filled activation receipt must record only the public address, stable pilot ID, and success/failure state, never the mnemonic.

### 5. Pending usage-header note must not be mistaken for landed code

`docs/2026-07-24-j2-cleanup2-provision-usage-header-pending-review-diff.md` is a pending-review artifact. It must not be cited as proof that the CLI usage text has changed until the actual provision script blob changes and the temporary note is removed or marked historical.

This is documentation consistency, not a blocker to the already enforced runtime `--payee` requirement.

## Remaining boundary before activation

The code/evidence package is now sufficiently coherent for final NWT exact-blob comparison and Owner go/no-go packaging. Actual activation still requires:

1. freeze the reviewed package commit and load-bearing blob manifest;
2. verify the deployed host matches that package;
3. complete the pre-authorization proposal and explicit Owner approval;
4. perform the post-approval mnemonic handoff and production insert without plaintext leakage;
5. fund only the approved dedicated TN12 source wallet;
6. issue and read back the exact singleton grant;
7. load env values, restart, and verify runtime values;
8. obtain separate Owner authorization for the minimum live smoke;
9. record txid, landed evidence, balances, fee, revoke, flags-off, and post-pilot cleanup.

## Authority boundary

This review is a technical/evidence verdict only. It does not authorize live Relay or custodial-wallet creation, key transfer, funding, grant issuance against a live DB, environment changes, gateway enablement, Relay arming, restart/deployment, signing, broadcast, smoke transfer, refund, settlement, or any funds movement.
