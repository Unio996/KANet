// 议 5 部分 (J2 超 30min 自决自接, J1 留 Trader-A + lint R13):
// 给 broker/service relay 清掉 banned category active skills (social/contacts/other).
// 逻辑跟 api/skills.js _checkBrokerSkillCompat 一致 — enforcement 拒新 active, 此脚本清旧.
//
// 用法:
//   node scripts/reset-trader-skills.mjs [--dry-run] [--apply-to-trader-a]
//
// 默认只动 broker/service relay (is_dex_broker=1 OR is_service=1).
// --apply-to-trader-a: 给 Trader-A 临时加 is_dex_broker=1 + 跑同样 reset (留 J1 议 5 决定).

import Database from 'better-sqlite3';

const DRY_RUN = process.argv.includes('--dry-run');
const APPLY_TRADER_A = process.argv.includes('--apply-to-trader-a');

const BROKER_BANNED_CATEGORIES = ['social', 'contacts', 'other'];

const db = new Database('data/console.db');

console.log(DRY_RUN ? '=== DRY RUN ===\n' : '=== APPLYING ===\n');

// 1. 找所有 broker/service relay
let brokerRelays = db.prepare(`SELECT id, name, is_dex_broker, is_service FROM relay_nodes WHERE is_dex_broker=1 OR is_service=1`).all();

if (APPLY_TRADER_A) {
  const traderA = db.prepare(`SELECT id, name FROM relay_nodes WHERE name='Trader-A'`).get();
  if (traderA && !brokerRelays.find(r => r.id === traderA.id)) {
    if (!DRY_RUN) {
      db.prepare(`UPDATE relay_nodes SET is_dex_broker=1, updated_at=datetime('now') WHERE id=?`).run(traderA.id);
      console.log(`✓ Trader-A is_dex_broker=1 set`);
    } else {
      console.log(`→ Trader-A 会被设 is_dex_broker=1`);
    }
    brokerRelays.push({ ...traderA, is_dex_broker: 1, is_service: 0 });
  }
}

console.log(`\n## broker/service relays (${brokerRelays.length}):`);
for (const r of brokerRelays) console.log(`  ${r.name.padEnd(12)} broker=${r.is_dex_broker} service=${r.is_service} id=${r.id.slice(0,8)}`);

// 2. 给每个找出 banned active skills + disable
let totalDisabled = 0;
const stmt = db.prepare(`UPDATE skills SET status='disabled', updated_at=datetime('now') WHERE id=?`);

for (const relay of brokerRelays) {
  const banned = db.prepare(`
    SELECT id, name, category, status FROM skills
    WHERE relay_node_id=? AND status='active'
      AND category IN (${BROKER_BANNED_CATEGORIES.map(()=>'?').join(',')})
  `).all(relay.id, ...BROKER_BANNED_CATEGORIES);

  if (banned.length === 0) {
    console.log(`\n## ${relay.name} — no banned active skills ✓`);
    continue;
  }

  console.log(`\n## ${relay.name} banned active skills (${banned.length}):`);
  for (const s of banned) {
    if (DRY_RUN) {
      console.log(`  → ${s.name.padEnd(28)} ${s.category.padEnd(11)} disable`);
    } else {
      stmt.run(s.id);
      console.log(`  ✓ ${s.name.padEnd(28)} ${s.category.padEnd(11)} disabled`);
      totalDisabled++;
    }
  }
}

if (!DRY_RUN) {
  console.log(`\n=== ${totalDisabled} skill(s) disabled ===`);
  // 验状态
  for (const relay of brokerRelays) {
    const remaining = db.prepare(`SELECT name, category FROM skills WHERE relay_node_id=? AND status='active' ORDER BY category, name`).all(relay.id);
    console.log(`\n## ${relay.name} active after reset (${remaining.length}):`);
    for (const s of remaining) console.log(`  - ${s.category.padEnd(11)} ${s.name}`);
  }
}

db.close();
