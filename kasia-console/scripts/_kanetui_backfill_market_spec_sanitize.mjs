// _kanetui_backfill_market_spec_sanitize.mjs — 一次性 backfill: 清理 dirty resolution_rule_spec.
// KANet-UI 2026-06-03 Bettor 派 D backfill.
//
// 跑: cd kasia-console && node scripts/_kanetui_backfill_market_spec_sanitize.mjs
// 模式: 读 dry-run (默认), --write 真改 DB.

import Database from 'better-sqlite3';
import { sanitizeMarketSpec } from '../src/lib/market-spec-sanitizer.js';

const WRITE = process.argv.includes('--write');
const db = new Database('./data/console.db', { readonly: !WRITE });

const rows = db.prepare(`
  SELECT id, resolution_rule_spec
  FROM pool_markets
  WHERE outcome_market_source = 'polymarket'
    AND (resolution_rule_spec LIKE '%http%'
      OR resolution_rule_spec LIKE '%www.%'
      OR resolution_rule_spec LIKE '%<%'
      OR resolution_rule_spec LIKE '%“%'
      OR resolution_rule_spec LIKE '%”%')
`).all();

console.log(`[backfill] mode=${WRITE ? 'WRITE' : 'DRY-RUN'} dirty_count=${rows.length}`);

let changed = 0;
for (const r of rows) {
  const cleaned = sanitizeMarketSpec(r.resolution_rule_spec);
  if (cleaned === r.resolution_rule_spec) continue;
  changed++;
  console.log(`\n--- ${r.id} ---`);
  console.log(`BEFORE (${r.resolution_rule_spec.length}c): ${r.resolution_rule_spec.slice(0, 150).replace(/\n/g, '\\n')}...`);
  console.log(`AFTER  (${cleaned.length}c): ${cleaned.slice(0, 150).replace(/\n/g, '\\n')}...`);
  if (WRITE) {
    db.prepare('UPDATE pool_markets SET resolution_rule_spec = ? WHERE id = ?').run(cleaned, r.id);
  }
}

console.log(`\n[backfill] ${changed} markets cleaned. ${WRITE ? 'COMMITTED' : 'DRY-RUN (re-run with --write to commit)'}`);
db.close();
