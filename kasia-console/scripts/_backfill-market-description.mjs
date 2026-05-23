// One-off backfill: 18 个 P0.1 前老 sim_positions market_description=NULL
// 从 Polymarket gamma-api 现拉 condition_id → description 写回 DB
// Owner 5/11 钦定 "用新代码评估老仓位, 不等"

import D from 'better-sqlite3';
const db = new D('C:/kanet/kasia-console/data/console.db');

const rows = db.prepare(`
  SELECT p.id, p.recommendation_id, r.condition_id, r.market_id, substr(r.question,1,60) q
  FROM bettor_sim_positions p
  JOIN bettor_recommendations r ON r.id = p.recommendation_id
  WHERE p.closed_at IS NULL AND p.size_usd > 0 AND p.market_description IS NULL
    AND r.condition_id IS NOT NULL
`).all();

console.log(`backfill candidates: ${rows.length}`);

const update = db.prepare(`UPDATE bettor_sim_positions SET market_description=? WHERE id=?`);
let ok = 0, fail = 0;
for (const r of rows) {
  try {
    // gamma-api by condition_id
    const res = await fetch(`https://gamma-api.polymarket.com/markets?condition_ids=${r.condition_id}`, {
      headers: { 'User-Agent': 'KANet-Bettor/1.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) { fail++; console.log(`  ✗ ${r.id.slice(0,8)} HTTP ${res.status}`); continue; }
    const data = await res.json();
    const market = Array.isArray(data) ? data[0] : (data.markets?.[0] || data);
    const desc = (market?.description || '').slice(0, 5000);
    if (!desc) { fail++; console.log(`  ✗ ${r.id.slice(0,8)} no description`); continue; }
    update.run(desc, r.id);
    ok++;
    console.log(`  ✓ ${r.id.slice(0,8)} ${desc.length}c | ${r.q}`);
  } catch (e) {
    fail++;
    console.log(`  ✗ ${r.id.slice(0,8)} ${e.message?.slice(0,80)}`);
  }
}
console.log(`done: ${ok} backfilled, ${fail} failed`);
