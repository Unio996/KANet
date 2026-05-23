// J2 测试 14b: broker_dynamic_quote 自然 timeout → fund_lock release
// 用 expires_minutes=2 短测, 不让 Owner 等 30min
import Database from 'better-sqlite3';
const db = new Database('./data/console.db', { readonly: true });
const broker = db.prepare(`SELECT id, address FROM relay_nodes WHERE name='Trader-B'`).get();
const wallet = db.prepare(`SELECT chain, address FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' AND is_default=1`).get(broker.id);
db.close();
console.log('broker:', broker.id, broker.address);
console.log('wallet:', wallet.address);

const body = {
  relayNodeId: broker.id,
  give_asset: 'KAS',
  give_amount: '1.5',
  want_asset: 'USDT',
  want_amount: '0.0510',
  verification: 'cross_chain_tx',
  verification_meta: { accepted_chains: [{ chain: 'bnb', address: wallet.address }], expected_asset: 'USDT' },
  expires_minutes: 2,
  metadata: { source: 'broker_dynamic_quote', mid_price: 0.034, spread_pct: 1, j2_test: '14b' },
};

const r = await fetch('http://127.0.0.1:3100/api/exchange/publish', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const data = await r.json();
console.log('publish:', r.status, data);
if (!data.ok) process.exit(1);

const offerId = data.offer_id;
console.log('\n14b watch starts. offer:', offerId);
console.log('expected timeout ~2min from broadcast.');
console.log('we\'ll poll DB every 30s for status + fund_lock');

const pollOnce = (label) => {
  const db2 = new Database('./data/console.db', { readonly: true });
  const o = db2.prepare(`SELECT id, protocol_status, cancelled_at, timed_out_at, expires_at FROM exchange_offers WHERE id=?`).get(offerId);
  const l = db2.prepare(`SELECT id, status, released_at FROM fund_locks WHERE order_id=?`).get(offerId);
  db2.close();
  console.log(`[${label}] offer.status=${o?.protocol_status} expires_at=${o?.expires_at?.slice(11,19)} cancelled_at=${o?.cancelled_at?.slice(11,19)||'-'} timed_out_at=${o?.timed_out_at?.slice(11,19)||'-'}  lock.status=${l?.status||'-'} released_at=${l?.released_at?.slice(11,19)||'-'}`);
  return { o, l };
};

pollOnce('t=0s');
await new Promise(r => setTimeout(r, 30_000));
pollOnce('t=30s');
await new Promise(r => setTimeout(r, 30_000));
pollOnce('t=60s');
await new Promise(r => setTimeout(r, 30_000));
pollOnce('t=90s');
await new Promise(r => setTimeout(r, 30_000));
pollOnce('t=120s (expected expire)');
await new Promise(r => setTimeout(r, 30_000));
pollOnce('t=150s');
await new Promise(r => setTimeout(r, 30_000));
const final = pollOnce('t=180s (final)');

console.log('\n=== verdict ===');
if (final.o.protocol_status === 'expired' && final.l?.status === 'released') {
  console.log('✓ 14b PASS (expire path triggers fund_lock release)');
} else if (final.o.protocol_status === 'expired' && final.l?.status !== 'released') {
  console.log('✗ 14b FAIL — offer expired but fund_lock NOT released, leak risk');
} else {
  console.log('🟡 14b INCONCLUSIVE — offer not expired yet:', final.o.protocol_status);
}
process.exit(0);
