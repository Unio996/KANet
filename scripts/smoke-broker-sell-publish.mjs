// smoke-broker-sell-publish.mjs — T-NWT-05: B 模式代卖 broker publish + expired refund
// Behavioral smoke: real INSERT/UPDATE, mock _send + _publishOffer, real DB state assertions
// Run from kasia-console cwd: cd kasia-console && node ../scripts/smoke-broker-sell-publish.mjs

import { randomUUID } from 'crypto';

const { sqlite } = await import('../kasia-console/src/db/client.js');
const {
  intakeTick,
  _scanExpiredBrokerOffers,
  _ensureBrokerUtxoSplit,
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
  // T-NWT-07: 源表换成 kaspa_tx_log. broker_intake_processed marker 仍 chain_events,
  // payload src_event_id 现在是 string tx_id (不是 number row id).
  // 1) 删 我们 PEER (或 anonymous fallback) 在 kaspa_tx_log 的 smoke 行
  const myTxIds = sqlite.prepare(
    `SELECT tx_id FROM kaspa_tx_log WHERE (from_address=? OR from_address IS NULL) AND tx_id LIKE 'smoketx_%' AND to_address=?`
  ).all(PEER, getTraderAddr()).map(r => r.tx_id);
  for (const tx of myTxIds) {
    sqlite.prepare(`DELETE FROM chain_events WHERE event_type='broker_intake_processed' AND txid=?`)
      .run(`broker_intake_${tx}`);
    sqlite.prepare(`DELETE FROM kaspa_tx_log WHERE tx_id=?`).run(tx);
  }
  // 2) refund markers + smoke offers (payload contains PEER)
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

function seedIntakeEvent(amount, opts = {}) {
  // T-NWT-07: intakeTick 现查 kaspa_tx_log (不再 chain_events 'tx').
  // opts.fromNull=true 模拟 indexer 没解 sender (peer NULL hack fallback case).
  const txid = 'smoketx_' + randomUUID().slice(0, 16);
  const now = new Date().toISOString();
  const fromAddr = opts.fromNull ? null : PEER;
  sqlite.prepare(`
    INSERT INTO kaspa_tx_log (tx_id, block_hash, block_time, from_address, to_address, amount, outputs_json, observed_at, network)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mainnet')
  `).run(txid, 'smokeblock_' + randomUUID().slice(0,8), Math.floor(Date.now()/1000), fromAddr, getTraderAddr(), parseFloat(amount), '[]', now);
  return txid;
}

function lastProcessedOutcome() {
  // T-NWT-07: 排除 smoke-mask observed_by (setup 插的 prod-inbound mask 标记不是 case outcome)
  const r2 = sqlite.prepare(`
    SELECT payload FROM chain_events
    WHERE event_type='broker_intake_processed'
    AND observed_by != 'smoke-mask'
    ORDER BY observed_at DESC LIMIT 1
  `).get();
  if (!r2) return null;
  try { return JSON.parse(r2.payload).outcome; } catch { return null; }
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
// Case 5 · _ensureBrokerUtxoSplit idempotent: 4min 内重复调 skip
// ─────────────────────────────────────────────────────────────────────────────
async function case5_utxo_split_idempotent() {
  console.log('\nCase 5 · _ensureBrokerUtxoSplit 防 4min 重跑');
  // 清现有 broker_utxo_split markers (避免 prior smoke 残留)
  sqlite.prepare(`DELETE FROM chain_events WHERE event_type='broker_utxo_split' AND txid LIKE 'broker_utxo_split_%'`).run();

  // 插一条最近 (now) 的 marker → 模拟刚 split 完
  sqlite.prepare(`
    INSERT INTO chain_events (txid, from_address, to_address, event_type, payload, observed_by, observed_at)
    VALUES (?, NULL, NULL, 'broker_utxo_split', ?, 'smoke', datetime('now'))
  `).run('broker_utxo_split_smoke_recent', JSON.stringify({ result: { split: true, utxosBefore: 1, utxosAfter: 8 } }));

  // 调 _ensureBrokerUtxoSplit → 应 skipped 不调 splitUtxos
  const r = await _ensureBrokerUtxoSplit();
  assertEq(r?.skipped, 'recent', 'skipped=recent (4min 内重复防止)');

  // 清 marker, 再调 (这次会真调 splitUtxos, 但 smoke 进程没 Relay 连接, 应该 ok=false 或 error)
  sqlite.prepare(`DELETE FROM chain_events WHERE event_type='broker_utxo_split' AND txid LIKE 'broker_utxo_split_%'`).run();
  const r2 = await _ensureBrokerUtxoSplit();
  // 不管 splitUtxos 真返回啥, chain_event 应该被 INSERT (函数后半段总是写)
  const ev = sqlite.prepare(`SELECT 1 FROM chain_events WHERE event_type='broker_utxo_split' LIMIT 1`).get();
  assert(ev != null, 'chain_event broker_utxo_split INSERTED after non-skip path');

  // cleanup
  sqlite.prepare(`DELETE FROM chain_events WHERE event_type='broker_utxo_split' AND txid LIKE 'broker_utxo_split_%'`).run();
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup once: mask 所有 prod kaspa_tx_log Trader-B inbound as already-processed
// (smoke 不能 DELETE 真 prod 数据, 但 intakeTick 会扫到. mark 一次防 process.)
// ─────────────────────────────────────────────────────────────────────────────
function setupSmokeMask() {
  const trAddr = getTraderAddr();
  const prod = sqlite.prepare(`SELECT tx_id FROM kaspa_tx_log WHERE to_address=?`).all(trAddr);
  const stmt = sqlite.prepare(`
    INSERT OR IGNORE INTO chain_events
      (txid, from_address, to_address, event_type, payload, observed_by, observed_at)
    VALUES (?, NULL, NULL, 'broker_intake_processed', ?, 'smoke-mask', datetime('now'))
  `);
  let masked = 0;
  for (const r of prod) {
    if (r.tx_id.startsWith('smoketx_')) continue;  // skip smoke 自己将插的
    const result = stmt.run('broker_intake_' + r.tx_id, JSON.stringify({ src_event_id: r.tx_id, outcome: 'smoke_mask' }));
    if (result.changes > 0) masked++;
  }
  return masked;
}

function teardownSmokeMask() {
  return sqlite.prepare(`DELETE FROM chain_events WHERE event_type='broker_intake_processed' AND observed_by='smoke-mask'`).run().changes;
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

const masked = setupSmokeMask();
console.log(`[setup] masked ${masked} prod kaspa_tx_log Trader-B inbound to prevent smoke contamination`);

await case1_main_path();
await case2_publish_failed();
await case3_expired_refund();
await case4_no_pay_addr();
await case5_utxo_split_idempotent();

cleanup();
const unmasked = teardownSmokeMask();
console.log(`[teardown] unmasked ${unmasked} smoke-mask markers`);

console.log(`\n=== smoke-broker-sell-publish: ${passed}/${passed + failed} pass, ${failed} fail ===`);
process.exit(failed === 0 ? 0 : 1);
