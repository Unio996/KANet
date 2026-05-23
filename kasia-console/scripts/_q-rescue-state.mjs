// 救 Owner 1.88 USDT — 查所有 3 个 55 KAS open offer + broker accept_v1 状态 + Owner 地址 + broker KAS 库存
import Database from 'better-sqlite3';
const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });

// Owner Kasia 地址 (从 messages 表 sender)
const owner = db.prepare(`SELECT id, address, display_name FROM identities WHERE address LIKE 'kaspa:%nurgcqs3s588'`).get();
console.log('## Owner identity:');
console.log(JSON.stringify(owner, null, 2));

// Trader-B identity
const TraderB = db.prepare(`SELECT id, address, display_name FROM identities WHERE display_name='Trader-B'`).get();
console.log('\n## Trader-B identity:');
console.log(JSON.stringify(TraderB, null, 2));

// Trader-B relay (broker relay)
const brokerRelay = db.prepare(`SELECT id, name, address, adapter_node_id FROM relay_nodes WHERE address=?`).get(TraderB.address);
console.log('\n## broker relay node:');
console.log(JSON.stringify(brokerRelay, null, 2));

// 3 个 55 KAS open offers
const offers = db.prepare(`
  SELECT id, give_amount, want_amount, maker, taker, protocol_status, taker_payment_address, payment_tx, delivery_tx, created_at, broadcast_tx_id
  FROM exchange_offers
  WHERE give_amount='55' AND created_at > datetime('now','-1 hour')
  ORDER BY created_at DESC
`).all();
console.log('\n## 3 个 55 KAS offers:');
for (const o of offers) console.log(JSON.stringify(o));

// chain_events broker_accept_record (broker 发 accept_v1 的记录)
const accepts = db.prepare(`
  SELECT * FROM chain_events
  WHERE event_type='broker_accept_record' AND observed_at > datetime('now','-1 hour')
  ORDER BY observed_at DESC LIMIT 10
`).all();
console.log(`\n## broker_accept_record (last 1h, ${accepts.length}):`);
for (const a of accepts) {
  let pl;
  try { pl = JSON.parse(a.payload); } catch { pl = a.payload?.slice(0,100); }
  console.log(`  txid=${a.txid?.slice(0,30)} obs=${a.observed_at?.slice(11,19)} payload=${JSON.stringify(pl).slice(0,200)}`);
}

// fund_locks 状态
const locks = db.prepare(`
  SELECT * FROM fund_locks WHERE created_at > datetime('now','-1 hour')
`).all();
console.log(`\n## fund_locks (last 1h, ${locks.length}):`);
for (const l of locks) console.log(JSON.stringify(l).slice(0,300));

// Trader-B KAS balance
const balRow = db.prepare(`SELECT * FROM address_balances WHERE address=?`).get(TraderB.address);
console.log('\n## Trader-B KAS balance:');
console.log(JSON.stringify(balRow, null, 2));

// pending_actions for accept_v1 (broker enqueue 状态)
const acts = db.prepare(`
  SELECT * FROM pending_actions
  WHERE created_at > datetime('now','-1 hour')
  ORDER BY created_at DESC LIMIT 20
`).all();
console.log(`\n## pending_actions (last 1h, ${acts.length}):`);
for (const a of acts) {
  console.log(`  ${a.created_at?.slice(11,19)} ${a.action_type} ${a.status} retry=${a.retry_count} target=${a.target_address?.slice(-12)} err=${(a.error||'').slice(0,80)}`);
}

db.close();
