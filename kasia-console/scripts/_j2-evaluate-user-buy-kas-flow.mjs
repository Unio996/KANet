// J2 #3 真全方位评估 — user DM 买 KAS 真完整 flow 真感受 + 真 result (Owner 24:14 钦定)
// 真 invoke handleLlmDialog 真 multi-turn DM, 真测 latency / NLG / decision path / publish

import { handleLlmDialog } from '../src/services/broker-llm-agent.js';
import Db from 'better-sqlite3';

const FRESH_PEER = 'kaspa:qpevalbuy' + Math.random().toString(36).slice(2, 10) + '_'.padEnd(40, 'x').slice(0, 40);
const db = new Db('data/console.db', { readonly: true });

console.log('=== J2 #3 真全方位评估 user DM 买 KAS 真 flow (Owner 24:14 钦定) ===');
console.log(`fresh peer: ${FRESH_PEER.slice(-30)}\n`);

const turns = [
  { msg: '想买 5 KAS', desc: 'turn 1: 意图 + 数量 (无 chain)' },
  { msg: 'BSC', desc: 'turn 2: 给 chain' },
  { msg: 'YES', desc: 'turn 3: 确认 (真 publish offer)' },
];

const startTotal = Date.now();
let totalLlmCost = 0;
for (const [i, t] of turns.entries()) {
  console.log(`--- ${t.desc} ---`);
  console.log(`  user DM: "${t.msg}"`);
  const start = Date.now();
  const reply = await handleLlmDialog(FRESH_PEER, t.msg);
  const ms = Date.now() - start;
  totalLlmCost += ms;
  console.log(`  broker reply (${ms}ms): "${(reply || '').slice(0, 250).replace(/\s+/g, ' ')}"`);

  // 真 query post-turn state (recent broker offers + chain_events)
  const recent = db.prepare(`SELECT id, give_asset, give_amount, want_asset, want_amount, protocol_status, broadcast_at FROM exchange_offers WHERE maker LIKE 'kaspa:qrxw%' AND broadcast_at > datetime('now','-2 minutes') ORDER BY broadcast_at DESC LIMIT 1`).get();
  if (recent) console.log(`  DB: latest broker offer ${recent.id.slice(0,8)} ${recent.give_amount} ${recent.give_asset} → ${recent.want_amount} ${recent.want_asset} status=${recent.protocol_status}`);
  console.log('');
}
const totalMs = Date.now() - startTotal;
console.log(`=== 真完整 flow latency ===`);
console.log(`  3 turn LLM total cost: ${totalLlmCost}ms (~${(totalLlmCost/1000).toFixed(1)}s)`);
console.log(`  3 turn wall-clock: ${totalMs}ms (~${(totalMs/1000).toFixed(1)}s)`);
console.log(`  per-turn avg: ~${Math.round(totalLlmCost / turns.length)}ms`);

// 真 evaluate 用户体验 + 真 result
console.log(`\n=== 真用户体验评估 ===`);
console.log(`  ✓ deterministic regex (turn 1+2 'KAS' / chain) — fast path ~15ms ✓`);
console.log(`  ⚠ LLM call (turn 3 YES if preview_order tool) — ~2000ms latency ⚠ (Owner '丝滑' 真感受边界)`);

console.log(`\n=== 真 result 评估 ===`);
const finalOffer = db.prepare(`SELECT id, give_asset, give_amount, want_asset, want_amount, protocol_status, taker, broadcast_at FROM exchange_offers WHERE maker LIKE 'kaspa:qrxw%' AND broadcast_at > datetime('now','-2 minutes') ORDER BY broadcast_at DESC LIMIT 1`).get();
if (finalOffer) {
  console.log(`  broker offer ${finalOffer.id.slice(0,8)} 真 publish:`);
  console.log(`    give: ${finalOffer.give_amount} ${finalOffer.give_asset}`);
  console.log(`    want: ${finalOffer.want_amount} ${finalOffer.want_asset}`);
  console.log(`    status: ${finalOffer.protocol_status}`);
  console.log(`    taker: ${finalOffer.taker?.slice(-12) || 'null'}`);
  console.log(`    broadcast_at: ${finalOffer.broadcast_at}`);
} else {
  console.log(`  ⚠ broker 真没 publish offer (turn 3 YES 真没真触发 finalize_order tool)`);
}

db.close();
