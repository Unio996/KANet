// J2 真测 36087428d wire fix — 智能体扮真人 (Owner 19:35 钦定)
// 不烧 USDT 阶段, 验 accept_v1 broadcast 后 wire fix 是否真触发 handleExchangeAccept
// 通过 = exchange_offers.protocol_status='matched'/'verifying' + taker=J2_ADDR
// 失败 = 卡 'open' + taker=null (跟 Owner 14:02 a34701fe 同模式)

import Db from 'better-sqlite3';
const db = new Db('data/console.db', { readonly: true });

const J2_RELAY = 'c9c37c37-9a8c-484c-9893-20185d97ccf9';
const J2_ADDR = 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtpqqqe78fjev3';
const BROKER_ADDR = 'kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l';

const QTY = 5;
const PAY_CHAIN = 'BSC';
const TAG = Date.now().toString(36).slice(-5);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function dm(message) {
  const res = await fetch(`http://127.0.0.1:3100/api/relay/${J2_RELAY}/send-command`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'send_message', target: BROKER_ADDR, message }),
  });
  return res.json();
}

async function pollBrokerReply(sinceIso, timeoutMs) {
  const tb = db.prepare(`SELECT id FROM identities WHERE display_name='Trader-A' OR display_name='Trader-B' ORDER BY id LIMIT 1`).get();
  const j2 = db.prepare(`SELECT id FROM identities WHERE address=?`).get(J2_ADDR);
  if (!tb || !j2) { console.log(`  identity lookup fail tb=${!!tb} j2=${!!j2}`); return null; }
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = db.prepare(`
      SELECT content_text, created_at FROM messages
      WHERE sender_identity_id=? AND receiver_identity_id=? AND created_at > ?
      ORDER BY created_at DESC LIMIT 1
    `).get(tb.id, j2.id, sinceIso);
    if (r) return r;
    await sleep(2500);
  }
  return null;
}

console.log(`=== J2 真测 36087428d wire fix (智能体扮真人, tag=${TAG}) ===`);
console.log(`master HEAD verified: 36087428d (NWT wire fix)`);
console.log(`console PID 8024 start 21:54:38 = AFTER ship 21:38:33 ✓`);
console.log(`J2_ADDR = ${J2_ADDR}`);
console.log(`broker = ${BROKER_ADDR}\n`);

async function turn(label, message, expectRe, timeoutMs) {
  await sleep(2000);
  const sinceIso = new Date().toISOString();
  console.log(`\n--- ${label}: DM "${message}" ---`);
  const r = await dm(message);
  if (!r.ok || !r.txId) { console.log(`  ✗ DM fail: ${JSON.stringify(r)}`); return null; }
  console.log(`  ✓ DM 真上链 tx ${r.txId.slice(0,12)}...`);
  console.log(`  ⏳ 等 broker reply (max ${timeoutMs/1000}s)...`);
  const reply = await pollBrokerReply(sinceIso, timeoutMs);
  if (!reply) { console.log(`  ✗ broker timeout`); return null; }
  const t = (reply.content_text || '').replace(/\s+/g, ' ');
  console.log(`  ✓ broker: "${t.slice(0, 240)}"`);
  if (expectRe && !expectRe.test(t)) console.log(`  ⚠ 不含期望关键字 ${expectRe}`);
  return t;
}

// Step 1
const t1 = await turn('Step 1', `想买 ${QTY} 个 KAS ${TAG}`, /链|chain|BSC|Polygon/i, 60000);
if (!t1) process.exit(1);

// Step 2: 如 broker 问 chain, 给 BSC
const t2 = await turn('Step 2 (chain)', `BSC ${TAG}`, /画像|订单|确认|YES|总额|单价|address|地址/i, 90000);
if (!t2) process.exit(1);

// Step 3: YES 确认 (真触发 finalizeBuy → publish + accept_v1 broadcast → wire fix)
const t3 = await turn('Step 3 (YES)', `YES ${TAG}`, /已下单|已确认|tx|创建|订单|验证|verifying|matched/i, 120000);

// Step 3: 验 wire fix 真生效
await sleep(5000);
console.log(`\n--- Step 3: 验 36087428d wire fix 真生效 ---`);
const offers = db.prepare(`
  SELECT id, maker, taker, protocol_status, give_asset, give_amount, want_asset, want_amount,
         broadcast_at, matched_at, taker_chain
  FROM exchange_offers
  WHERE maker = ? AND broadcast_at > datetime('now', '-10 minutes')
  ORDER BY broadcast_at DESC LIMIT 5
`).all(BROKER_ADDR);

console.log(`  broker 近 10min publish offers: ${offers.length}`);
let pass = false;
for (const o of offers) {
  const isJ2Taker = o.taker === J2_ADDR;
  const wireOk = ['matched', 'verifying', 'delivering', 'completed'].includes(o.protocol_status);
  const stillOpen = o.protocol_status === 'open' && !o.taker;
  console.log(`  - ${o.id.slice(0,8)} ${o.give_amount} ${o.give_asset} → ${o.want_amount} ${o.want_asset}`);
  console.log(`      status=${o.protocol_status} taker=${(o.taker||'null').slice(-12)} matched_at=${o.matched_at || 'null'}`);
  if (isJ2Taker && wireOk) {
    pass = true;
    console.log(`      ✅ WIRE FIX 真生效 (status=${o.protocol_status} taker=J2)`);
  } else if (stillOpen) {
    console.log(`      ❌ WIRE 仍断 (status=open + taker=null, 同 Owner 14:02 a34701fe 卡死模式)`);
  }
}

console.log(`\n=== 结论 ===`);
if (pass) {
  console.log(`✅ 36087428d wire fix 真生效 — broker accept_v1 broadcast 真触发 handleExchangeAccept → machineAccept transition`);
  console.log(`下一步: 三方共识 → 决定是否扩 5 sink wire`);
} else {
  console.log(`❌ 36087428d wire fix 没真生效 — broker offer 卡 'open', 同 14:02 模式`);
  console.log(`下一步: 三方真 dig (J1 query DB / NWT replay / J2 grep code), 不再各自 broadcast RCA`);
}

db.close();
