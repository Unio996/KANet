// smoke-e2e-broker-integration.mjs — E2E 集成 smoke
// 跑完整 M2 限价买单流程: user → broker → seeder → published → (sell/refund)
// Run from kasia-console cwd: cd kasia-console && node ../scripts/smoke-e2e-broker-integration.mjs

import { randomUUID } from 'crypto';

const { sqlite } = await import('../kasia-console/src/db/client.js');
const retailDex = await import('../kasia-console/src/services/retail-dex.js');
const { handleDm, _testInjectSendCommand, _testResetSendCommand } = retailDex;
const exchMachine = await import('../kasia-console/src/services/exchange-machine.js');
const { _makerAutoPayGive, _testInjectTransferUsdt: injEmTx, _testResetTransferUsdt: rstEmTx } = exchMachine;
const mseeder = await import('../kasia-console/src/services/market-seeder.js');
const {
  refundWorkerTick, depositWatcherTick,
  _testInjectSendCommandAsync: injMsSend, _testResetSendCommandAsync: rstMsSend,
  _testInjectTransferUsdt: injMsTx, _testResetTransferUsdt: rstMsTx,
} = mseeder;
const pusher = await import('../kasia-console/src/services/retail-dex-pusher.js');
const { _testInjectSendCommandAsync: injPshSend, _testResetSendCommandAsync: rstPshSend } = pusher;

let passed = 0, failed = 0;
function assert(c, l) { if (c) { console.log(`  PASS: ${l}`); passed++; } else { console.log(`  FAIL: ${l}`); failed++; } }
function assertEq(a, b, l) { assert(String(a) === String(b), `${l}: expected "${b}", got "${a}"`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const BROKER_RELAY = 'e2e-broker-' + randomUUID().slice(0, 8);
const SEEDER_ADDR = '0xSeederE2ETest' + randomUUID().slice(0, 16);
const USER_KASIA = 'kaspa:qe2e' + randomUUID().slice(0, 16);
const USER_BSC = '0xUserBscE2E' + randomUUID().slice(0, 16);

const sentDMs = [];  // 所有 pusher DM (T7)
const sentCmds = [];  // relay broadcast (cancel_v1) 或 exchange transfer
let transferCount = 0;

function cleanup() {
  sqlite.prepare("DELETE FROM retail_dex_buy_publications WHERE broker_relay_id = ?").run(BROKER_RELAY);
  sqlite.prepare("DELETE FROM retail_dex_orders WHERE user_kasia_address = ?").run(USER_KASIA);
  sqlite.prepare("DELETE FROM exchange_offers WHERE maker = ?").run(BROKER_RELAY);
  sqlite.prepare("DELETE FROM agent_wallets WHERE relay_node_id = ?").run(BROKER_RELAY);
  sqlite.prepare("DELETE FROM relay_nodes WHERE id = ?").run(BROKER_RELAY);
  rstEmTx(); rstMsSend(); rstMsTx(); rstPshSend(); _testResetSendCommand();
  sentDMs.length = 0; sentCmds.length = 0; transferCount = 0;
}

function setupBroker() {
  const now = new Date().toISOString();
  sqlite.prepare(
    "INSERT OR REPLACE INTO relay_nodes (id, name, network, poll_ms, is_dex_broker, created_at, updated_at) VALUES (?, 'e2e-broker', 'mainnet', 2000, 1, ?, ?)"
  ).run(BROKER_RELAY, now, now);
  sqlite.prepare(
    "INSERT OR REPLACE INTO agent_wallets (relay_node_id, chain, address, privkey_encrypted, is_default, created_at, updated_at) VALUES (?, 'bnb', ?, 'enc_fake', 1, ?, ?)"
  ).run(BROKER_RELAY, SEEDER_ADDR, now, now);
}

function setupMocks() {
  injPshSend(async (relayId, cmd) => { sentDMs.push({ relayId, ...cmd }); return { txId: 'push_' + sentDMs.length }; });
  injMsSend(async (relayId, cmd) => { sentCmds.push({ relayId, ...cmd }); return { txId: 'cancel_' + sentCmds.length }; });
  _testInjectSendCommand(async (relayId, cmd) => { sentCmds.push({ relayId, ...cmd }); return { txId: 'bcast_' + sentCmds.length }; });
  injMsTx(async () => { transferCount++; return { txHash: '0xTx_' + transferCount, error: null }; });
  injEmTx(async () => { transferCount++; return { ok: true, txHash: '0xMakerPay_' + transferCount }; });
}

// ═══════════════════════════════════════════════════════════════════════════════
// E2E Scenario 1: M2 限价买 → deposit → publish → refund (无卖家接)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
console.log('║ E2E Scenario 1: M2 完整生命周期 (awaiting_deposit → refunded)         ║');
console.log('╚═══════════════════════════════════════════════════════════════════════╝');

cleanup();
setupBroker();
setupMocks();

// Step 1: 用户 DM Broker "挂单 50 KAS @ 0.03 USDT"
console.log('\n[Step 1] 用户 DM: "买 50 KAS @ 0.03 USDT"');
const reply1 = await handleDm(USER_KASIA, '买 50 KAS @ 0.03 USDT', BROKER_RELAY);

assert(reply1.includes('挂单提交'), 'Step 1: reply 含 "挂单提交"');
assert(reply1.includes(SEEDER_ADDR), 'Step 1: reply 含 Seeder BSC 地址');
assert(reply1.includes('1.500000 USDT'), 'Step 1: reply 含 total_usdt');

const pub1 = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE user_kasia_address = ?").get(USER_KASIA);
assert(pub1, 'Step 1: pub row 建成');
assertEq(pub1?.state, 'awaiting_deposit', 'Step 1: state = awaiting_deposit');

// 等 T7 push (fire-and-forget)
await sleep(300);
const step1Dms = sentDMs.filter(d => d.message?.includes('待充值'));
assert(step1Dms.length >= 1, 'Step 1: T7 push 待充值 DM');

// Step 2: 用户过期未充值 (手动把 expires_at 设过去)
console.log('\n[Step 2] 用户超时未充值 → refundWorker 清理');
sqlite.prepare(
  "UPDATE retail_dex_buy_publications SET state='published', seeder_publish_offer_id='offer-s1', expires_at=? WHERE id=?"
).run(new Date(Date.now() - 60000).toISOString().slice(0,19).replace('T',' '), pub1.id);

// 建对应 exchange_offer (open 状态, 才能被 refundWorker 识别为"无人接")
const now2 = new Date().toISOString();
sqlite.prepare(`
  INSERT INTO exchange_offers (id, broadcast_tx_id, give_asset, give_amount, give_chain, want_asset, want_amount, maker, market_key, protocol_status, verification, broadcast_at, expires_at, created_at, updated_at)
  VALUES ('offer-s1', 'tx1', 'USDT', '1.5', 'bnb', 'KAS', '50', ?, 'buy_kas_bnb', 'open', 'cross_chain_tx', ?, ?, ?, ?)
`).run(BROKER_RELAY, now2, now2, now2, now2);

// 插入 order 对应退款地址
sqlite.prepare(`
  INSERT INTO retail_dex_orders (id, user_kasia_address, side, order_type, qty, price, pay_chain, pay_address, state, expires_at, created_at, updated_at)
  VALUES ('order-s1', ?, 'buy_kas', 'limit', '50', '0.03', 'bnb', ?, 'awaiting_payment', ?, ?, ?)
`).run(USER_KASIA, USER_BSC, now2, now2, now2);

transferCount = 0;
sentDMs.length = 0;
await refundWorkerTick();

const pub1After = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE id = ?").get(pub1.id);
assertEq(pub1After?.state, 'refunded', 'Step 2: 超时退款 state = refunded');
assert(pub1After?.usdt_refund_tx?.startsWith('0xTx_'), 'Step 2: usdt_refund_tx 已落库');
assertEq(transferCount, 1, 'Step 2: transferUsdt 调用 1 次');
assert(sentCmds.some(c => c.payload?.t === 'kanet_exchange_cancel_v1'), 'Step 2: cancel_v1 广播');

await sleep(300);
const refundDm = sentDMs.filter(d => d.message?.includes('已退款'));
assert(refundDm.length >= 1, 'Step 2: T7 push 退款 DM');

// ═══════════════════════════════════════════════════════════════════════════════
// E2E Scenario 2: 成交路径 (filled → completed via maker auto-pay)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
console.log('║ E2E Scenario 2: 成交路径 (filled → completed)                         ║');
console.log('╚═══════════════════════════════════════════════════════════════════════╝');

cleanup();
setupBroker();
setupMocks();

// 直接建 pub state=filled (模拟 seller 已发 KAS, verify 过)
const now3 = new Date().toISOString();
const offer2Id = 'offer-s2';
sqlite.prepare(`
  INSERT INTO retail_dex_buy_publications (id, user_kasia_address, broker_relay_id, seeder_relay_id, side, qty, limit_price, total_usdt, pay_chain, seeder_publish_offer_id, state, expires_at, created_at, updated_at)
  VALUES ('pub-s2', ?, ?, ?, 'buy_kas', '100', '0.05', '5', 'bnb', ?, 'filled', ?, ?, ?)
`).run(USER_KASIA, BROKER_RELAY, BROKER_RELAY, offer2Id, new Date(Date.now() + 3600000).toISOString(), now3, now3);

const TAKER_BSC = '0xSellerTakerE2E' + randomUUID().slice(0, 12);
sqlite.prepare(`
  INSERT INTO exchange_offers (id, broadcast_tx_id, give_asset, give_amount, give_chain, want_asset, want_amount, maker, market_key, protocol_status, verification, taker_payment_address, broadcast_at, expires_at, created_at, updated_at)
  VALUES (?, 'tx2', 'USDT', '5', 'bnb', 'KAS', '100', ?, 'buy_kas_bnb', 'verifying', 'cross_chain_tx', ?, ?, ?, ?, ?)
`).run(offer2Id, BROKER_RELAY, TAKER_BSC, now3, now3, now3, now3);

// 触发 maker auto-pay-give
console.log('\n[Step 3] Maker auto-pay-give 发 USDT 给 seller');
const offerRow = sqlite.prepare("SELECT * FROM exchange_offers WHERE id = ?").get(offer2Id);
await _makerAutoPayGive(offerRow);

const pub2After = sqlite.prepare("SELECT * FROM retail_dex_buy_publications WHERE id = ?").get('pub-s2');
assertEq(pub2After?.state, 'completed', 'Step 3: pub → completed');
assert(pub2After?.filled_at, 'Step 3: filled_at 落库');
assert(pub2After?.kas_delivery_tx?.startsWith('0xMakerPay_'), 'Step 3: kas_delivery_tx 落库');
assertEq(transferCount, 1, 'Step 3: exchange transferUsdt 调用 1 次');

await sleep(300);
const completedDm = sentDMs.filter(d => d.message?.includes('成交'));
assert(completedDm.length >= 1, 'Step 3: T7 push 成交 DM');

// ═══════════════════════════════════════════════════════════════════════════════
// E2E Scenario 3: API 端到端 (/api/broker/stats 返真数据)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
console.log('║ E2E Scenario 3: API /api/broker/stats 实数据返回                      ║');
console.log('╚═══════════════════════════════════════════════════════════════════════╝');

// 此场景直接查 DB 验证 stats 逻辑 (不走 HTTP 因避免依赖 Console running)
// 保留 Scenario 2 的 completed pub (在 cleanup 前已 commit DB)
// 建 1 个新 awaiting_deposit 的 pub 模拟当前服务
const activeUser = 'kaspa:qactive' + randomUUID().slice(0, 8);
sqlite.prepare(`
  INSERT INTO retail_dex_buy_publications (id, user_kasia_address, broker_relay_id, seeder_relay_id, side, qty, limit_price, total_usdt, pay_chain, state, expires_at, created_at, updated_at)
  VALUES ('pub-active', ?, ?, ?, 'buy_kas', '30', '0.04', '1.2', 'bnb', 'awaiting_deposit', ?, ?, ?)
`).run(activeUser, BROKER_RELAY, BROKER_RELAY, new Date(Date.now() + 3600000).toISOString(), now3, now3);

// 直接调 API 路由相同查询逻辑 (复制 /api/broker/stats 核心 SQL)
const brokerCfg = sqlite.prepare("SELECT id FROM relay_nodes WHERE id = ?").get(BROKER_RELAY);
assert(brokerCfg, 'Step 4: broker relay 存在');

const activeOrders = sqlite.prepare(`
  SELECT id FROM retail_dex_orders WHERE state IN ('aligning','confirming','awaiting_payment','paid','executing')
`).all();
const activePubs = sqlite.prepare(`
  SELECT id, state FROM retail_dex_buy_publications WHERE state IN ('awaiting_deposit','deposited','published','filled')
`).all();
const completed = sqlite.prepare(`
  SELECT COUNT(*) as cnt FROM retail_dex_buy_publications WHERE state = 'completed'
`).get();

assert(activePubs.some(p => p.state === 'awaiting_deposit'), 'Step 4: active_publications 含 awaiting_deposit');
assert(completed?.cnt >= 1, 'Step 4: completed_m2 ≥ 1 (Scenario 2 留下的)');

// ── Cleanup ──
console.log('\n=== Final cleanup ===');
cleanup();
sqlite.prepare("DELETE FROM retail_dex_buy_publications WHERE user_kasia_address = ?").run(activeUser);

console.log(`\n╔═══════════════════════════════════════════════════════════════════════╗`);
console.log(`║ E2E Summary: ${passed} passed, ${failed} failed                                        ║`);
console.log(`╚═══════════════════════════════════════════════════════════════════════╝`);
process.exit(failed > 0 ? 1 : 0);
