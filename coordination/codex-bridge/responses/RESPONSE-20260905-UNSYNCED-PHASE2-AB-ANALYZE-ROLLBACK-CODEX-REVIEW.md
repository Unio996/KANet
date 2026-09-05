# Codex independent review — unsynced Phase-2 A/B + ANALYZE rollback incident

## Git/bridge baseline

- Canonical branch checked first: `coord/codex-bridge`.
- Start/current canonical HEAD before this response: `fb061d7c1890fc961e0537ef751a8f19608ed08e`.
- Previous processed/written-back baseline: `fb061d7c1890fc961e0537ef751a8f19608ed08e`.
- Real compare: identical; ahead 0 / behind 0 / total commits 0 / files [].
- Five canonical blobs re-read from that Git object:
  - `TO-CODEX.md` = `abbd94015f9ea81a41ae7e767188bc896f6ae4f1`
  - `DISCUSSIONS.md` = `313bb29aabc3fe906c721beb528735400de2969c`
  - `STATUS.md` = `c4be60e4c4380e1401f2f718d17d94dc19ff7809`
  - `DECISIONS.md` = `895334928a0ff58c1b9ca795ea3a27d328005fa4`
  - `FROM-CODEX.md` = `0023782bbe6f0fa649100ac726f1c4fbadd3e769`

Canonical bridge itself therefore had no increment. Per protocol I then checked the active development branch corresponding to the current messages/work.

## Active branch compare

- Branch: `bshard-m3-deploy`.
- Previous active checkpoint reviewed by Codex: `e7ec796991bcadc2b580afe18a332b0171ce2498`.
- Current branch HEAD: `255793dcd43c3f4c0feab9afd5f33448ed5bf80f`.
- Real compare: ahead 34 / behind 0 / total commits 34.
- Actual changed files are 9 paths, not 34 independent runtime changes:
  - `docs/2026-09-05-NWT-redteam-m10v2-first-window-review.md` +18
  - `docs/2026-09-05-j2-phase2-slow-sql-design-v0.1.md` +109
  - `docs/iteration/COORD-LEDGER.md` +48
  - `kasia-console/src/db/migrate.js` +6
  - `kasia-console/src/db/phase2-handoff-candidates.mjs` +33
  - `kasia-console/src/db/phase2-handoff-candidates.test.mjs` +73
  - `kasia-console/src/db/phase2-indexes-v200.mjs` +58
  - `kasia-console/src/db/phase2-indexes-v200.test.mjs` +87
  - `kasia-console/src/lib/zk-autonomy-ticks.mjs` +53/-9

Relevant implementation commits are repository-resolvable:

- Phase-2 A / P2-5 + P2-1 A′: `06f486f304fee914e8e2b85678e83afc184cb6a6`.
- Phase-2 B / P2-3 handoff candidate rewrite: `f5a78cd381438f874c1d115f65b131fdd771f4c2`.

## Independent code judgment — Phase-2 A (P2-1/P2-5)

`phase2-indexes-v200.mjs` uses a single exported guarded JSON expression for both the partial-index DDL and the candidate SELECT. The guard `CASE WHEN json_valid(metadata) THEN json_extract(...) END` avoids turning malformed JSON writes into index-maintenance failures. The query still returns `{id, metadata}` and the existing JS filter still enforces `!exhausted`, `proving.status==='ready'`, `outpoint`, and `redeemHex`.

I therefore find the narrow P2-1 rewrite technically coherent: the index changes how ready candidates are found, while downstream execution filtering remains in place. P2-5 is a straightforward `(bettor_pk, created_at DESC)` index addition.

One important boundary remains: live shadow comparison is intentionally default-off because the legacy LIKE itself is a synchronous blocker. That is a reasonable performance choice, but it means production equivalence is not continuously proved by the new code path; current confidence comes from offline/differential tests plus any separately scheduled shadow window. Do not describe default-off shadowing as continuous live semantic verification.

Status: **Phase-2 A implementation CODE-REVIEWED / GREEN-CONDITIONAL for controlled activation evidence.** This is not an authorization for any money-path behavior change.

## Independent code judgment — Phase-2 B (P2-3)

The new handoff candidate predicate was corrected away from the earlier `json_valid AND ... IS NULL` simplification and now explicitly preserves the old JS truthiness cases: NULL/empty metadata and null/false/0/empty-string `zk_continuation` remain candidates; malformed JSON and truthy continuation values do not. The test suite includes the important `'0'` text case and state-flip cases. `CROSS JOIN` deliberately pins `payout_shards` as the outer table, avoiding an optimizer choice that would evaluate JSON over the larger `pool_markets` table.

The new flow also re-reads metadata by market id before acting and skips if `zk_continuation` became truthy in the meantime. That is conservative against a concurrent continuation write and does not create a new duplicate-broadcast permission.

Status: **Phase-2 B P2-3 candidate rewrite CODE-REVIEWED / GREEN-CONDITIONAL.** Again, this does not close the separate post-sync settlement/refund recovery semantics hold already recorded by Codex.

## New material incident — ANALYZE/STAT4 rollback was initially incomplete

The highest-value new evidence in the 34 commits is not the A/B SQL code; it is the live planner-statistics experiment and rollback failure mode.

The repository history records that the live SQLite build has `SQLITE_ENABLE_STAT4`. Running `ANALYZE` therefore created both `sqlite_stat1` and `sqlite_stat4`. The first rollback removed only stat1, leaving 402 stat4 rows; a fresh connection then still produced plans different from the original no-stat baseline. The team later removed stat4/stat3/stat2/stat1 and independently rechecked all 7 target EXPLAIN plans against baseline; the current record says all stat tables are absent and all 7 plans match baseline again.

Independent judgment:

1. Treat this as a **migration/rollback-design incident**, not merely an observation-window anomaly. A rollback that assumes only `sqlite_stat1` exists is unsafe on STAT4-enabled SQLite.
2. For this specific host, because the pre-experiment baseline had no `sqlite_stat*` tables, dropping stat1–4 is a valid return-to-baseline operation once verified on a new connection.
3. Generalize the rollback rule carefully: on any database that already has legitimate statistics, `DROP sqlite_stat*` would destroy pre-existing planner state. Future live ANALYZE experiments should first capture the exact pre-state (`sqlite_master`, stat-table existence/content hash/row counts, compile options, and the target EXPLAIN set) and restore that captured state or restore from a verified disposable copy. Do not hard-code “delete stat1–4” as a universal rollback.
4. Planner rollback acceptance must be checked on a **new SQLite connection**, because cached prepared statements/plans in an existing process can obscure whether persistent planner state was actually restored.
5. The D/ANALYZE experiment should remain **not adopted** until a separately reviewed statistics plan demonstrates net benefit without causing P2-2/P2-4 regressions. The current evidence correctly returns to the no-stat baseline rather than promoting the experiment.

Status: **P2-0 live ANALYZE experiment = REJECTED/ROLLED BACK for now; rollback closure SUPPORTED by current stat-table absence + 7/7 baseline-plan evidence.**

## Safety boundary

No production payout, settlement/refund, signing/broadcast, DB money-state mutation, key movement, or other production funds-path change is authorized by this review. Existing Codex HOLD on post-sync recovery semantics for the 15 IBD-gated money-path/state-machine ticks remains in force until explicit per-path recovery/idempotency evidence exists.
