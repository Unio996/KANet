// ingest-spc-daa.test.mjs — regression coverage for POST /ingest/spc-daa-block write logic
// (docs/2026-07-08-backward-walk-daa-index-design.md §2.2/§2.5, NWT attack-surface review #o0056j).
// Exercises the exact SQL sequence used by kasia-console/src/api/ingest.js's spc-daa-block route
// against an in-memory DB (route itself isn't DI'd for isolated testing — mirrors the existing
// fee-split-phase2.test.mjs convention of re-running the real SQL against a temp schema).
// Run: node src/api/ingest-spc-daa.test.mjs

import Database from 'better-sqlite3';

let failed = 0;
function assert(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}`);
  else { console.log(`  ✗ ${name}` + (detail ? ` — ${detail}` : '')); failed++; }
}

function freshDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE spc_daa_index (
      daa_score INTEGER PRIMARY KEY,
      block_hash TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL
    );
    CREATE TABLE spc_daa_index_coverage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      start_daa INTEGER NOT NULL,
      end_daa INTEGER NOT NULL
    );
  `);
  return db;
}

const ADJACENCY_PLACEHOLDER = 10; // mirrors SPC_INDEX_ADJACENCY_PLACEHOLDER in ingest.js

// Re-implements the exact route logic (kept in lockstep with ingest.js by design — a divergence
// here means the route's behavior silently changed without the regression test catching it).
function ingestSpcDaaBlock(db, { daaScore, blockHash, timestampMs }) {
  db.prepare(`INSERT OR IGNORE INTO spc_daa_index (daa_score, block_hash, timestamp_ms) VALUES (?, ?, ?)`)
    .run(daaScore, blockHash, timestampMs || 0);

  const latest = db.prepare(`SELECT id, start_daa, end_daa FROM spc_daa_index_coverage ORDER BY end_daa DESC LIMIT 1`).get();
  if (latest && (daaScore - latest.end_daa) >= 0 && (daaScore - latest.end_daa) <= ADJACENCY_PLACEHOLDER) {
    db.prepare(`UPDATE spc_daa_index_coverage SET end_daa = ? WHERE id = ?`).run(daaScore, latest.id);
  } else if (!latest || daaScore > latest.end_daa) {
    db.prepare(`INSERT INTO spc_daa_index_coverage (start_daa, end_daa) VALUES (?, ?)`).run(daaScore, daaScore);
  }
}

console.log('[ingest-spc-daa.test] spc_daa_index write + coverage regression');

// 1. Basic write.
{
  const db = freshDb();
  ingestSpcDaaBlock(db, { daaScore: 1000, blockHash: 'AAAA', timestampMs: 111 });
  const row = db.prepare(`SELECT * FROM spc_daa_index WHERE daa_score = 1000`).get();
  assert('row written', row && row.block_hash === 'AAAA');
}

// 2. THE MUST-FIX scenario: INSERT OR IGNORE is first-write-wins. This documents *why* the
// finality-depth gate must live on the relay write side (drain-finality-safe-blocks.test.mjs) —
// Console has no way to distinguish "correct value" from "stale reorg'd value" after the fact.
{
  const db = freshDb();
  ingestSpcDaaBlock(db, { daaScore: 1000, blockHash: 'stale-reorged-out', timestampMs: 111 });
  ingestSpcDaaBlock(db, { daaScore: 1000, blockHash: 'canonical', timestampMs: 222 });
  const row = db.prepare(`SELECT * FROM spc_daa_index WHERE daa_score = 1000`).get();
  assert(
    'OR IGNORE keeps first value (documents why relay-side finality gate is load-bearing)',
    row.block_hash === 'stale-reorged-out',
    `got ${row.block_hash}`,
  );
}

// 3. Coverage: adjacent writes extend the same region.
{
  const db = freshDb();
  ingestSpcDaaBlock(db, { daaScore: 1000, blockHash: 'a', timestampMs: 1 });
  ingestSpcDaaBlock(db, { daaScore: 1005, blockHash: 'b', timestampMs: 2 }); // within ADJACENCY_PLACEHOLDER
  const regions = db.prepare(`SELECT * FROM spc_daa_index_coverage`).all();
  assert('single region after adjacent writes', regions.length === 1);
  assert('region extended to 1005', regions[0].start_daa === 1000 && regions[0].end_daa === 1005);
}

// 4. Coverage: a gap (relay restart / console backoff) opens a NEW region, old one untouched
// (§2.5 "诚实标注洞" — never silently bridge a gap).
{
  const db = freshDb();
  ingestSpcDaaBlock(db, { daaScore: 1000, blockHash: 'a', timestampMs: 1 });
  ingestSpcDaaBlock(db, { daaScore: 5000, blockHash: 'b', timestampMs: 2 }); // far beyond ADJACENCY_PLACEHOLDER
  const regions = db.prepare(`SELECT * FROM spc_daa_index_coverage ORDER BY start_daa`).all();
  assert('two disjoint regions after a gap', regions.length === 2);
  assert('first region unchanged (1000-1000)', regions[0].start_daa === 1000 && regions[0].end_daa === 1000);
  assert('second region opened fresh (5000-5000)', regions[1].start_daa === 5000 && regions[1].end_daa === 5000);
}

console.log(failed === 0 ? '\n[ingest-spc-daa.test] ALL PASS' : `\n[ingest-spc-daa.test] ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
