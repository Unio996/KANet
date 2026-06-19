#!/usr/bin/env node
// run-migrations.mjs — standalone migration runner for the batch2 deploy (J1 #27a v2, 2026-06-14).
//
// WHY a separate script: migrate.js only EXPORTS runMigrations(); index.js calls it at Console boot, so
// `node src/db/migrate.js` alone is a NO-OP (defines nothing-runs). The (a) deploy order needs the schema
// (v170 side_lock_daa column) to exist BEFORE the standalone backfill runs and BEFORE Console restart — i.e.
// while the old Console code is still up. This wrapper provides that pre-restart standalone entry.
//
// SAFE: runMigrations() is idempotent — every migration block guards on PRAGMA table_info / catches
// "duplicate column" (v170 = ALTER TABLE ADD COLUMN in try/catch). Re-running on an up-to-date DB is all
// no-ops; on a v169 DB only v170 actually applies. Does NOT touch row data.
//
// RUN (from kasia-console dir, on EACH node, BEFORE backfill + BEFORE Console restart):
//   node scripts/run-migrations.mjs
// DB target = DB_PATH env (defaults to ./data/console.db, same as the app).

import { runMigrations } from '../src/db/migrate.js';

runMigrations();
console.log('[run-migrations] ✅ standalone migration run complete (v170 pool_bettor_sides.side_lock_daa applied if it was missing).');
process.exit(0);
