// _stress_rollback.mjs — Phase 5-6 KI 45 Sub-5 (NWT N19.94 Q-rollback)
//
// Restore Console state after a stress test crash / mid-way abort.
// Reads latest logs/stress-state/run-*.json backup (written pre-test by stress_5_5_A test setup).
//
// Restores:
//   - config_entries: hedge_router_enabled, small_order_cex, small_order_threshold_usd
//   - process.env.KANET_STRESS_MODE (delete env)
//   - DELETE test marker rows from treasury_snapshot (source LIKE 'stress_5_5_A_%')
//   - DELETE test marker rows from chain_events (txid LIKE 'stress_5_5_A_%')
//
// Does NOT reverse:
//   - on-chain TX (final, irrecoverable)
//   - prefund USDT transfers (Trader-A funded for future use)
//
// Usage:
//   node scripts/_stress_rollback.mjs                # restore latest run
//   node scripts/_stress_rollback.mjs --run=<id>    # restore specific run

import { readFileSync, readdirSync, existsSync } from 'node:fs';
try {
  const env = readFileSync('C:/kanet/kanet.env', 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

import Database from 'better-sqlite3';

const STATE_DIR = 'C:/kanet/logs/stress-state';
const DB_PATH = 'C:/kanet/kasia-console/data/console.db';
const CONSOLE_URL = process.env.CONSOLE_URL || 'http://127.0.0.1:3100';

function pickStateFile() {
  if (!existsSync(STATE_DIR)) {
    console.error(`FATAL: state dir ${STATE_DIR} does not exist — no stress run to rollback`);
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const runArg = args.find(a => a.startsWith('--run='));
  if (runArg) {
    const runId = runArg.split('=')[1];
    const f = `${STATE_DIR}/run-${runId}.json`;
    if (!existsSync(f)) { console.error(`FATAL: ${f} not found`); process.exit(1); }
    return f;
  }
  const files = readdirSync(STATE_DIR).filter(f => f.startsWith('run-') && f.endsWith('.json'));
  if (files.length === 0) { console.error('FATAL: no stress run state files'); process.exit(1); }
  files.sort();
  return `${STATE_DIR}/${files[files.length - 1]}`;
}

const stateFile = pickStateFile();
console.log(`[rollback] reading state ${stateFile}`);
const state = JSON.parse(readFileSync(stateFile, 'utf8'));

console.log(`[rollback] run_id=${state.run_id || 'unknown'} started=${state.started_iso || '?'}`);

// 1. Restore config_entries
const cb = state.config_backup || {};
console.log(`[rollback] restoring config_entries: ${Object.keys(cb).join(', ') || '(none)'}`);
for (const [k, v] of Object.entries(cb)) {
  if (v !== undefined && v !== null) {
    try {
      const res = await fetch(`${CONSOLE_URL}/api/config-set`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: k, value: v }),
      });
      if (res.ok) console.log(`  ✓ ${k} = ${v}`);
      else console.log(`  ✗ ${k} HTTP ${res.status}`);
    } catch (e) {
      console.log(`  ✗ ${k} err: ${e.message}`);
    }
  }
}

// 2. KANET_STRESS_MODE — process env (current process) — no-op for external rollback (env scoped to test process)
console.log(`[rollback] KANET_STRESS_MODE: process-scoped, not affecting current shell`);

// 3. DELETE test marker rows
const db = new Database(DB_PATH);
const markerPrefix = state.marker_prefix || 'stress_5_5_A_';
console.log(`[rollback] deleting rows with marker prefix '${markerPrefix}'`);
let tsDeleted = 0, ceDeleted = 0, eoDeleted = 0;
try {
  // treasury_snapshot
  const ts = db.prepare(`DELETE FROM treasury_snapshot WHERE source LIKE ?`).run(`${markerPrefix}%`);
  tsDeleted = ts.changes;
  // chain_events (only those tagged with marker — via txid prefix)
  const ce = db.prepare(`DELETE FROM chain_events WHERE txid LIKE ?`).run(`${markerPrefix}%`);
  ceDeleted = ce.changes;
  // exchange_offers (also via marker)
  const eo = db.prepare(`DELETE FROM exchange_offers WHERE json_extract(metadata, '$.source') LIKE ?`).run(`${markerPrefix}%`);
  eoDeleted = eo.changes;
} catch (e) {
  console.log(`[rollback] DELETE err: ${e.message}`);
}
console.log(`  treasury_snapshot: ${tsDeleted} rows`);
console.log(`  chain_events: ${ceDeleted} rows`);
console.log(`  exchange_offers: ${eoDeleted} rows`);

db.close();
console.log(`[rollback] complete. State file kept (audit): ${stateFile}`);
