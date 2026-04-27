import Database from 'better-sqlite3';
const db = new Database('C:/kanet/kasia-console/data/console.db', { readonly: true });

// 找 Owner 最新 45 KAS offer
const offers = db.prepare(`
  SELECT id, give_amount, want_amount, maker, taker, protocol_status, created_at
  FROM exchange_offers
  WHERE give_amount='45' AND created_at > datetime('now','-2 hours')
  ORDER BY created_at DESC LIMIT 5
`).all();
console.log('## 45 KAS offers last 2h:');
for (const o of offers) console.log(JSON.stringify(o));

// 也看 broker 最近所有 broker_dynamic_quote open
const recent = db.prepare(`
  SELECT id, give_amount, want_amount, protocol_status, created_at
  FROM exchange_offers
  WHERE maker='kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l'
    AND protocol_status='open' AND created_at > datetime('now','-2 hours')
  ORDER BY created_at DESC LIMIT 10
`).all();
console.log(`\n## broker open offers last 2h (${recent.length}):`);
for (const o of recent) console.log(JSON.stringify(o));

// fund_locks 状态
const locks = db.prepare(`
  SELECT order_id, asset, amount, status FROM fund_locks
  WHERE status='locked' AND created_at > datetime('now','-2 hours')
`).all();
console.log(`\n## active fund_locks last 2h:`);
for (const l of locks) console.log(JSON.stringify(l));

db.close();
