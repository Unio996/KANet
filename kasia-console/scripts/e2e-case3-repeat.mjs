// e2e-case3-repeat.mjs — J1 case 3: 重复触发 (Owner Bug B 验)
// 验 T-J2-26 finalizeBuy 入口幂等 + T-J1-19n publish-layer idempotency.

import Database from 'better-sqlite3';

const SOPHIE_RELAY_ID = 'a83c4b07-eaf7-4d21-972a-1265e0cdcfcf';
const SOPHIE_ADDR = 'kaspa:qpjjv2uhj22592mq76kqr3v6kjjyu23qugjmh2f7992nn0ykmje4cgx2ktetp';
const args = process.argv.slice(2);
const brokerArg = args.find(a => a.startsWith('--broker-kasia='));
const BROKER_KASIA = brokerArg ? brokerArg.slice(15) : null;
if (!BROKER_KASIA) { console.error('需要 --broker-kasia=kaspa:xxx'); process.exit(2); }

const CONSOLE = 'http://localhost:3100';
const db = new Database('./data/console.db', { readonly: true });
const BROKER_ADDR = BROKER_KASIA;

async function sendMessage(msg) {
  return fetch(`${CONSOLE}/api/relay/${SOPHIE_RELAY_ID}/send-command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ type: 'send_message', target: BROKER_KASIA, message: msg }),
  }).then(r => r.json());
}

async function pollBrokerReply(startTs, timeoutMs = 90_000) {
  const tStart = Date.now();
  while (Date.now() - tStart < timeoutMs) {
    const row = db.prepare(`
      SELECT m.content_text, m.created_at FROM messages m
      LEFT JOIN identities si ON si.id = m.sender_identity_id
      LEFT JOIN identities ri ON ri.id = m.receiver_identity_id
      WHERE m.message_type='text' AND si.address=? AND ri.address=? AND m.direction='inbound' AND m.created_at > ?
      ORDER BY m.created_at DESC LIMIT 1
    `).get(BROKER_KASIA, SOPHIE_ADDR, startTs);
    if (row) return { content: row.content_text, latency: Date.now() - tStart };
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

function countOpenBrokerOffers(qty) {
  const broker = db.prepare("SELECT address FROM relay_nodes WHERE id='0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0'").get();
  if (!broker?.address) return null;
  return db.prepare(`
    SELECT COUNT(*) as c FROM exchange_offers
    WHERE maker = ? AND protocol_status = 'open'
      AND give_asset = 'KAS' AND CAST(give_amount AS REAL) = ?
      AND json_extract(metadata, '$.source') = 'broker_dynamic_quote'
      AND julianday(created_at) > julianday('now', '-5 minutes')
  `).get(broker.address, qty)?.c || 0;
}

console.log('='.repeat(80));
console.log(`Case 3: 重复触发 (Owner Bug B 验, T-J2-26 + T-J1-19n)`);
console.log('='.repeat(80));

// startup cleanup
await sendMessage('NO');
await new Promise(r => setTimeout(r, 5000));

let pass = 0, fail = 0;
const failures = [];

// Test 1: 同 peer 5min 内连发 2 次 "买 X KAS" → broker 应复用 quote 不重 publish
console.log('\n[T1] 连发 2x "买 7 KAS" (5min 内, 不同 qty 每次)');
const beforeT1 = countOpenBrokerOffers(7);
console.log(`  before: ${beforeT1} open broker_dynamic 7 KAS offer`);
let ts1 = new Date().toISOString();
await sendMessage('买 7 KAS');
const r1a = await pollBrokerReply(ts1, 30_000);
console.log(`  reply 1: "${r1a?.content?.slice(0, 80)}"`);
await new Promise(r => setTimeout(r, 3000));
let ts2 = new Date().toISOString();
await sendMessage('买 7 KAS');
const r1b = await pollBrokerReply(ts2, 30_000);
console.log(`  reply 2: "${r1b?.content?.slice(0, 80)}"`);
const afterT1 = countOpenBrokerOffers(7);
console.log(`  after:  ${afterT1} open broker_dynamic 7 KAS offer`);
const t1Ok = afterT1 - beforeT1 <= 1;  // 应该至多多 1 个 (publish-layer idempotency 复用)
console.log(t1Ok ? `  ✓ T1 PASS (delta ${afterT1 - beforeT1})` : `  ✗ T1 FAIL (delta ${afterT1 - beforeT1}, expect ≤ 1)`);
if (t1Ok) pass++; else { fail++; failures.push({ name: 'T1 same-qty repeat', delta: afterT1 - beforeT1 }); }

await new Promise(r => setTimeout(r, 3000));

// Test 2: 同 peer 已有 _pendingAccepts 后再发 "买 X KAS" → broker 应识别现有 quote 不创新
console.log('\n[T2] 发 "买 8 KAS" + "BSC" + "YES" 进 _pendingAccepts 后, 再发 "买 8 KAS"');
ts1 = new Date().toISOString();
await sendMessage('买 8 KAS');
await new Promise(r => setTimeout(r, 8000));
await sendMessage('BSC');
await new Promise(r => setTimeout(r, 8000));
await sendMessage('YES');
await new Promise(r => setTimeout(r, 8000));
console.log(`  setup done, _pendingAccepts should be set`);
ts2 = new Date().toISOString();
await sendMessage('买 8 KAS');
const r2 = await pollBrokerReply(ts2, 30_000);
console.log(`  repeat reply: "${r2?.content?.slice(0, 100)}"`);
// broker 应识别已有 pending, 提示用户而非新 quote
const t2Ok = r2 && (r2.content.includes('已') || r2.content.includes('pending') || r2.content.includes('订单') || r2.content.includes('支付') || r2.content.includes('付款'));
console.log(t2Ok ? '  ✓ T2 PASS' : '  ✗ T2 FAIL (broker 没识别 pending state)');
if (t2Ok) pass++; else { fail++; failures.push({ name: 'T2 in-pending repeat', reply: r2?.content?.slice(0,80) }); }

await new Promise(r => setTimeout(r, 3000));
await sendMessage('NO');  // cleanup

await new Promise(r => setTimeout(r, 5000));

// Test 3: 多次 YES (已在 _pendingAccepts) → 不应重复 finalize_order
console.log('\n[T3] 进 quote → 连发 3 次 YES (理论上只第 1 次 confirm)');
ts1 = new Date().toISOString();
await sendMessage('买 9 KAS');
await new Promise(r => setTimeout(r, 8000));
await sendMessage('YES');
await new Promise(r => setTimeout(r, 8000));
await sendMessage('YES');
await new Promise(r => setTimeout(r, 5000));
ts2 = new Date().toISOString();
await sendMessage('YES');
const r3 = await pollBrokerReply(ts2, 30_000);
console.log(`  3rd YES reply: "${r3?.content?.slice(0, 100)}"`);
// 第 3 次 YES 应有 graceful response (不 throw, 不 silent), 不重复 publish
const after9 = countOpenBrokerOffers(9);
const t3Ok = after9 <= 1;
console.log(t3Ok ? `  ✓ T3 PASS (after 3 YES, ${after9} open 9 KAS offer)` : `  ✗ T3 FAIL (${after9} open 9 KAS offer, expect ≤ 1)`);
if (t3Ok) pass++; else { fail++; failures.push({ name: 'T3 repeat YES', after: after9 }); }

await new Promise(r => setTimeout(r, 3000));
await sendMessage('NO');

console.log('\n' + '='.repeat(80));
console.log(`Result: ${pass}/${pass+fail} PASS (${(100*pass/(pass+fail)).toFixed(1)}%)`);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log(' ', f);
}
console.log('='.repeat(80));
process.exit(fail === 0 ? 0 : 1);
