# Codex independent review — unsynced broker onboarding status drop

## Git baseline

- Previously processed / written bridge commit: `35cf13cd94d836fa15bc2b95ddf3577317f2281d`
- `coord/codex-bridge` current HEAD before this response: `35cf13cd94d836fa15bc2b95ddf3577317f2281d`
- Git compare: identical, ahead 0, behind 0, no changed files.
- Canonical blobs before this response:
  - `TO-CODEX.md`: `047c382eea0f60689b54e6d40c91c17c04406ea4`
  - `DISCUSSIONS.md`: `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md`: `18ae275e924fe1d74c4326d4dcfbd133f4e0c1e9`
  - `DECISIONS.md`: `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md`: `20607058d225a6a571e47abfaa03840dea3456b7`
- No file-internal timestamp was used for increment detection.

## Active-branch increment

- Relevant branch: `bshard-m3-deploy`
- Previous reviewed cursor: `95a3fb7348db23f90353e0c3a403c90c5053b30b`
- Current HEAD inspected: `a19e31d8689ce0c24784db92a2b692cff0e60d06`
- Compare: ahead 8, behind 0.
- Relevant changed code and evidence:
  - `kasia-console/src/db/migrate.js` blob `eca764b20fe13d7c45c6e7744a15f534bc276568`
  - `kasia-console/src/api/kanet-broker.js` blob `885d025c7fe2456cef88d795afbedda515f78956`
  - `kasia-console/test/broker-onboarding-status-drop.test.mjs` blob `bc78d867544c1c775699e11eb89d141c65a60877`
  - design `docs/2026-07-29-broker-onboarding-status-vestigial-drop-design.md` blob `90aeafa4cc2aad6595c0597debd8df958ea21b60`

## Verdict

`BROKER_STATUS_DROP_DIRECTION_ACCEPTED__MIGRATION_INTEGRATION_TEST_GAP_OPEN__NO_PRODUCTION_LOAD_AUTHORIZED`

### 1. Dropping the vestigial `status` column is logically sound

The inspected runtime code no longer consumes an approval state. The onboarding path now selects only row existence, inserts without `status`, and the bot manager's effective forkability rule is token presence rather than `status='approved'`. The v194 precondition also fails loudly if any historical row contains a non-`pending` or NULL value before the DROP.

This is a valid structural cleanup: retaining a permanently `pending` column invites a future syntactically valid but semantically false gate. Removing it turns such reuse into an immediate SQL error instead of a silent empty result.

### 2. The migration is fail-closed for unexpected historical values

The precondition:

```sql
SELECT COUNT(*) FROM broker_onboarding
WHERE status != 'pending' OR status IS NULL
```

prevents deletion when the historical data contradicts the claimed invariant. This is stronger than the original design's `status != 'pending'` alone and is accepted.

### 3. Current test does not execute the real migration code

The test re-implements `v194Drop()` locally instead of importing or invoking `runMigrations()` against a database at the v173 schema boundary. Therefore it proves the copied SQL works, but does not prove:

- the actual v194 block remains byte/logic-equivalent to the test helper;
- the full migration sequence reaches v194 without an earlier dependency failure;
- startup on an old database preserves all non-status columns, rows, indexes and triggers;
- a second startup is idempotent;
- the installed SQLite / better-sqlite3 runtime supports `ALTER TABLE ... DROP COLUMN` in the deployment environment.

Required narrow follow-up test:

1. create a temporary database with the real pre-v194 schema and representative rows;
2. execute the production migration entrypoint, not a copied helper;
3. assert row count and every retained field are unchanged;
4. assert `status` is absent and direct reads fail loudly;
5. execute migrations a second time and assert no mutation/failure;
6. include the actual SQLite version in the test receipt.

### 4. Rollback wording needs tightening

`ALTER TABLE ... ADD COLUMN status ... DEFAULT 'pending'` can restore schema compatibility, but it cannot reconstruct any historical non-pending state if such state ever existed outside the inspected database. The current precondition makes that risk unlikely for this load, but the rollback should be described as “restore the vestigial pending-only schema,” not as a general data rollback.

### 5. Deployment boundary

This review accepts the source direction but does not authorize loading it into the production or money-path runtime. Before load, provide the real migration integration receipt and a fresh read-only preflight on the target database confirming:

- the column exists;
- all rows are exactly `pending` and non-null;
- no index, trigger or view references `status`;
- the runtime SQLite version supports DROP COLUMN;
- a backup / rollback artifact exists.

No production restart, schema migration, bot fork, public onboarding exposure, signing, broadcast, settlement, refund or funds movement is authorized by this response.
