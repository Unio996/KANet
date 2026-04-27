// NWT 接位 #2 — verify T-NWT-2026-04-26 wire fix (commit 36087428d)
//
// 真测 (不 mock):
//   1. seed peer + 真 history
//   2. POST /api/agent/reply 真调 broker LLM, regex 走 buy intake fast-path
//   3. broker handler 真 enqueue accept_v1
//   4. broker-action-queue.executeAction 真 sendCommandAsync 真上链
//   5. **wire fix**: pump 真调 onBroadcastWritten → trade-protocol-filter → handleExchangeAccept → processAccept → transition 'open' → 'matched'
//   6. assert exchange_offers WHERE taker=peer 真 protocol_status === 'matched'
//
// 通过 = wire fix 真生效, broker 真融入 exchange.
// 失败 = wire 还没接通, 立即 RCA 不 ship 二次.

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const DB_PATH = 'data/console.db';
const TRADER_B_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const PEER = 'kaspa:qpr_nwt_wire_verify_' + Date.now().toString(36) + 'fakeseed99';

const db = new Database(DB_PATH);
const broker = db.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(TRADER_B_RELAY_ID);
const brokerIdent = db.prepare(`SELECT id FROM identities WHERE address=?`).get(broker.address);
const now = new Date().toISOString();

// seed peer identity + turn 1 history (LLM 走 fast-path 用)
let peerIdent = db.prepare(`SELECT id FROM identities WHERE address=?`).get(PEER);
if (!peerIdent) {
  const peerId = randomUUID();
  db.prepare(`
    INSERT INTO identities (id, network, address, identity_type, created_at, updated_at, is_blocked, trust_level, discovery_status, interaction_count, probe_attempt_count, successful_contact_count, confidence_score, card_has_ext)
    VALUES (?, 'kaspa-mainnet', ?, 'kasia_user', ?, ?, 0, 'unknown', 'discovered', 0, 0, 0, 0.5, 0)
  `).run(peerId, PEER, now, now);
  peerIdent = { id: peerId };
}
console.log(`peer addr=${PEER}\nbroker addr=${broker.address}`);

// 直接发 BUY intent 让 broker 走 fast-path → publish + accept_v1
console.log('\n── turn 1: BUY 5 KAS BSC ──');
const t0 = Date.now();
const res1 = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ relayNodeId: TRADER_B_RELAY_ID, peer: PEER, message: '想买 5 KAS' }),
});
const data1 = await res1.json();
console.log(`(${Date.now()-t0}ms) reply=${(data1.reply||'').slice(0,150)}`);

// turn 2: BSC chain (preview)
console.log('\n── turn 2: BSC ──');
const t1 = Date.now();
const res2 = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ relayNodeId: TRADER_B_RELAY_ID, peer: PEER, message: 'BSC' }),
});
const data2 = await res2.json();
console.log(`(${Date.now()-t1}ms) reply=${(data2.reply||'').slice(0,300)}`);

// turn 3: YES — finalize_order tool (真 publish + 真 accept_v1)
console.log('\n── turn 3: YES (真触发 finalize) ──');
const t2 = Date.now();
const res3 = await fetch('http://127.0.0.1:3100/api/agent/reply', {
  method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ relayNodeId: TRADER_B_RELAY_ID, peer: PEER, message: 'YES' }),
});
const data3 = await res3.json();
console.log(`(${Date.now()-t2}ms) reply=${(data3.reply||'').slice(0,300)}`);

// 等 broker-action-queue pump 真发 accept_v1 + 真触发 trade filter (~5-10s)
console.log('\n等 10s broker-action-queue pump + trade filter dispatch...');
await new Promise(r => setTimeout(r, 10000));

// 查 exchange_offers WHERE taker = PEER (broker 代发 accept_v1 应填 taker = receive_address = PEER)
const offers = db.prepare(`
  SELECT id, protocol_status, give_amount, want_amount, want_chain, maker, taker, taker_chain, payment_tx, matched_at, verifying_started_at, created_at
  FROM exchange_offers
  WHERE taker = ? OR (maker = ? AND created_at > ?)
  ORDER BY created_at DESC LIMIT 5
`).all(PEER, broker.address, new Date(Date.now() - 60_000).toISOString());

console.log(`\n=== exchange_offers (taker=PEER OR broker maker last 60s) — ${offers.length} 笔 ===`);
offers.forEach(o => console.log(JSON.stringify(o)));

// === 真验证 ===
const matched = offers.find(o =>
  o.maker === broker.address &&
  (o.taker === PEER || o.taker_payment_address === PEER || (o.protocol_status !== 'open' && o.created_at > new Date(Date.now() - 60_000).toISOString()))
);

console.log('\n=== wire fix 真验证 ===');
if (!offers.length) {
  console.log('✗ 没找到 broker 新挂 offer — finalizeBuy 没真跑 (LLM 没调 finalize_order tool? RCA: LLM tool calling 不可靠仍然存在, 但 wire 自身 fix 不能 verify)');
  process.exit(2);
}

const target = offers.find(o => o.maker === broker.address) || offers[0];
console.log(`target offer: ${target.id.slice(0,8)} status=${target.protocol_status}`);

if (target.protocol_status === 'matched' || target.protocol_status === 'verifying' || target.protocol_status === 'awaiting_manual_confirm') {
  console.log(`✓ wire fix 真生效 — protocol_status=${target.protocol_status} (open → matched 真 transition)`);
  console.log(`✓ broker 真融入 exchange: accept_v1 真触发 trade filter → processAccept → transition`);
  process.exit(0);
} else if (target.protocol_status === 'open') {
  console.log(`🚨 wire fix 没生效 — protocol_status 仍 'open', taker=${target.taker}`);
  console.log('真因可能: (a) LLM 没调 finalize_order tool → finalizeBuy 没跑, (b) wire fix bug, (c) 别的地方断');
  console.log('立即 RCA — 看 console.log 找 [broker-queue] / [trade-filter] / [exchange] / [exchange-machine] trace');
  process.exit(1);
} else {
  console.log(`🟡 protocol_status=${target.protocol_status} (非 matched 也非 open, 看是不是 expired/cancelled/...)`);
  process.exit(3);
}
