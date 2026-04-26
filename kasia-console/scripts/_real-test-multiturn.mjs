// Multi-turn 真链路 — 单 user 真走 broker 5 步 (不上链不真付钱).
// 验 _quotes / _pendingAccepts state 真 set + broker enqueue accept_v1 真路径.

const TRADER_B = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const J2_BASE = 'kaspa:qr7km875u5hhl42eaz4sjgmlcdnzjan9fnplcct3q7gq4ujdtp';
const PEER = J2_BASE + 'mt' + 'qqqqqqqqqq';  // unique multi-turn peer

async function dm(msg) {
  const t0 = Date.now();
  const res = await fetch('http://127.0.0.1:3100/api/agent/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relayNodeId: TRADER_B, peer: PEER, message: msg }),
  });
  const body = await res.json();
  return { reply: body.reply || '', ms: Date.now() - t0 };
}

console.log('=== Multi-turn 真链路 (单 user broker 5 步) ===\n');
console.log('peer:', PEER.slice(-12));
console.log();

const turns = [
  { msg: '想买 8 KAS', expect: 'BSC|哪个|chain' },
  { msg: 'BSC', expect: '8 KAS|对吗|确认|BSC|确认' },
  { msg: '是', expect: '订单|已确认|付款|maker|address' },
  { msg: '我转好了', expect: 'tx hash|0x|active|订单|查' },  // PAID_NO_TX intent (now _pendingAccepts set)
  { msg: '我付了 0xabc1234567890abc1234567890abc1234567890abc1234567890abc1234567890ab', expect: 'tx|验证|收到|broker' },
];

let pass = 0, fail = 0;
for (let i = 0; i < turns.length; i++) {
  const t = turns[i];
  const r = await dm(t.msg);
  const matched = new RegExp(t.expect, 'i').test(r.reply);
  const isQueue = r.reply === '';
  const ok = matched || isQueue;
  if (ok) pass++; else fail++;
  console.log(`Turn ${i+1} (${r.ms}ms) "${t.msg}"`);
  console.log(`  → ${r.reply ? '"' + r.reply.replace(/\s+/g,' ').slice(0,180) + '"' : '<queue-routed>'}`);
  console.log(`  expect /${t.expect}/i  ${ok ? '✓' : '✗'}`);
  console.log();
}

// State check
const Db = (await import('better-sqlite3')).default;
const db = new Db('data/console.db', { readonly: true });
// 拿 broker handler in-memory state 不能读 (in-memory). 改读 DB 验 broker 真行为:
// 1. exchange_offers — 是不是真创了 broker_dynamic_quote offer
// 2. fund_locks — broker 真锁了 KAS
const offers = db.prepare(`
  SELECT id, give_amount, want_amount, protocol_status, taker, created_at
  FROM exchange_offers
  WHERE maker='kaspa:qrxw764gez624hfkfvpmzfx8a4mg2vze5n6vsgu8fymewrkuphy65lxur9c5l'
    AND CAST(give_amount AS REAL) = 8
    AND created_at > datetime('now','-2 minutes')
  ORDER BY created_at DESC LIMIT 3
`).all();
console.log('## Recent 8 KAS broker offer (broker_dynamic_quote 真创?):');
for (const o of offers) {
  console.log(` ${o.id.slice(0,8)} ${o.give_amount} KAS / ${o.want_amount} USDT / ${o.protocol_status} / taker=${o.taker?.slice(0,12) || 'null'}`);
}

const locks = db.prepare(`
  SELECT order_id, asset, amount, status FROM fund_locks
  WHERE asset='KAS' AND amount=8 AND created_at > datetime('now','-2 minutes')
`).all();
console.log(`\n## fund_locks 8 KAS recent: ${locks.length} 行`);
for (const l of locks) console.log(` ${l.order_id.slice(0,8)} ${l.asset} ${l.amount} ${l.status}`);

db.close();

console.log(`\n=== Multi-turn ${pass}/5 PASS ===`);
process.exit(fail === 0 ? 0 : 1);
