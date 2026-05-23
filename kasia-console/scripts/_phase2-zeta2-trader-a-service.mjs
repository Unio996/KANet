// T-J2-2026-05-11 Phase 2 ζ.2: Trader-A is_service=1 align SERVICE MUTE invariant
// Trader-A is_dex_broker=1 但 is_service=0 — race condition (Mind proactive vs broker handler reactive)
// migrate v76 auto-set is_dex_broker=1 → is_service=1 但 Trader-A 历史预存
// SERVICE MUTE invariant (mind-manager.js): is_service=1 OR is_dex_broker=1 mute Mind proactive

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'console.db');
const db = new Database(DB_PATH);

const before = db.prepare(`SELECT name, is_service, is_dex_broker FROM relay_nodes WHERE name='Trader-A'`).get();
console.log('Before:', JSON.stringify(before));

const r = db.prepare(`UPDATE relay_nodes SET is_service=1, updated_at=? WHERE name='Trader-A' AND is_service=0`).run(new Date().toISOString());
console.log(`UPDATE relay_nodes: ${r.changes} rows changed`);

const after = db.prepare(`SELECT name, is_service, is_dex_broker FROM relay_nodes WHERE name='Trader-A'`).get();
console.log('After:', JSON.stringify(after));

db.close();
