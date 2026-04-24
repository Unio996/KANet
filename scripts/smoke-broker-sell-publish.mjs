// smoke-broker-sell-publish.mjs — T-NWT-05: B 模式代卖 broker publish + expired refund
// Behavioral smoke: real INSERT/UPDATE, mock _send + _publishOffer, real DB state assertions
// Run from kasia-console cwd: cd kasia-console && node ../scripts/smoke-broker-sell-publish.mjs

import { randomUUID } from 'crypto';

const { sqlite } = await import('../kasia-console/src/db/client.js');
const {
  intakeTick,
  _scanExpiredBrokerOffers,
  _testInjectSendCommand,
  _testResetSendCommand,
  _testInjectPublish,
  _testResetPublish,
} = await import('../kasia-console/src/services/broker-intake-watcher.js');

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { console.log(`  PASS: ${label}`); passed++; }
  else { console.log(`  FAIL: ${label}`); failed++; }
}
function assertEq(a, b, label) {
  assert(String(a) === String(b), `${label}: expected "${String(b)}", got "${String(a)}"`);
}

const PEER = 'kaspa:qsmokebroker' + randomUUID().slice(0, 12);
const PEER_PAY_CHAIN = 'bnb';
const PEER_PAY_ADDR = '0xSmokeUser' + randomUUID().slice(0, 8);

let traderAddr;

function getTraderAddr() {
  if (traderAddr) return traderAddr;
  const r = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(BROKER_RELAY_ID);
  if (!r?.address) throw new Error('Trader-B relay not found in DB - smoke needs Trader-B configured');
  traderAddr = r.address;
  return traderAddr;
}

function cleanup() {
  // peer-level
  sqlite.prepare(`DELETE FROM retail_dex_orders WHERE user_kasia_address=?`).run(PEER);
  sqlite.prepare(`DELETE FROM retail_dex_user_memory WHERE user_kasia_address=?`).run(PEER);
  sqlite.prepare(`DELETE FROM relation_states WHERE peer_address=?`).run(PEER);
  // 1) find our tx event ids for PEER, delete corresponding broker_intake_processed markers
  const txEvs = sqlite.prepare(`SELECT id FROM chain_events WHERE from_address=?`).all(PEER);
  for (const r of txEvs) {
    sqlite.prepare(`DELETE FROM chain_events WHERE event_type='broker_intake_processed' AND txid=?`)
      .run(`broker_intake_${r.id}`);
  }
  // 2) delete the tx events themselves
  sqlite.prepare(`DELETE FROM chain_events WHERE from_address=?`).run(PEER);
  // 3) nuke ALL orphan broker_intake_processed markers (point to non-existent tx events,
  //    leftover from prior smoke runs — harmless to delete since they serve no purpose)
  sqlite.prepare(`
    DELETE FROM chain_events
    WHERE event_type='broker_intake_processed'
    AND txid LIKE 'broker_intake_%'
    AND CAST(SUBSTR(txid, 16) AS INTEGER) NOT IN (
      SELECT id FROM chain_events WHERE event_type='tx'
    )
  `).run();
  // 4) refund markers + smoke offers (payload contains PEER)
  sqlite.prepare(`DELETE FROM chain_events WHERE event_type='broker_kas_refunded' AND payload LIKE ?`)
    .run(`%${PEER}%`);
  sqlite.prepare(`DELETE FROM exchange_offers WHERE maker=? AND metadata LIKE ?`)
    .run(getTraderAddr(), `%"user_kasia_address":"${PEER}"%`);
  // reset injects
  _testResetSendCommand();
  _testResetPublish();
}

function seedIntent({ side = 'sell_kas', qty = '50' }) {
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO retail_dex_orders
      (id, user_kasia_address, side, order_type, qty, price, pay_chain, pay_address, state, created_at, updated_at)
    VALUES (?, ?, ?, 'limit', ?, '0.08', ?, ?, 'awaiting_payment', ?, ?)
  `).run(randomUUID(), PEER, side, qty, PEER_PAY_CHAIN, PEER_PAY_ADDR, now, now);
}

function seedMemory() {
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT OR REPLACE INTO retail_dex_user_memory
      (user_kasia_address, distilled_summary, preferred_chain, preferred_pay_address, created_at, updated_at)
    VALUES (?, 'smoke', ?, ?, ?, ?)
  `).run(PEER, PEER_PAY_CHAIN, PEER_PAY_ADDR, now, now);
}

function seedIntakeEvent(amount) {
  const txid = 'smoketx_' + randomUUID().slice(0, 16);
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO chain_events (txid, from_address, to_address, event_type, payload, observed_by, observed_at)
    VALUES (?, ?, ?, 'tx', ?, 'smoke', ?)
  `).run(txid, PEER, getTraderAddr(), JSON.stringify({ amount: String(amount), direction: 'inbound' }), now);
  return txid;
}

function lastProcessedOutcome() {
  const r = sqlite.prepare(`
    SELECT payload FROM chain_events WHERE event_type='broker_intake_processed' AND payload LIKE ?
    ORDER BY observed_at DESC LIMIT 1
  `).get(`%${PEER}%`);
  if (!r) {
    // outcome payload references src_event_id (chain_event.id), peer not in payload — fallback: last by time near our event
    const r2 = sqlite.prepare(`
      SELECT payload FROM chain_events WHERE event_type='broker_intake_processed'
      ORDER BY observed_at DESC LIMIT 1
    `).get();
    if (!r2) return null;
    try { return JSON.parse(r2.payload).outcome; } catch { return null; }
  }
  try { return JSON.parse(r.payload).outcome; } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 1 · 主路: 用户 sell 意图 + 入账 → publish 成功 → DM 报价
// ─────────────────────────────────────────────────────────────────────────────
async function case1_main_path() {
  console.log('\nCase 1 · 主路 sell_kas → publish 成功');
  cleanup();
  seedMemory();
  seedIntent({ side: 'sell_kas', qty: '50' });
  seedIntakeEvent('50');

  const sendCalls = [];
  const publishCalls = [];
  _testInjectSendCommand((id, cmd) => { sendCalls.push({ id, cmd }); return Promise.resolve({ ok: true }); });
  _testInjectPublish((body) => {
    publishCalls.push(body);
    return Promise.resolve({ ok: true, offer_id: 'offer_smoke1_' + randomUUID().slice(0,8),
      broadcast_tx: 'tx_smoke1_' + randomUUID().slice(0,16), expires_at: new Date(Date.now()+2*3600*1000).toISOString() });
  });

  const r = await intakeTick();
  assert(r.handled >= 1, `intakeTick handled >= 1 (got ${r.handled})`);
  assertEq(publishCalls.length, 1, 'publishOffer called exactly once');
  if (publishCalls[0]) {
    const body = publishCalls[0];
    assertEq(body.relayNodeId, BROKER_RELAY_ID, 'publish.relayNodeId = Trader-B');
    assertEq(body.give_asset, 'KAS', 'publish.give_asset = KAS');
    assertEq(body.want_asset, 'USDT', 'publish.want_asset = USDT');
    assertEq(body.verification, 'cross_chain_tx', 'publish.verification = cross_chain_tx');
    const meta = body.verification_meta;
    assert(Array.isArray(meta?.accepted_chains) && meta.accepted_chains.length === 1,
      'verification_meta.accepted_chains is single-entry array');
    assertEq(meta?.accepted_chains?.[0]?.chain, PEER_PAY_CHAIN, 'accepted_chains[0].chain = peer pay chain');
    assertEq(meta?.accepted_chains?.[0]?.address, PEER_PAY_ADDR, 'accepted_chains[0].address = PEER pay (NON-MAKER, Q1 design)');
    assertEq(body.metadata?.source, 'broker-intake', 'metadata.source = broker-intake');
    assertEq(body.metadata?.user_kasia_address, PEER, 'metadata.user_kasia_address = peer');
    // fee model: give_amount = amount - fee_kas (fee 0.1)
    const giveNum = parseFloat(body.give_amount);
    assert(Math.abs(giveNum - 49.9) < 0.001, `give_amount=49.9 (50 - 0.1 fee), got ${giveNum}`);
  }
  // DM 应该发了 1 条 (报价), 不该有 sendKas
  const dms = sendCalls.filter(c => c.cmd?.type === 'send_message');
  const refunds = sendCalls.filter(c => c.cmd?.type === 'send_kas');
  assertEq(dms.length, 1, 'exactly 1 send_message (quote DM)');
  assertEq(refunds.length, 0, 'no send_kas refund (publish succeeded)');
  assert(dms[0]?.cmd?.message?.includes('SELL'), 'DM contains "SELL"');
  assert(dms[0]?.cmd?.message?.includes(PEER_PAY_CHAIN), 'DM mentions pay chain');

  const outcome = lastProcessedOutcome();
  assert(String(outcome).startsWith('sell_published:'), `outcome starts sell_published: (got ${outcome})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 2 · publish 失败保险: sendKas 退原 KAS + DM
// ─────────────────────────────────────────────────────────────────────────────
async function case2_publish_failed() {
  console.log('\nCase 2 · publish 失败 → sendKas 退 + DM');
  cleanup();
  seedMemory();
  seedIntent({ side: 'sell_kas', qty: '50' });
  seedIntakeEvent('50');

  const sendCalls = [];
  _testInjectSendCommand((id, cmd) => { sendCalls.push({ id, cmd }); return Promise.resolve({ ok: true }); });
  _testInjectPublish(() => Promise.resolve({ ok: false, error: 'Broadcast failed — relay syncing' }));

  const r = await intakeTick();
  assert(r.handled >= 1, 'handled >= 1');
  const refunds = sendCalls.filter(c => c.cmd?.type === 'send_kas');
  const dms = sendCalls.filter(c => c.cmd?.type === 'send_message');
  assertEq(refunds.length, 1, 'exactly 1 sendKas refund');
  assertEq(parseFloat(refunds[0]?.cmd?.amount_kas), 50, 'refund amount = original 50 KAS');
  assertEq(refunds[0]?.cmd?.target, PEER, 'refund target = peer');
  assertEq(dms.length, 1, '1 DM with failure reason');
  assert(dms[0]?.cmd?.message?.includes('退'), 'DM mentions refund');

  assertEq(lastProcessedOutcome(), 'publish_failed', 'outcome = publish_failed');
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 3 · expired refund sub-tick: 扫 expired offer → sendKas + chain_event + DM
// ─────────────────────────────────────────────────────────────────────────────
async function case3_expired_refund() {
  console.log('\nCase 3 · _scanExpiredBrokerOffers expired offer → sendKas');
  cleanup();
  // INSERT a expired broker-intake offer directly
  const offerId = 'expired_smoke_' + randomUUID().slice(0,8);
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO exchange_offers
      (id, broadcast_tx_id, message_index, give_asset, give_amount, give_chain,
       want_asset, want_amount, want_chain, maker, broadcast_at, expires_at,
       verification, verification_meta, metadata, protocol_status, is_fully_observed,
       market_key, created_at, updated_at)
    VALUES (?, ?, 0, 'KAS', '49.9', NULL, 'USDT', '4.0', NULL, ?, ?, ?,
            'cross_chain_tx', '{}', ?, 'expired', 0, 'KAS|USDT', ?, ?)
  `).run(
    offerId, 'tx_' + offerId, getTraderAddr(), now, now,
    JSON.stringify({ source: 'broker-intake', user_kasia_address: PEER, intent_qty: 50, fee_kas: 0.1, net_kas: 49.9 }),
    now, now
  );

  const sendCalls = [];
  _testInjectSendCommand((id, cmd) => { sendCalls.push({ id, cmd }); return Promise.resolve({ ok: true }); });

  const r = await _scanExpiredBrokerOffers();
  assertEq(r.handled, 1, 'handled = 1 (one expired offer)');
  const refunds = sendCalls.filter(c => c.cmd?.type === 'send_kas');
  const dms = sendCalls.filter(c => c.cmd?.type === 'send_message');
  assertEq(refunds.length, 1, 'sendKas called once');
  assertEq(parseFloat(refunds[0]?.cmd?.amount_kas), 50, 'refund = original intent_qty 50 KAS');
  assertEq(refunds[0]?.cmd?.target, PEER, 'refund target = peer');
  assertEq(dms.length, 1, 'DM called once with refund notice');

  // chain_event 'broker_kas_refunded' inserted
  const ev = sqlite.prepare(`
    SELECT payload FROM chain_events WHERE event_type='broker_kas_refunded' AND payload LIKE ?
  `).get(`%"offer_id":"${offerId}"%`);
  assert(ev != null, 'chain_event broker_kas_refunded INSERTED');

  // re-run should be idempotent (already refunded → skip)
  const sendCalls2 = [];
  _testInjectSendCommand((id, cmd) => { sendCalls2.push({ id, cmd }); return Promise.resolve({ ok: true }); });
  const r2 = await _scanExpiredBrokerOffers();
  assertEq(r2.handled, 0, 'second scan handles 0 (idempotent via chain_event marker)');
  assertEq(sendCalls2.length, 0, 'no _send calls on re-scan');
}

// ─────────────────────────────────────────────────────────────────────────────
// Case 4 · 无 pay_address: DM await_pay_addr (broker 不退, J2 12h scanner 兼带)
// ─────────────────────────────────────────────────────────────────────────────
async function case4_no_pay_addr() {
  console.log('\nCase 4 · 无 pay_address → DM await_pay_addr');
  cleanup();
  // 无 memory, 无 retail_dex_orders pay_chain (用 NULL 跳过 _getUserPayAddress 第二源)
  // Need intent match (sell_kas + qty) but with pay_chain=NULL
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO retail_dex_orders
      (id, user_kasia_address, side, order_type, qty, price, pay_chain, pay_address, state, created_at, updated_at)
    VALUES (?, ?, 'sell_kas', 'limit', '50', '0.08', NULL, NULL, 'awaiting_payment', ?, ?)
  `).run(randomUUID(), PEER, now, now);
  seedIntakeEvent('50');

  const sendCalls = [];
  const publishCalls = [];
  _testInjectSendCommand((id, cmd) => { sendCalls.push({ id, cmd }); return Promise.resolve({ ok: true }); });
  _testInjectPublish((body) => { publishCalls.push(body); return Promise.resolve({ ok: true, offer_id: 'should_not_reach', broadcast_tx: '?' }); });

  const r = await intakeTick();
  assert(r.handled >= 1, 'handled >= 1');
  assertEq(publishCalls.length, 0, 'publishOffer NOT called');
  const refunds = sendCalls.filter(c => c.cmd?.type === 'send_kas');
  const dms = sendCalls.filter(c => c.cmd?.type === 'send_message');
  assertEq(refunds.length, 0, 'no sendKas (broker holds, J2 12h scanner refunds)');
  assertEq(dms.length, 1, '1 DM asking for pay address');
  assert(dms[0]?.cmd?.message?.includes('收款'), 'DM mentions 收款');

  assertEq(lastProcessedOutcome(), 'await_pay_addr', 'outcome = await_pay_addr');
}

// ─────────────────────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────────────────────
try {
  getTraderAddr();
} catch (e) {
  console.error('Smoke setup failed:', e.message);
  process.exit(2);
}

await case1_main_path();
await case2_publish_failed();
await case3_expired_refund();
await case4_no_pay_addr();

cleanup();

console.log(`\n=== smoke-broker-sell-publish: ${passed}/${passed + failed} pass, ${failed} fail ===`);
process.exit(failed === 0 ? 0 : 1);
