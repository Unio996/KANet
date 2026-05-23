#!/usr/bin/env node
// Phase 3g Sub 9.5 — Brier diverge audit hotfix.
//
// 双 host 实证: Bettor host Brier=0.704 vs J1 host 0.244 (0.46 deviation, 同代码同算法).
// 同代码不该差这么多 — root cause: (a) outcome 反 (b) predicted 方向反 (c) data set diff
// (d) calibrator math bug.
//
// 此 audit: dump per-position raw data + recompute Brier 实证.
//
// 用法: node scripts/_audit-brier-divergence.mjs

import { createRequire } from 'node:module';
const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const kasiaRequire = createRequire(`${KANET_ROOT}/kasia-console/`);
const Database = kasiaRequire('better-sqlite3');
const DB_PATH = `${KANET_ROOT}/kasia-console/data/console.db`;

const db = new Database(DB_PATH, { readonly: true });

const ROLLING_DAYS = 30;
const sinceIso = new Date(Date.now() - ROLLING_DAYS * 24 * 60 * 60_000).toISOString();

console.log(`=== Brier diverge audit · host=${process.env.HOSTNAME || 'J1?'} · ${ROLLING_DAYS}d rolling since ${sinceIso} ===\n`);

// step 1: dump per-position raw
const rows = db.prepare(`
  SELECT p.id pos_id, p.direction, p.entry_yes_price, p.size_usd, p.opened_at, p.closed_at,
         p.realized_pnl, p.close_reason,
         r.id rec_id, r.market_id, r.p_mid, r.sigma, r.yes_price rec_yes_price,
         r.calibrator_confidence,
         s.current_yes_price, s.unrealized_pnl, s.drift_pp,
         (SELECT question FROM bettor_recommendations br WHERE br.market_id = r.market_id LIMIT 1) q
  FROM bettor_sim_positions p
  JOIN bettor_recommendations r ON r.id = p.recommendation_id
  LEFT JOIN bettor_sim_snapshots s ON s.id = (
    SELECT id FROM bettor_sim_snapshots WHERE position_id = p.id ORDER BY snapshot_at DESC LIMIT 1
  )
  WHERE p.closed_at IS NOT NULL AND p.closed_at > ?
  ORDER BY p.closed_at DESC
`).all(sinceIso);

console.log(`settled rows: ${rows.length}\n`);

// step 2+3+4: per-position Brier manual compute + matrix
let bandStats = { low: [], mid: [], high: [], null: [] };
let directionStats = { NO: [], YES: [] };
let allBriers = [];

for (const r of rows) {
  // Outcome derivation (跟 track-record-audit.mjs 同款)
  let outcome = null;
  if (r.current_yes_price != null) {
    if (r.current_yes_price >= 0.99) outcome = 1;
    else if (r.current_yes_price <= 0.01) outcome = 0;
  }
  // Brier root cause finding: predicted = LLM's p_mid (forecast of yes_outcome), NOT entry_yes_price (market price).
  // Brier 是 LLM forecast accuracy 不是 market accuracy.
  const predicted = r.p_mid;
  const brier = (outcome !== null && predicted !== null) ? Math.pow(predicted - outcome, 2) : null;
  // 旧 buggy Brier (用 entry_yes_price) 比对:
  const predictedBuggy = r.direction === 'NO' ? (1 - r.entry_yes_price) : r.entry_yes_price;
  const brierBuggy = (outcome !== null && predictedBuggy !== null) ? Math.pow(predictedBuggy - outcome, 2) : null;
  const brierInverse = brierBuggy;  // alias for backward compat

  const band = r.calibrator_confidence || 'null';
  const isWin = (r.realized_pnl || 0) > 0;

  if (brier !== null) {
    bandStats[band] = bandStats[band] || [];
    bandStats[band].push(brier);
    directionStats[r.direction] = directionStats[r.direction] || [];
    directionStats[r.direction].push(brier);
    allBriers.push(brier);
  }

  // Print row (first 30 only)
  if (rows.indexOf(r) < 30) {
    console.log(`${r.pos_id?.slice(0,8)} mkt=${r.market_id?.slice(0,8)} dir=${r.direction} ` +
                `entry_yes=${r.entry_yes_price?.toFixed(3)} p_mid=${r.p_mid?.toFixed(3)} ` +
                `cur_yes=${r.current_yes_price?.toFixed?.(3) ?? 'null'} ` +
                `outcome=${outcome ?? 'unresolved'} pred=${predicted?.toFixed(3)} ` +
                `Brier=${brier?.toFixed(3) ?? 'n/a'} (inv=${brierInverse?.toFixed(3) ?? 'n/a'}) ` +
                `pnl=$${r.realized_pnl?.toFixed?.(2) ?? '0'} ${isWin ? 'WIN' : 'LOSS'} band=${band}`);
  }
}

// step 5: aggregate
const mean = arr => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

console.log(`\n=== Aggregate Brier ===`);
console.log(`overall: n=${allBriers.length} Brier=${mean(allBriers)?.toFixed(3) ?? 'n/a'}`);
console.log(`per band:`);
for (const [band, briers] of Object.entries(bandStats)) {
  console.log(`  ${band}: n=${briers.length} Brier=${mean(briers)?.toFixed(3) ?? 'n/a'}`);
}
console.log(`per direction:`);
for (const [dir, briers] of Object.entries(directionStats)) {
  console.log(`  ${dir}: n=${briers.length} Brier=${mean(briers)?.toFixed(3) ?? 'n/a'}`);
}

// step 6: unresolved + outlier surface
const unresolved = rows.filter(r => r.current_yes_price == null || (r.current_yes_price > 0.01 && r.current_yes_price < 0.99));
console.log(`\nunresolved (no current_yes_price terminal): ${unresolved.length}/${rows.length}`);

const outliers = rows.filter(r => {
  const outcome = r.current_yes_price >= 0.99 ? 1 : (r.current_yes_price <= 0.01 ? 0 : null);
  const predicted = r.direction === 'NO' ? (1 - r.entry_yes_price) : r.entry_yes_price;
  const brier = outcome !== null ? Math.pow(predicted - outcome, 2) : null;
  return brier !== null && brier > 0.5;
});
console.log(`Brier > 0.5 outliers (predict 反): ${outliers.length}`);
for (const o of outliers.slice(0, 5)) {
  console.log(`  ${o.pos_id?.slice(0,8)} dir=${o.direction} entry_yes=${o.entry_yes_price?.toFixed(3)} cur_yes=${o.current_yes_price?.toFixed?.(3)} pnl=$${o.realized_pnl?.toFixed?.(2)} (${o.q?.slice(0,40)})`);
}

db.close();
