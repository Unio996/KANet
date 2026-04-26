// T-J2-NWT-27c PAID_NO_TX_REGEX 扩展验证 (Owner 04-26 15:30 真撞 '已经支付' 漏)
// 沿 _smoke-case3 3.8 范式. 跑现有 + 新加 6 变体.

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
_testInjectSendCommand(async () => ({ ok: true, txid: 'mock_dm_' + Math.random().toString(16).slice(2, 8) }));

console.log('=== T-J2-NWT-27c PAID_NO_TX 扩展 (Owner 漏 + 自然话变体) ===\n');

// 完整变体表 (含 Owner 真撞)
const variants = [
  // 既有 (T-J2-26)
  '已付', '已付！', '已付！！！',
  '付了', '付了。',
  '已转', '转完', '转完了',
  '已支付',
  '已转账',
  '完成', 'done', 'paid', 'sent', 'finished',
  '转好了', '付好了', '搞定',
  'ok 付了', 'OK 付了',
  '已经付了',
  // T-J2-NWT-27c 新加 (Owner 真撞 + 自然话扩)
  '已经支付',         // ← Owner 真撞
  '已经支付!',
  '已经支付。',
  '已经付款',
  '付款了',
  '付款了！',
  '支付了',
  '支付了。',
  '支付完成',
  '支付好了',
  'PAID',             // 大写
  'Paid',             // 首字母大写
];

let edgePass = 0, edgeFail = [];
for (const v of variants) {
  _clearPendingAccepts(); _clearQuotes();
  const PEER = 'kaspa:qrxw_pv_' + Math.random().toString(16).slice(2, 10);
  await finalizeBuy({ user_kasia: PEER, qty: 50, pay_chain: 'bnb' });
  const r = await handleBuyIntent(PEER, v);
  // 期望: PAID_NO_TX 截胡 → return '' + _hasPendingAccept 仍在 (等 tx hash)
  if (r === '' && _hasPendingAccept(PEER)) edgePass++;
  else edgeFail.push({ v, ret: JSON.stringify(r), hasAccept: _hasPendingAccept(PEER) });
}
t(`PAID_NO_TX 全变体 ${edgePass}/${variants.length}`, edgePass === variants.length);
if (edgeFail.length) {
  console.log('\nFAIL detail:');
  for (const f of edgeFail) console.log(`  ✗ "${f.v}" → ret=${f.ret} hasPending=${f.hasAccept}`);
}

// negative: 闲聊 / 含 0x hex 走 PAID_REGEX 不应被截胡
console.log('\n-- negative (不误触发) --');
_clearPendingAccepts();
const PEER_N = 'kaspa:qrxw_n_' + Math.random().toString(16).slice(2, 10);
await finalizeBuy({ user_kasia: PEER_N, qty: 50, pay_chain: 'bnb' });

// '我付了 0xabc...' 应走 PAID_REGEX (不是 PAID_NO_TX) — 期 paid_tx 标记
const txHash = '0x' + 'a'.repeat(64);
const rPaidWithTx = await handleBuyIntent(PEER_N, `我付了 ${txHash}`);
t('negative.1 含 tx hash 走 PAID_REGEX (不误截胡)', rPaidWithTx === '');

// 'hello' 不应触发 PAID_NO_TX 也不应 confirm
_clearPendingAccepts();
const PEER_N2 = 'kaspa:qrxw_n2_' + Math.random().toString(16).slice(2, 10);
await finalizeBuy({ user_kasia: PEER_N2, qty: 50, pay_chain: 'bnb' });
const rNoise = await handleBuyIntent(PEER_N2, 'hello');
t('negative.2 闲聊不命中 PAID_NO_TX (return null fallback LLM)', rNoise === null);

_testResetPublishOffer();
_testResetSendCommand();
_clearPendingAccepts();
_clearQuotes();

console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
