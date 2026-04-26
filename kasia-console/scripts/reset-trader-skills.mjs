// reset-trader-skills.mjs — 议 5 (J1, Owner 17:33 钦定 + J2 议案)
// 复位 broker/service relay 的 skill set: 拒 banned category, 默认推荐 trading skill 集.
// 同机 broker (NWT machine) 跑生效. J1 远端只能写脚本不能跑 (broker 不在 J1 db).
//
// 用法:
//   node scripts/reset-trader-skills.mjs --dry-run           # 看会做啥
//   node scripts/reset-trader-skills.mjs                      # 真执行
//   node scripts/reset-trader-skills.mjs --relay-id=<uuid>    # 指定 relay
//
// 默认 BROKER_RELAY_ID (Trader-B). 也可一次清多个 broker/service relay.

import Database from 'better-sqlite3';

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const relayArg = args.find(a => a.startsWith('--relay-id='));
const targetRelayId = relayArg ? relayArg.slice(11) : BROKER_RELAY_ID;

// J2 议 2 BROKER_BANNED_CATEGORIES (社交/联系人/未分类)
const BANNED_CATEGORIES = ['social', 'contacts', 'other'];

// 推荐 trader role default skill set (按 name 匹, 不一定全在该 relay)
const RECOMMENDED_TRADER_SKILLS = [
  'market_scanner', 'price_tracker', 'cross_chain_verify',
  'order_executor', 'trade_executor', 'mm_otc',
  'address_profiler', 'whale_tracker', 'self_awareness',
];

const db = new Database('./data/console.db', { readonly: dryRun });

// 1. 验证 relay 是 broker/service
const relay = db.prepare('SELECT id, name, is_dex_broker, is_service FROM relay_nodes WHERE id = ?').get(targetRelayId);
if (!relay) {
  console.error(`relay ${targetRelayId} 不在 console.db (broker 在 NWT 机, 此脚本必须 NWT 机跑)`);
  process.exit(2);
}
const isBrokerRole = relay.is_dex_broker === 1 || relay.is_service === 1;
if (!isBrokerRole) {
  console.error(`relay ${relay.name} 不是 broker/service (is_dex_broker=${relay.is_dex_broker} is_service=${relay.is_service}). 不复位.`);
  process.exit(2);
}

console.log('='.repeat(72));
console.log(`reset-trader-skills ${dryRun ? '(DRY RUN)' : ''}`);
console.log(`  relay: ${relay.name} ${targetRelayId.slice(0,8)} broker=${relay.is_dex_broker} service=${relay.is_service}`);
console.log(`  banned: ${BANNED_CATEGORIES.join(', ')}`);
console.log(`  recommended: ${RECOMMENDED_TRADER_SKILLS.join(', ')}`);
console.log('='.repeat(72));

// 2. 找当前 active 但 category banned 的 skill (按 J2 议 2 enforcement, 必 disable)
const bannedActive = db.prepare(`
  SELECT id, name, category FROM skills
  WHERE (relay_node_id = ? OR relay_node_id IS NULL)
    AND status = 'active'
    AND category IN (${BANNED_CATEGORIES.map(() => '?').join(',')})
`).all(targetRelayId, ...BANNED_CATEGORIES);
console.log(`\n[1] active banned (要 disable): ${bannedActive.length}`);
for (const s of bannedActive) console.log(`  ✗ ${s.category}/${s.name} (${s.id.slice(0,8)})`);

// 3. 推荐 trader skill 当前状态
const recommended = db.prepare(`
  SELECT id, name, category, status FROM skills
  WHERE (relay_node_id = ? OR relay_node_id IS NULL)
    AND name IN (${RECOMMENDED_TRADER_SKILLS.map(() => '?').join(',')})
`).all(targetRelayId, ...RECOMMENDED_TRADER_SKILLS);
console.log(`\n[2] recommended trader skills 当前状态: ${recommended.length} 找到`);
for (const s of recommended) console.log(`  ${s.status === 'active' ? '✓' : '·'} ${s.category}/${s.name} status=${s.status}`);

if (dryRun) {
  console.log('\nDRY RUN — 不动. 跑真执行: node scripts/reset-trader-skills.mjs');
  process.exit(0);
}

// 4. 真执行: disable banned + activate recommended (frozen / disabled 都激活)
const dbW = new Database('./data/console.db');
const tx = dbW.transaction(() => {
  let disabled = 0, activated = 0;
  for (const s of bannedActive) {
    dbW.prepare("UPDATE skills SET status='disabled', updated_at=datetime('now') WHERE id=?").run(s.id);
    disabled++;
  }
  for (const s of recommended) {
    if (s.status !== 'active') {
      dbW.prepare("UPDATE skills SET status='active', updated_at=datetime('now') WHERE id=?").run(s.id);
      activated++;
    }
  }
  return { disabled, activated };
});
const result = tx();
console.log(`\n✓ 完成: disabled ${result.disabled} banned skill, activated ${result.activated} recommended skill`);
console.log(`  ${relay.name} 现 trader role 默认 skill set 就位`);
process.exit(0);
