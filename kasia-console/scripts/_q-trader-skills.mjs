import Database from 'better-sqlite3';
const db = new Database('data/console.db', { readonly: true });

const traders = db.prepare(`SELECT id, name, is_dex_broker, is_service, is_bot_autoreply FROM relay_nodes WHERE name LIKE 'Trader%' OR is_dex_broker=1 OR is_service=1`).all();
console.log('## broker/service relays:');
for (const r of traders) console.log(`  ${r.name.padEnd(12)} broker=${r.is_dex_broker} service=${r.is_service} autoreply=${r.is_bot_autoreply} id=${r.id.slice(0,8)}`);

for (const r of traders) {
  const skills = db.prepare(`SELECT name, display_name, category, status FROM skills WHERE relay_node_id=? AND status='active' ORDER BY category, name`).all(r.id);
  console.log(`\n## ${r.name} active skills (${skills.length}):`);
  for (const s of skills) console.log(`  - ${(s.category || '?').padEnd(10)} ${s.name.padEnd(25)} ${s.display_name}`);
}

// Also list all active skills, group by category, count
const all = db.prepare(`SELECT category, COUNT(*) as n FROM skills WHERE status='active' GROUP BY category ORDER BY n DESC`).all();
console.log(`\n## All active skill categories (totals):`);
for (const c of all) console.log(`  ${(c.category || 'null').padEnd(15)} ${c.n}`);

db.close();
