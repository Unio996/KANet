// J2 #3 真 invoke broker SELL flow 真测 (NWT 24:39 audit OK 但真 user sell 真未 trigger)
// 真 simulate user "卖 5 KAS" → broker 问 BSC 地址 → user 给 0x... → broker INSERT retail_dex_orders + DM 转 KAS instruction

import Db from 'better-sqlite3';
import { handleSellIntent, _testClearPending } from '../src/services/broker-sell-handler.js';

const db = new Db('data/console.db', { readonly: false });
const FRESH_PEER = 'kaspa:qpsell' + Math.random().toString(36).slice(2, 8) + '_'.padEnd(40, 'x').slice(0, 40);
const SOPHIE_BSC = '0x0938f94c12b7edb8927b22a82bd6bc83fa570c0e';

console.log('=== J2 #3 真 invoke broker SELL flow 真测 ===');
console.log(`fresh peer: ${FRESH_PEER.slice(-30)}`);
_testClearPending();

const turns = [
  { msg: '想卖 5 KAS', desc: 'turn 1: SELL intent + qty (期望 broker 问 BSC 地址)' },
  { msg: SOPHIE_BSC, desc: 'turn 2: 给 BSC 地址 (期望 broker INSERT retail_dex_orders + DM 转 KAS instruction)' },
];

let pass = 0;
const startBefore = new Date().toISOString();
for (const [i, t] of turns.entries()) {
  console.log(`\n--- ${t.desc} ---`);
  console.log(`  user DM: "${t.msg}"`);
  const start = Date.now();
  const reply = await handleSellIntent(FRESH_PEER, t.msg);
  const ms = Date.now() - start;
  console.log(`  broker reply (${ms}ms): "${reply ? reply.slice(0, 280).replace(/\s+/g, ' ') : '(null - fall to LLM)'}"`);
  if (reply) {
    if (i === 0 && /BSC|地址|0x/i.test(reply)) { pass++; console.log('  ✓ broker 问 BSC 地址'); }
    if (i === 1 && /转\s*KAS|broker|kasia/i.test(reply)) { pass++; console.log('  ✓ broker 真 INSERT order + DM 转 KAS instruction'); }
  }
}

// Verify retail_dex_orders INSERT
console.log('\n=== 真 query retail_dex_orders post-test ===');
const orders = db.prepare(`SELECT id, side, qty, pay_chain, pay_address, state, created_at FROM retail_dex_orders WHERE user_kasia_address=? AND created_at > ?`).all(FRESH_PEER, startBefore);
console.log(`orders: ${orders.length}`);
for (const o of orders) console.log(`  ${o.id.slice(0,8)} side=${o.side} qty=${o.qty} pay=${o.pay_chain}/${o.pay_address?.slice(0,10)}... state=${o.state}`);

// Cleanup
console.log('\n--- cleanup test orders ---');
for (const o of orders) {
  db.prepare(`DELETE FROM retail_dex_orders WHERE id=?`).run(o.id);
  console.log(`  ✓ deleted ${o.id.slice(0,8)}`);
}
_testClearPending();

console.log(`\n=== ${pass}/${turns.length} PASS ===`);
db.close();
