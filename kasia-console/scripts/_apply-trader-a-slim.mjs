// Owner 19:18 钦定 "好" — Trader-A 瘦身到推荐 broker set (29 → 10).
// J2 提议 + Owner 拍板. 一次性执行. (脚本保留作记录, 不重复跑.)

import Database from 'better-sqlite3';

const KEEP = new Set([
  // 核心交易 (5)
  'price_tracker', 'trade_executor', 'market_scanner', 'mm_otc', 'cross_chain_verify',
  // 情报辅助 (2)
  'address_profiler', 'kaspa_network_health',
  // 感知 (1)
  'trade_sense',
  // self/core (2)
  'self_awareness', 'system_status',
]);

const db = new Database('data/console.db');

const ta = db.prepare(`SELECT id FROM relay_nodes WHERE name='Trader-A'`).get();
console.log('Trader-A id:', ta.id.slice(0,8));

const before = db.prepare(`SELECT name, status FROM skills WHERE relay_node_id=? AND status='active'`).all(ta.id);
console.log(`Before: ${before.length} active`);

const now = new Date().toISOString();
const stmt = db.prepare(`UPDATE skills SET status='disabled', updated_at=? WHERE relay_node_id=? AND name=? AND status='active'`);

let disabled = 0;
for (const s of before) {
  if (!KEEP.has(s.name)) {
    stmt.run(now, ta.id, s.name);
    console.log(`  ✗ disable ${s.name}`);
    disabled++;
  }
}

const after = db.prepare(`SELECT name, category FROM skills WHERE relay_node_id=? AND status='active' ORDER BY category, name`).all(ta.id);
console.log(`\nAfter: ${after.length} active (${disabled} disabled)`);
for (const s of after) console.log(`  ✓ ${s.category.padEnd(11)} ${s.name}`);

db.close();
