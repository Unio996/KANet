// smoke-broker-buy-completion.mjs — Phase 4 BUY 闭环 (T-J2-09)
// 模拟 broker_accept_record + completed offer → completionTick → DM 发出 + 防重复

import Database from 'better-sqlite3';
import { randomBytes, randomUUID } from 'crypto';

process.env.DB_PATH = process.env.DB_PATH || 'C:/kanet/kasia-console/data/console.db';
const db = new Database(process.env.DB_PATH);

const BROKER = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';
const brokerAddr = db.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(BROKER)?.address;
if (!brokerAddr) { console.error('no broker'); process.exit(1); }

const sent = [];
const fakeSend = async (relayId, cmd) => {
  sent.push({ relayId, ...cmd });
  return { ok: true, txId: 'smoke_' + randomBytes(8).toString('hex') };
};

const mkPeer = () => 'kaspa:q' + randomBytes(32).toString('hex');

function injectAcceptRecord(offerId, userPeer, qty) {
  db.prepare(`
    INSERT INTO chain_events (txid, from_address, to_address, event_type, payload, observed_by, observed_at)
    VALUES (?, ?, ?, 'broker_accept_record', ?, 'broker-buy-handler', datetime('now'))
  `).run(
    `smoke_accept_${offerId.slice(0, 8)}`, BROKER, userPeer,
    JSON.stringify({ offer_id: offerId, user_kasia_address: userPeer, qty: String(qty), quoted_usdt: '1.7', pay_chain: 'bnb', accept_tx: 'smoke_tx' })
  );
}

function injectCompletedOffer(offerId, qty) {
  db.prepare(`
    INSERT INTO exchange_offers (id, broadcast_tx_id, message_index, give_asset, give_amount, want_asset, want_amount, maker, market_key, protocol_status, verification, taker, delivery_tx, completed_at, created_at, updated_at)
    VALUES (?, ?, 0, 'KAS', ?, 'USDT', '1.7', ?, 'sell_kas_bnb', 'completed', 'cross_chain_tx', ?, ?, ?, ?, ?)
  `).run(
    offerId, 'smoke_offer_' + offerId.slice(0, 8),
    String(qty), 'kaspa:smoke_maker_addr', brokerAddr, 'smoke_delivery_tx_' + randomBytes(8).toString('hex'),
    new Date().toISOString(), new Date().toISOString(), new Date().toISOString()
  );
}

function cleanup() {
  db.prepare(`DELETE FROM exchange_offers WHERE broadcast_tx_id LIKE 'smoke_offer_%'`).run();
  db.prepare(`DELETE FROM chain_events WHERE txid LIKE 'smoke_accept_%' OR txid LIKE 'broker_buy_dm_smoke_%' OR (event_type='broker_buy_dm_sent' AND payload LIKE '%smoke_offer_%')`).run();
}

async function run() {
  cleanup();
  const mod = await import('../src/services/broker-buy-completion-watcher.js');
  mod._testInjectSendCommand(fakeSend);

  const u1 = mkPeer();
  const offer1 = randomUUID();
  injectAcceptRecord(offer1, u1, 50);
  injectCompletedOffer(offer1, 50);

  // Case 1: 第一次 tick 应 DM
  const r1 = await mod.completionTick();
  console.log('tick 1:', r1);
  console.log('sent:', sent.length, sent.map(s => s.message?.slice(0, 40)));

  // Case 2: 重复 tick 不 DM (markDmed 防重)
  const sentBefore = sent.length;
  const r2 = await mod.completionTick();
  console.log('tick 2 (repeat):', r2, 'sent diff:', sent.length - sentBefore);

  // Case 3: 没 broker_accept_record 的 completed offer (非 broker 代 accept)
  const offer3 = randomUUID();
  injectCompletedOffer(offer3, 30);  // 没 record
  const sentBefore3 = sent.length;
  await mod.completionTick();
  console.log('tick 3 (no record):', 'sent diff:', sent.length - sentBefore3);

  const checks = [
    [r1.handled === 1, 'Case 1 第一次 tick handled=1'],
    [sent.length === 1 && sent[0].message?.includes('已到'), 'Case 1 DM "已到" 发出'],
    [sent[0].message?.includes('tx '), 'Case 1 DM 含 tx 链'],
    [r2.handled === 0, 'Case 2 重复 tick 防重 handled=0'],
    [sent.length - sentBefore === 0, 'Case 2 没新 DM'],
    [sent.length - sentBefore3 === 0, 'Case 3 无 record offer 不 DM'],
  ];
  let ok = 0;
  for (const [p, l] of checks) { console.log(`${p ? '✓' : '✗'} ${l}`); if (p) ok++; }
  console.log(`\n${ok}/${checks.length} PASS${ok === checks.length ? ' ✓' : ' ✗'}`);

  cleanup();
  mod._testResetSendCommand();
  process.exit(ok === checks.length ? 0 : 1);
}

run().catch(e => { console.error('SMOKE ERR:', e.stack || e.message); cleanup(); process.exit(1); });
