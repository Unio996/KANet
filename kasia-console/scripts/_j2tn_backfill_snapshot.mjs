#!/usr/bin/env node
// Backfill pool_snapshots for J2 e2e markets #1+#2 + any v0.7 market missing snapshot.
// Uses oracle_pool_chain_view latest cached row.
import Database from 'better-sqlite3';
import { ensurePoolSnapshot } from '../src/services/pool-market-settler-v06.mjs';

const DB = process.env.CONSOLE_DB || 'data/console.db';
const db = new Database(DB);
const cv = db.prepare('SELECT snapshot_daa, merkle_root, pool_size FROM oracle_pool_chain_view ORDER BY snapshot_daa DESC LIMIT 1').get();
db.close();

if (!cv) { console.error('no chain_view cached'); process.exit(1); }
console.log(`[backfill] using snapshot_daa=${cv.snapshot_daa} root=${cv.merkle_root} pool_size=${cv.pool_size}`);

const targetMarkets = [
  'ext-pool-v07-1780412004059-hd39i',
  'ext-pool-v07-1780412119197-2q1ew',
];

for (const mid of targetMarkets) {
  try {
    const r = ensurePoolSnapshot(mid, cv.merkle_root, cv.snapshot_daa);
    console.log(`[backfill] ${mid} ✓ pool_size=${r.pool_size} root=${r.pool_merkle_root.slice(0,16)} source=${r.source}`);
  } catch (e) {
    console.log(`[backfill] ${mid} FAIL ${e.message}`);
  }
}
