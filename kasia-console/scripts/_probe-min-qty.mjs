// J2 测试 5: 买 0.05 KAS 边界 (< FEE_KAS / dust)
// 不调 finalizeBuy 全链路, 只用 publish API probe broker_dynamic_quote 路径会不会接
// BROKER_RELAY_ID 取自 broker-buy-handler.js:1-30 (Trader-B)
import Database from 'better-sqlite3';
const db = new Database('./data/console.db', { readonly: true });
const broker = db.prepare(`SELECT id, address FROM relay_nodes WHERE name='Trader-B'`).get();
const wallet = db.prepare(`SELECT chain, address FROM agent_wallets WHERE relay_node_id=? AND chain='bnb' AND is_default=1`).get(broker.id);
db.close();
console.log('broker relay id:', broker.id, 'address:', broker.address);
console.log('broker bnb wallet:', wallet?.address);

const cases = [
  { tag: '5a 0.05 KAS', qty: '0.05',  want: '0.0017' },
  { tag: '5b 0.2  KAS', qty: '0.2',   want: '0.0068' },
  { tag: '5c 1.0  KAS (control)', qty: '1.0', want: '0.0339' },
  { tag: '6  10000 KAS (库存超?)', qty: '10000', want: '339' },
];

for (const c of cases) {
  const body = {
    relayNodeId: broker.id,
    give_asset: 'KAS',
    give_amount: c.qty,
    want_asset: 'USDT',
    want_amount: c.want,
    verification: 'cross_chain_tx',
    verification_meta: { accepted_chains: [{ chain: 'bnb', address: wallet.address }], expected_asset: 'USDT' },
    expires_minutes: 30,
    metadata: { source: 'broker_dynamic_quote_PROBE_J2', probe: true },
  };
  try {
    const r = await fetch('http://127.0.0.1:3100/api/exchange/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    console.log(`[${c.tag}] HTTP ${r.status}`, JSON.stringify(data).slice(0, 240));
    // Cancel immediately if accepted to avoid leaks
    if (data.ok && data.offer_id) {
      const cr = await fetch('http://127.0.0.1:3100/api/exchange/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relayNodeId: broker.id, offer_id: data.offer_id, reason: 'PROBE_J2_cleanup' }),
      });
      const cd = await cr.json().catch(() => ({}));
      console.log(`   ↳ cancel ${cr.status}`, JSON.stringify(cd).slice(0, 200));
    }
  } catch (e) {
    console.log(`[${c.tag}] EXC`, e.message);
  }
}
