# Codex review — unsynced §10 C6 follow-up

Verdict: **C6 ACCEPTED AT CODE/DESIGN LAYER; GREEN-at-live remains HOLD.**

I rechecked `coord/codex-bridge` first against the last processed/writeback commit `5bf01a288470c2dda86b36999e7971fe00fbbdfb`; the bridge is still identical. I then followed the directly related active branch and reviewed C6 (`e32b894f857aad56f918b4b7921f3983729c7da3`) rather than treating the coordination ledger as proof.

## C6 network CHECK

The new v198 table-level constraint

`network TEXT NOT NULL CHECK (network IN ('testnet-12','mainnet'))`

is the correct defense-in-depth follow-up to MSG-285. It does not replace the application-layer `localNetwork` authority check, but it prevents direct/alternate writers from persisting out-of-domain values in the authority table.

I also reviewed `u1-v198-migration-acceptance.mjs`. The new ④-8 arm has real discriminatory value:

- direct INSERT of `devnet`, `testnet-11`, and empty network must fail;
- `testnet-12` and `mainnet` must pass;
- source A is the actual `sqlite_master` CREATE TABLE SQL;
- source B is imported `S10_NETWORKS`;
- an explicit positive-control mismatch proves the set-comparison itself can fail.

That is materially better than comparing two copies of the same literal.

The in-place v198 DDL edit is acceptable **only under the currently stated fact that no authoritative/live DB has ever run v198**. Once any authoritative DB has created the old v198 table, `CREATE TABLE IF NOT EXISTS` cannot retrofit the CHECK and a new migration version/rebuild would be required. Keep that condition explicit; do not generalize this pattern to already-deployed migrations.

## GREEN-at-live runbook

The L1-L8 runbook shape is acceptable and preserves the previous boundary: code-layer green is not live green. In particular, L5 is acceptable because both keys are Owner-controlled and the success path writes only the correct B identity; L7 correctly avoids mutating the live legacy key column merely to manufacture a poisoning test; L8 keeps DB-identity verification as a first-class positive control.

Two scope constraints remain unchanged:

1. `GREEN-at-live` still requires Owner-authorized D-005 migration/restart plus actual L1-L8 evidence on the intended live DB/process.
2. This does **not** close same-host/process/filesystem ownership, rotate/revoke, or legacy identity-continuity questions.

No new code-level blocker was found in C6. The previous SHOULD-FIX on the network closed enum is therefore **CLOSED**.

Current state:

- §10 v1 register-only five-slice: **GREEN AT CODE LAYER**.
- C6 network table-level closed enum: **CLOSED**.
- post-migration live validation: **OPEN / HOLD**.
- live migration/restart/deployment: **NOT AUTHORIZED by this review**.

No production funds-path change, signing/broadcast, settlement/refund, key movement, or external exposure is authorized.