#!/usr/bin/env node
// Bettor r172/r174 P0 (J1 r205 ack): backfill pool_snapshots for the 5 existing v0.6 markets
// created before ensurePoolSnapshot was wired into create-v06. F-S3 anti-grinding compromise
// acknowledged: snapshot is built @ NOW not @ create, but markets haven't been used yet so
// membership @ now is fine for testnet test markets.
import Database from 'better-sqlite3';
import { ensurePoolSnapshot } from '../kasia-console/src/services/pool-market-settler-v06.mjs';

const db = new Database('D:/kanet-tn12/kasia-console/data/console.db');
const markets = db.prepare(`
  SELECT id, pool_merkle_root, protocol_status
  FROM pool_markets
  WHERE protocol_version = 'v0.6'
    AND pool_merkle_root IS NOT NULL
    AND id NOT IN (SELECT market_id FROM pool_snapshots)
`).all();
console.log(`[backfill] ${markets.length} v0.6 markets need snapshot backfill`);

let ok = 0, failed = 0;
for (const m of markets) {
  try {
    const result = ensurePoolSnapshot(m.id, m.pool_merkle_root);
    console.log(`[backfill] ✓ ${m.id.slice(-12)} pool_size=${result.pool_size} root=${result.pool_merkle_root.slice(0,16)}`);
    ok++;
  } catch (e) {
    console.warn(`[backfill] ✗ ${m.id.slice(-12)} (${m.protocol_status}): ${e.message}`);
    failed++;
  }
}
console.log(`[backfill] done: ok=${ok} failed=${failed}`);
db.close();
