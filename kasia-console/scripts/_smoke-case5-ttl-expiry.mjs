// case 5 超时 (TTL 边界) — NWT 接位原任务面
// 沿 _smoke-case3 范式: mock 注入过期 expires_at, 不真 wait 5min/30min/60min.
//
// 测试矩阵:
// 5.1 _quotes 5min TTL — 注入过期 quote, 用户 YES 不应触发 _pendingAccepts
// 5.2 _pendingAccepts 30min TTL — 注入过期 accept, 用户 PAID hash 不触发 paid_v1
// 5.3 _pendingAccepts 30min TTL — PAID_NO_TX_REGEX 截胡前 expires 检查 (走 expires.delete)
// 5.4 finalizeBuy 入口 idempotent guard — expired _pendingAccepts 不阻新 finalize
// 5.5 _quotes TTL 边界 — exactly at expires_at (now === expires) 视为过期
// 5.6 _pendingAccepts 全部 paid 后 delete (基线, 已在 _smoke-case3 验, 这里复验)
// 5.7 broker_dynamic_quote 5min idempotency window (T-J1-19n)

import {
  finalizeBuy,
  handleBuyIntent,
  _testInjectPublishOffer,
  _testResetPublishOffer,
  _testInjectSendCommand,
  _testResetSendCommand,
  _hasPendingAccept,
  _hasQuote,
  _clearPendingAccepts,
  _clearQuotes,
  _testSetQuote,
  _testSetPendingAccept,
} from '../src/services/broker-buy-handler.js';

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}  ${info || ''}`); }
};

let publishCalls = 0;
_testInjectPublishOffer(async (qty) => ({
  ok: true,
  offer_id: `mock_pub_${++publishCalls}_${Math.random().toString(16).slice(2, 6)}`,
  want_usdt: (qty * 0.034).toFixed(4),
  maker_chain_addr: '0xmockBrokerWallet',
}));
_testInjectSendCommand(async () => ({ ok: true, txId: 'mock_dm_' + Math.random().toString(16).slice(2, 8) }));

console.log('=== case 5 TTL 超时 (T-J1-19c + T-J1-19d 时间边界) ===\n');

// ── 5.1 _quotes TTL 过期 → YES 不触发 _pendingAccepts ──
console.log('-- 5.1 _quotes TTL 过期, YES 静默 fall LLM --');
_clearQuotes(); _clearPendingAccepts();
const PEER_A = 'kaspa:qrxw_ttl_a' + 'fghjkl1234567890';
_testSetQuote(PEER_A, {
  picks: [{ id: 'offer_a', take_qty: 50, take_usdt: 1.7, maker_addr: '0xMaker' + 'a'.repeat(34) }],
  total_kas: 50,
  total_usdt: 1.7,
  pay_chain: 'bnb',
  expires_at: Date.now() - 1000,  // 已过期 1s
});
const r51 = await handleBuyIntent(PEER_A, 'YES');
t('5.1.1 过期 quote + YES → fall LLM (return null)', r51 === null);
t('5.1.2 _pendingAccepts 没 set (没误触发)', !_hasPendingAccept(PEER_A));

// ── 5.2 _pendingAccepts TTL 过期 → PAID hash 不触发 paid_v1 ──
console.log('\n-- 5.2 _pendingAccepts TTL 过期, PAID hash 失效 --');
_clearPendingAccepts();
const PEER_B = 'kaspa:qrxw_ttl_b' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_B, {
  picks: [{ id: 'offer_b', take_qty: 50, take_usdt: 1.7, maker_addr: '0x...', paid_tx: null }],
  total_kas: 50,
  total_usdt: 1.7,
  pay_chain: 'bnb',
  expires_at: Date.now() - 1000,  // 过期
});
const r52 = await handleBuyIntent(PEER_B, '我付了 0x' + 'b'.repeat(64));
// 期望: handleBuyIntent line 366 检 expires < now → _pendingAccepts.delete + fall through
//       PAID_REGEX 不命中 quote 路径 (没 quote), BUY_REGEX 不命中 → return null
t('5.2.1 过期 _pendingAccepts + PAID hash → fall LLM', r52 === null);
t('5.2.2 _pendingAccepts 已自清', !_hasPendingAccept(PEER_B));

// ── 5.3 _pendingAccepts TTL 过期 → PAID_NO_TX 不截胡 (因为已自清) ──
console.log('\n-- 5.3 过期 PAID_NO_TX 不误截胡 --');
_clearPendingAccepts();
const PEER_C = 'kaspa:qrxw_ttl_c' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_C, {
  picks: [{ id: 'offer_c', take_qty: 50, take_usdt: 1.7, paid_tx: null }],
  total_kas: 50, total_usdt: 1.7, pay_chain: 'bnb',
  expires_at: Date.now() - 1000,
});
const r53 = await handleBuyIntent(PEER_C, '已付!');
// PAID_NO_TX_REGEX 命中, 但 if (Date.now() >= accept.expires_at) 先 delete then fall through
// 走 BUY_REGEX 不命中 → return null
t('5.3 过期 PAID_NO_TX → 不截胡, fall LLM', r53 === null);

// ── 5.4 finalizeBuy 入口 idempotent guard — expired pending 不阻新单 ──
console.log('\n-- 5.4 expired _pendingAccepts 不阻新 finalize --');
_clearPendingAccepts();
const PEER_D = 'kaspa:qrxw_ttl_d' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_D, {
  picks: [{ id: 'old_offer', take_qty: 30, take_usdt: 1.0, paid_tx: null }],
  total_kas: 30, total_usdt: 1.0, pay_chain: 'bnb',
  expires_at: Date.now() - 1000,
});
// finalizeBuy line 220: if (existing && Date.now() < existing.expires_at) reject.
// 过期的 — Date.now() < expired 是 false → 走正常 finalize 路径覆盖旧 _pendingAccepts.
const r54 = await finalizeBuy({ user_kasia: PEER_D, qty: 50, pay_chain: 'bnb' });
t('5.4.1 过期 _pendingAccepts 不阻新 finalize (ok=true)', r54.ok === true, JSON.stringify(r54).slice(0, 100));
t('5.4.2 新 _pendingAccepts 覆盖了旧的 (qty=50)', _hasPendingAccept(PEER_D));

// ── 5.5 TTL 边界 — exactly expires_at (now === expires) ──
console.log('\n-- 5.5 TTL exact 边界 (now === expires_at, 视为过期) --');
_clearQuotes();
const PEER_E = 'kaspa:qrxw_ttl_e' + 'fghjkl1234567890';
const exactNow = Date.now();
_testSetQuote(PEER_E, {
  picks: [{ id: 'offer_e', take_qty: 10, take_usdt: 0.34, maker_addr: '0x...' }],
  total_kas: 10, total_usdt: 0.34, pay_chain: 'bnb',
  expires_at: exactNow,  // 跟 now 同时
});
// handleBuyIntent line 410: if (pending && Date.now() < pending.expires_at) — 严格 <
// exactNow >= exactNow → fall through, fall LLM
const r55 = await handleBuyIntent(PEER_E, 'YES');
t('5.5 边界 expires_at === now 视为过期 → fall LLM', r55 === null);

// ── 5.6 _pendingAccepts 全 paid 后 delete (基线复验) ──
console.log('\n-- 5.6 全 paid 后 _pendingAccepts.delete (基线) --');
_clearPendingAccepts();
const PEER_F = 'kaspa:qrxw_ttl_f' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_F, {
  picks: [{ id: 'offer_f', take_qty: 50, take_usdt: 1.7, paid_tx: null }],
  total_kas: 50, total_usdt: 1.7, pay_chain: 'bnb',
  expires_at: Date.now() + 30 * 60 * 1000,
});
const txHash = '0x' + 'f'.repeat(64);
const r56 = await handleBuyIntent(PEER_F, '我付了 ' + txHash);
t('5.6.1 PAID hash 命中, 走 PAID_REGEX', r56 === '');
t('5.6.2 全 paid 后 _pendingAccepts 已 delete', !_hasPendingAccept(PEER_F));

// ── 5.7 broker_dynamic_quote 5min 内 idempotency 复用 (T-J1-19n) ──
// 真 idempotency 是 SQL 查 created_at > now-5min, mock 跳过. 这里只验代码路径不破.
console.log('\n-- 5.7 broker_dynamic_quote 不 publish 重 (T-J1-19n SQL 层) --');
publishCalls = 0;
_clearPendingAccepts();
const PEER_G = 'kaspa:qrxw_ttl_g' + 'fghjkl1234567890';
const r571 = await finalizeBuy({ user_kasia: PEER_G, qty: 50, pay_chain: 'bnb' });
const callsAfter1 = publishCalls;
t(`5.7.1 first finalize: publish called ${callsAfter1}+ times`, r571.ok && callsAfter1 >= 1);
console.log(`  (T-J1-19n SQL 层 idempotency 真验证需 integration test, mock 跳过)`);

_testResetPublishOffer();
_testResetSendCommand();
_clearQuotes();
_clearPendingAccepts();

console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
