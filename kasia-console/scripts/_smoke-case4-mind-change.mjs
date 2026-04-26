// case 4 改主意 (T-J1-19l 主验) — sell pending 状态 buy intent override + NO 取消变体
// 沿 _smoke-case3 范式: mock injection, 纯逻辑, 不真链上不真 enqueue pump.
//
// 测试矩阵:
// 4.1 sell pending 状态 → '买 X KAS' 中文 → _pending.delete + return null (T-J1-19l 核心)
// 4.2 sell pending 状态 → 各种 BUY_OVERRIDE 变体 (买/buy/想买/购买/搞/弄/想要/我要 + 数字)
// 4.3 sell pending 状态 → 闲聊 (negative) → 不 override, 仍 ask BSC 地址
// 4.4 buy quote 状态 → 'NO' → _quotes.delete (取消报价路径)
// 4.5 buy quote 状态 → CANCEL_WORDS 各变体 (NO/no/n/取消/不要/算了)
// 4.6 buy pendingAccept 状态 → 'NO' → _pendingAccepts 不被消 (current behavior, v1.1 加 cancel)
// 4.7 sell pending → CANCEL_WORDS → _pending.delete + 取消提示

import {
  handleSellIntent,
  _testClearPending,
  _hasPending,
} from '../src/services/broker-sell-handler.js';
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
} from '../src/services/broker-buy-handler.js';

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}  ${info || ''}`); }
};

// mock publish + send (避免真 fetch / 真 sendCommandAsync)
let publishCalls = 0;
_testInjectPublishOffer(async (qty, chain) => {
  publishCalls++;
  return {
    ok: true,
    offer_id: `mock_pub_${publishCalls}_${Math.random().toString(16).slice(2, 6)}`,
    want_usdt: (qty * 0.034).toFixed(4),
    maker_chain_addr: '0xmockBrokerWallet',
  };
});
_testInjectSendCommand(async () => ({ ok: true, txid: 'mock_dm_' + Math.random().toString(16).slice(2, 8) }));

console.log('=== case 4 改主意 (T-J1-19l + NO 取消变体) ===\n');

// ── 4.1 sell pending → '买 50 KAS' 中文 override (T-J1-19l 核心) ──
console.log('-- 4.1 sell pending → buy override 中文核心 --');
_testClearPending(); _clearQuotes(); _clearPendingAccepts();
const PEER_A = 'kaspa:qrxw' + 'mock_4a' + 'fghjkl1234567890';
const r411 = await handleSellIntent(PEER_A, '卖 5 KAS');
t('4.1.1 sell intake → ask_state=pay_addr, _hasPending true', r411 === '' && _hasPending(PEER_A));
const r412 = await handleSellIntent(PEER_A, '买 50 KAS');
t('4.1.2 buy override → return null (fall to buy/LLM)', r412 === null);
t('4.1.3 sell _pending 已清', !_hasPending(PEER_A));

// ── 4.2 BUY_OVERRIDE_REGEX 各变体 ──
console.log('\n-- 4.2 BUY_OVERRIDE 变体覆盖 --');
const buyVariants = [
  '买 50 KAS',
  'buy 50 KAS',
  '想买 30 KAS',
  '要买 20 KAS',
  '购买 10 KAS',
  '想换 50 KAS',
  '搞 20 个 KAS',
  '弄 10 KAS',
  '来点 50 KAS',
  '想要 30 KAS',
  '我要 40 KAS',
];
let varPass = 0;
for (const v of buyVariants) {
  _testClearPending(); _clearQuotes(); _clearPendingAccepts();
  const PEER = 'kaspa:qrxw_v_' + Math.random().toString(16).slice(2, 10);
  await handleSellIntent(PEER, '卖 5 KAS');
  if (!_hasPending(PEER)) { console.log(`    ✗ "${v}" sell intake fail`); continue; }
  const r = await handleSellIntent(PEER, v);
  if (r === null && !_hasPending(PEER)) varPass++;
  else console.log(`    ✗ "${v}" override fail: ret=${JSON.stringify(r)} _hasPending=${_hasPending(PEER)}`);
}
t(`4.2 BUY_OVERRIDE 变体 ${varPass}/${buyVariants.length}`, varPass === buyVariants.length);

// ── 4.3 sell pending → 闲聊 negative → 不 override ──
console.log('\n-- 4.3 sell pending negative (闲聊不 override) --');
_testClearPending(); _clearQuotes(); _clearPendingAccepts();
const PEER_C = 'kaspa:qrxw' + 'mock_4c' + 'fghjkl1234567890';
await handleSellIntent(PEER_C, '卖 5 KAS');
const negs = ['hello', '什么', '?', 'OK', '怎么办'];
let negPass = 0;
for (const n of negs) {
  const r = await handleSellIntent(PEER_C, n);
  // 期望: 进 ask_state pay_addr 分支 → 'pending && pay_addr' 路径 → invalid addr → return ''
  // _hasPending 仍 true (没被 override 也没被 cancel)
  if (r === '' && _hasPending(PEER_C)) negPass++;
  else console.log(`    ✗ "${n}" → ret=${JSON.stringify(r)} _hasPending=${_hasPending(PEER_C)}`);
}
t(`4.3 negative 闲聊不 override ${negPass}/${negs.length}`, negPass === negs.length);

// ── 4.4 buy quote 状态 → NO → _quotes 删 ──
console.log('\n-- 4.4 buy quote 状态 NO 取消 --');
_testClearPending(); _clearQuotes(); _clearPendingAccepts();
const PEER_D = 'kaspa:qrxw' + 'mock_4d' + 'fghjkl1234567890';
const r441 = await handleBuyIntent(PEER_D, '买 50 KAS');
t('4.4.1 BUY_REGEX 命中 → _hasQuote true', r441 === '' && _hasQuote(PEER_D));
const r442 = await handleBuyIntent(PEER_D, 'NO');
t('4.4.2 NO 取消 → _hasQuote false', r442 === '' && !_hasQuote(PEER_D));

// ── 4.5 CANCEL_WORDS 各变体 ──
console.log('\n-- 4.5 CANCEL_WORDS 变体覆盖 --');
const cancelVariants = ['NO', 'no', 'n', '取消', '不要', '算了'];
let cancelPass = 0;
for (const c of cancelVariants) {
  _clearQuotes(); _clearPendingAccepts();
  const PEER = 'kaspa:qrxw_c_' + Math.random().toString(16).slice(2, 10);
  await handleBuyIntent(PEER, '买 50 KAS');
  if (!_hasQuote(PEER)) { console.log(`    ✗ "${c}" quote 没 set`); continue; }
  const r = await handleBuyIntent(PEER, c);
  if (r === '' && !_hasQuote(PEER)) cancelPass++;
  else console.log(`    ✗ "${c}" → ret=${JSON.stringify(r)} _hasQuote=${_hasQuote(PEER)}`);
}
t(`4.5 CANCEL_WORDS 变体 ${cancelPass}/${cancelVariants.length}`, cancelPass === cancelVariants.length);

// ── 4.6 buy _pendingAccepts 状态 → NO → _pendingAccepts 不消 (current, v1.1 加 cancel) ──
console.log('\n-- 4.6 _pendingAccepts 状态 NO (v1.1 加 cancel, 当前 doc) --');
_clearQuotes(); _clearPendingAccepts();
const PEER_F = 'kaspa:qrxw' + 'mock_4f' + 'fghjkl1234567890';
await finalizeBuy({ user_kasia: PEER_F, qty: 50, pay_chain: 'bnb' });
t('4.6.1 finalize 后 _hasPendingAccept', _hasPendingAccept(PEER_F));
const r462 = await handleBuyIntent(PEER_F, 'NO');
// 当前: NO 在 _quotes 阶段处理, 没 _quotes → fall through → BUY_REGEX 不命中 → 不进 BUY_REGEX 分支 →
// PAID 检测 nextUnpaid 但 PAID_REGEX 不匹 → ... 最终 return null (fallback LLM)
// _pendingAccepts 仍在 — 验当前行为不退化
t('4.6.2 NO 不动 _pendingAccepts (v1.1 待加 user-cancel)', _hasPendingAccept(PEER_F));

// ── 4.7 sell pending → CANCEL_WORDS → _pending.delete ──
console.log('\n-- 4.7 sell pending CANCEL --');
_testClearPending(); _clearQuotes(); _clearPendingAccepts();
const sellCancels = ['NO', 'no', '取消', '不要', '算了'];
let sellCancelPass = 0;
for (const c of sellCancels) {
  _testClearPending();
  const PEER = 'kaspa:qrxw_sc_' + Math.random().toString(16).slice(2, 10);
  await handleSellIntent(PEER, '卖 5 KAS');
  if (!_hasPending(PEER)) { console.log(`    ✗ "${c}" sell intake fail`); continue; }
  const r = await handleSellIntent(PEER, c);
  if (r === '' && !_hasPending(PEER)) sellCancelPass++;
  else console.log(`    ✗ "${c}" → ret=${JSON.stringify(r)} _hasPending=${_hasPending(PEER)}`);
}
t(`4.7 sell CANCEL 变体 ${sellCancelPass}/${sellCancels.length}`, sellCancelPass === sellCancels.length);

_testResetPublishOffer();
_testResetSendCommand();
_testClearPending();
_clearQuotes();
_clearPendingAccepts();

console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
