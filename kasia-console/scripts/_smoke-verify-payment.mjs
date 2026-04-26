// T-J2-V2 smoke — verify_payment lazy LLM tool 路径
// 测:
// 1. 没 _pendingAccepts → 'no_active_order'
// 2. 有 _pendingAccepts, scan 0 events → 'no_match' (events=0)
// 3. 有 _pendingAccepts, scan amount 不匹 → 'no_match' (events>0 但金额不对)
// 4. 有 _pendingAccepts, scan amount 匹 → ok=true + push paid_v1 + remove unpaid pick

import {
  finalizeBuy,
  verifyPaymentForPeer,
  _testInjectPublishOffer,
  _testResetPublishOffer,
  _testInjectSendCommand,
  _testResetSendCommand,
  _testInjectScan,
  _testResetScan,
  _hasPendingAccept,
  _clearPendingAccepts,
  _clearQuotes,
} from '../src/services/broker-buy-handler.js';

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}  ${info || ''}`); }
};

let publishCalls = 0;
_testInjectPublishOffer(async (qty, chain) => {
  publishCalls++;
  return { ok: true, offer_id: `mock_${publishCalls}_${Math.random().toString(16).slice(2,6)}`, want_usdt: (qty * 0.034).toFixed(4), maker_chain_addr: '0xmockBroker', mid_price: 0.0337, sell_price: 0.0340 };
});

let dmCaptures = [];
_testInjectSendCommand(async (relayId, cmd) => {
  dmCaptures.push({ relayId, cmd });
  return { ok: true, txid: 'mock_dm_' + Math.random().toString(16).slice(2,8) };
});

console.log('=== T-J2-V2 verify_payment smoke ===\n');

// ── Test 1: 没 _pendingAccepts ──
_clearPendingAccepts(); _clearQuotes();
const PEER1 = 'kaspa:qrxw_v2_t1_test';
const r1 = await verifyPaymentForPeer({ peer: PEER1, chain: 'bnb' });
t('1. no _pendingAccepts → no_active_order', r1.ok === false && r1.reason === 'no_active_order', JSON.stringify(r1).slice(0,150));

// ── Test 2: 有 _pendingAccepts, scan 0 events ──
_clearPendingAccepts();
const PEER2 = 'kaspa:qrxw_v2_t2_test';
await finalizeBuy({ user_kasia: PEER2, qty: 50, pay_chain: 'bnb' });
_testInjectScan(async () => ({ ok: true, events: [] }));
const r2 = await verifyPaymentForPeer({ peer: PEER2, chain: 'bnb' });
t('2. scan 0 events → no_match', r2.ok === false && r2.reason === 'no_match' && r2.scanned_events === 0, JSON.stringify(r2).slice(0,200));

// ── Test 3: 有 _pendingAccepts, scan 1 event amount 不匹 (差 5%) ──
_testInjectScan(async () => ({ ok: true, events: [{ tx_hash: '0xtest3', from: '0xtaker', amount: 1.5, block: 99999 }] }));
// 50 KAS @ 0.034 = 1.7 USDT, 1.5 vs 1.7 = 11.7% off > 1% tolerance
const r3 = await verifyPaymentForPeer({ peer: PEER2, chain: 'bnb' });
t('3. scan 1 event amount 不匹 → no_match (events>0)', r3.ok === false && r3.reason === 'no_match' && r3.scanned_events === 1, JSON.stringify(r3).slice(0,200));

// ── Test 4: scan 1 event amount 精确匹 ──
// finalizeBuy mock 给 want_usdt = 50 * 0.034 = 1.7. scan event amount = 1.7. tolerance 1% OK.
_testInjectScan(async () => ({ ok: true, events: [{ tx_hash: '0xtest4_real', from: '0xtaker', amount: 1.7, block: 99999 }] }));
dmCaptures = [];
const r4 = await verifyPaymentForPeer({ peer: PEER2, chain: 'bnb' });
t('4. scan amount 匹 → ok=true', r4.ok === true && Array.isArray(r4.matched) && r4.matched.length === 1, JSON.stringify(r4).slice(0,250));
t('4.1 matched payment_tx 是 0xtest4_real', r4.matched?.[0]?.payment_tx === '0xtest4_real');
t('4.2 _pendingAccepts 应被消 (full match)', _hasPendingAccept(PEER2) === false, `_hasPendingAccept=${_hasPendingAccept(PEER2)}`);

// ── Test 5: scan amount 在 1% tolerance 内 (0.99% off) ──
_clearPendingAccepts();
const PEER5 = 'kaspa:qrxw_v2_t5_test';
await finalizeBuy({ user_kasia: PEER5, qty: 50, pay_chain: 'bnb' });
_testInjectScan(async () => ({ ok: true, events: [{ tx_hash: '0xtest5', from: '0xtaker', amount: 1.7 * 1.005, block: 99999 }] }));  // 0.5% over
const r5 = await verifyPaymentForPeer({ peer: PEER5, chain: 'bnb' });
t('5. tolerance 1% 内 (+0.5%) → match', r5.ok === true);

// ── Test 6: scan amount 超 tolerance (+2%) ──
_clearPendingAccepts();
const PEER6 = 'kaspa:qrxw_v2_t6_test';
await finalizeBuy({ user_kasia: PEER6, qty: 50, pay_chain: 'bnb' });
_testInjectScan(async () => ({ ok: true, events: [{ tx_hash: '0xtest6', from: '0xtaker', amount: 1.7 * 1.02, block: 99999 }] }));
const r6 = await verifyPaymentForPeer({ peer: PEER6, chain: 'bnb' });
t('6. tolerance 1% 外 (+2%) → no_match', r6.ok === false && r6.reason === 'no_match');

// ── Test 7: chain 不支持 ──
_clearPendingAccepts();
const PEER7 = 'kaspa:qrxw_v2_t7_test';
await finalizeBuy({ user_kasia: PEER7, qty: 50, pay_chain: 'bnb' });
const r7 = await verifyPaymentForPeer({ peer: PEER7, chain: 'sol' });
t('7. chain=sol → unsupported_chain', r7.ok === false && r7.reason === 'unsupported_chain');

// ── Test 8: missing peer ──
const r8 = await verifyPaymentForPeer({ peer: null, chain: 'bnb' });
t('8. missing peer → missing_peer', r8.ok === false && r8.reason === 'missing_peer');

_testResetPublishOffer();
_testResetScan();
_testResetSendCommand();
console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
