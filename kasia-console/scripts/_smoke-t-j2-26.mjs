// T-J2-26 smoke: verify three fixes in broker-buy-handler.js
// 1. PAID_NO_TX_REGEX 触发 (已付/paid/搞定 等无 tx hash)
// 2. finalizeBuy 幂等 (peer 已 _pendingAccepts → 拒)
// 3. finalizeBuy 走通后 set _pendingAccepts → 后续 0xtx 能被 PAID_REGEX 匹配

import {
  finalizeBuy,
  handleBuyIntent,
  _testInjectPublishOffer,
  _testResetPublishOffer,
  _testInjectSendCommand,
  _testResetSendCommand,
  _hasPendingAccept,
  _clearPendingAccepts,
  _clearQuotes,
} from '../src/services/broker-buy-handler.js';

let dmCaptured = [];
const captureSend = async (relayId, cmd) => {
  // _qDm wraps via broker-action-queue → enqueue → eventually _send.
  // For smoke we override at _send level (relay-manager.sendCommandAsync).
  // Simpler: capture via _testInjectSendCommand which broker-action-queue uses indirectly.
  dmCaptured.push({ relayId, cmd });
  return { ok: true, txid: 'mock_tx_' + Math.random().toString(16).slice(2,10) };
};

// We need to intercept the broker-action-queue layer. But for smoke we mainly check return values + _hasPendingAccept.

const PEER = 'kaspa:qrxw' + 'mock' + 'peerasd' + 'fghjkl1234567890';

// Mock _brokerPublishKasOffer to skip real /api/exchange/publish
_testInjectPublishOffer(async (qty, chain) => ({
  ok: true,
  offer_id: 'mock_offer_' + Math.random().toString(16).slice(2,8),
  want_usdt: (qty * 0.034).toFixed(4),
  maker_chain_addr: '0xmockBrokerWallet',
  mid_price: 0.0337,
  sell_price: 0.0340,
}));
_testInjectSendCommand(captureSend);

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}  ${info || ''}`); }
};

// ── Test 1: clean state, finalizeBuy 应 ok + set _pendingAccepts ──
_clearPendingAccepts();
_clearQuotes();
const r1 = await finalizeBuy({ user_kasia: PEER, qty: 55, pay_chain: 'bnb' });
t('finalizeBuy 1st call ok', r1.ok === true, JSON.stringify(r1).slice(0,200));
t('finalizeBuy 1st sets _pendingAccepts', _hasPendingAccept(PEER) === true);

// ── Test 2: 幂等 — 同 peer 再调 finalizeBuy 应拒 ──
const r2 = await finalizeBuy({ user_kasia: PEER, qty: 55, pay_chain: 'bnb' });
t('finalizeBuy 2nd call rejected', r2.ok === false && r2.error === 'already_in_pending_accept', JSON.stringify(r2).slice(0,200));

// ── Test 3: PAID_NO_TX_REGEX 触发 — 用户回 "已付！" 应进 dm_paid_no_tx 路径, 不调 finalize_order ──
_clearPendingAccepts();
_clearQuotes();
await finalizeBuy({ user_kasia: PEER, qty: 55, pay_chain: 'bnb' });  // setup _pendingAccepts
dmCaptured.length = 0;
const r3 = await handleBuyIntent(PEER, '已付！');
t('handleBuyIntent "已付!" returns ""', r3 === '', `got: ${JSON.stringify(r3)}`);
// dm_paid_no_tx 通过 _qDm → broker-action-queue → 实际 send. 我们直接看 broker-action-queue stats?
// 实际测最直接看 _pendingAccepts 没被 delete + 没下新单
t('handleBuyIntent "已付!" 不消 _pendingAccepts (等 tx)', _hasPendingAccept(PEER) === true);

// ── Test 4: 各种 PAID_NO_TX 变体匹配 ──
const variants = ['已付', '已付！', '付了', '已转', '转完', 'paid', 'PAID', 'done', 'sent', '搞定', '已经付了', '付好了'];
let variantPass = 0;
for (const v of variants) {
  _clearPendingAccepts();
  await finalizeBuy({ user_kasia: PEER + v, qty: 55, pay_chain: 'bnb' });
  const r = await handleBuyIntent(PEER + v, v);
  if (r === '' && _hasPendingAccept(PEER + v)) variantPass++;
}
t(`PAID_NO_TX 变体 ${variantPass}/${variants.length} 全匹配`, variantPass === variants.length);

// ── Test 5: 含 tx hash 不应误匹配 PAID_NO_TX (走原 PAID_REGEX 路径) ──
const PEER_TX = 'kaspa:qrtx' + 'mocktest' + 'fghjkl1234567890';
_clearPendingAccepts();
await finalizeBuy({ user_kasia: PEER_TX, qty: 55, pay_chain: 'bnb' });
const r5 = await handleBuyIntent(PEER_TX, '我付了 0x' + 'a'.repeat(64));
t('PAID_REGEX 0xtx 走自动验证路径 (返 "")', r5 === '');
// _pendingAccepts.picks[0].paid_tx 应该被 set
t('PAID_REGEX 0xtx 标记 paid_tx', _hasPendingAccept(PEER_TX) === true);

// ── Test 6: 闲聊不应误匹配 ──
_clearPendingAccepts();
await finalizeBuy({ user_kasia: PEER + 'chat', qty: 55, pay_chain: 'bnb' });
const r6 = await handleBuyIntent(PEER + 'chat', '什么情况');
t('"什么情况" 不匹配 PAID_NO_TX (返 null fallback LLM)', r6 === null, `got: ${JSON.stringify(r6)}`);

_testResetPublishOffer();
_testResetSendCommand();
console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
