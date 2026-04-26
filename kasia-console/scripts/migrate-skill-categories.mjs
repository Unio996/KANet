// 议 0 (Owner 17:33 钦定 skill enforcement 前置): skill.category 数据迁移
//
// 现状: 184 个 active skills 全 category='other', UI skills.eta 9 类分组依赖 category 但 data 没填.
// 这是 enforcement 前置 — broker/trader role 拒装 'social' 类 skill 必须先 category 填对.
//
// 安全: 一次性 SQL UPDATE per skill.name. 不破坏 schema, 不删 skill, 不动 status.
// 已有非 'other' category (e.g. 'contacts' 4 个) 不动.
//
// 用法: node scripts/migrate-skill-categories.mjs [--dry-run]

import Database from 'better-sqlite3';

const DRY_RUN = process.argv.includes('--dry-run');

// skill name → category 映射 (按 docs/DEVELOPER-GUIDE 9 类约定)
const SKILL_CATEGORIES = {
  // core (核心)
  system_status: 'core',

  // perception (感知)
  chain_sense: 'perception',
  trade_sense: 'perception',
  prediction_sense: 'perception',
  code_sense: 'perception',

  // social (社交)
  social_outreach: 'social',

  // trading (交易) — broker/trader role 应该只装这类
  cross_chain_verify: 'trading',
  hyperliquid_manager: 'trading',
  market_scanner: 'trading',
  mm_otc: 'trading',
  multi_market: 'trading',
  onboard_broker: 'trading',
  onboard_market: 'trading',
  onboard_polymarket: 'trading',
  order_executor: 'trading',
  price_tracker: 'trading',
  'retail-proxy': 'trading',
  trade_executor: 'trading',

  // info (信息查询)
  address_profiler: 'info',
  btc_halving_countdown: 'info',
  flight_tracker: 'info',
  kaspa_network_health: 'info',
  news_digest: 'info',
  stock_tracker: 'info',
  web_search: 'info',
  whale_tracker: 'info',

  // dev (开发)
  annotate: 'dev',
  code_review: 'dev',
  mcp_bridge: 'dev',
  test_run: 'dev',
  test_auto_skill: 'dev',
  test_frozen_exec: 'dev',

  // self (自我)
  self_awareness: 'self',

  // contacts (通讯录基础动作)
  block: 'contacts',
  introduce: 'contacts',
  unblock: 'contacts',
};

const db = new Database('data/console.db');

console.log(DRY_RUN ? '=== DRY RUN ===\n' : '=== APPLYING ===\n');

const beforeStats = db.prepare(`SELECT category, COUNT(*) as n FROM skills GROUP BY category ORDER BY n DESC`).all();
console.log('## Before:');
for (const c of beforeStats) console.log(`  ${(c.category || 'null').padEnd(15)} ${c.n}`);

let updated = 0, unmapped = 0;
const distinctNames = db.prepare(`SELECT DISTINCT name FROM skills`).all();
const stmt = db.prepare(`UPDATE skills SET category=?, updated_at=datetime('now') WHERE name=? AND category != ?`);

for (const { name } of distinctNames) {
  // skip frozen_* (legacy graveyard, 全归 'other' 不动)
  if (name.startsWith('frozen_')) continue;
  const cat = SKILL_CATEGORIES[name];
  if (!cat) { unmapped++; console.warn(`  ⚠ unmapped: ${name}`); continue; }
  if (DRY_RUN) {
    const rows = db.prepare(`SELECT COUNT(*) as n FROM skills WHERE name=? AND category != ?`).get(name, cat);
    if (rows.n > 0) console.log(`  → ${name.padEnd(28)} ${cat.padEnd(11)} (${rows.n} row${rows.n>1?'s':''})`);
  } else {
    const r = stmt.run(cat, name, cat);
    if (r.changes > 0) {
      console.log(`  ✓ ${name.padEnd(28)} ${cat.padEnd(11)} (${r.changes} row${r.changes>1?'s':''})`);
      updated += r.changes;
    }
  }
}

if (!DRY_RUN) {
  const afterStats = db.prepare(`SELECT category, COUNT(*) as n FROM skills GROUP BY category ORDER BY n DESC`).all();
  console.log(`\n## After (updated ${updated} rows, ${unmapped} unmapped):`);
  for (const c of afterStats) console.log(`  ${(c.category || 'null').padEnd(15)} ${c.n}`);
}

db.close();
