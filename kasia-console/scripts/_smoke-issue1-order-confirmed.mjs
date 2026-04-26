// T-NWT-V2 议 1 smoke — 订单确认 DM 拆 (Owner 要求 #1: 起码的订单确认 UX)
// 验:
// - YES 路径先 enqueue dm_order_confirmed, 再 enqueue dm_pay_instr (FIFO 顺序保证 user 先看确认)
// - dm_order_confirmed 内容含 order#id + 数量 + 链 + "自动检测" 服务者口吻
// - dm_pay_instr 去掉 "✓ 已接单" 前缀, 纯付款指引
// - NO / 取消路径不发 dm_order_confirmed
// - finalize_order tool 路径不发 dm_order_confirmed (LLM 自然话靠 SYSTEM_PROMPT)

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
import { _testInjectExecute, _testReset, getQueueStats } from '../src/services/broker-action-queue.js';

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}  ${info || ''}`); }
};

// mock publish + send (避免真链 / 真 sendCommandAsync)
_testInjectPublishOffer(async (qty) => ({
  ok: true,
  offer_id: `mock_pub_${Math.random().toString(16).slice(2, 6)}`,
  want_usdt: (qty * 0.034).toFixed(4),
  maker_chain_addr: '0xmockBrokerWallet1234567890abcdef12345678',
}));
_testInjectSendCommand(async () => ({ ok: true, txId: 'mock_dm_' + Math.random().toString(16).slice(2, 8) }));

console.log('=== T-NWT-V2 议 1 订单确认 DM 拆 ===\n');

// ── 1. YES 路径先 dm_order_confirmed, 再 dm_pay_instr ──
console.log('-- 1. YES 路径 DM 顺序 + 内容 --');
_clearPendingAccepts(); _clearQuotes(); _testReset();
const dmCalls = [];
_testInjectExecute(async ({ kind, peer, payload }) => {
  dmCalls.push({ kind, msg: payload?.message || '' });
  return { ok: true, txId: 'mock_dm_' + Math.random().toString(16).slice(2, 8) };
});

const PEER_A = 'kaspa:qrxw_i1_a' + 'fghjkl1234567890';
const r1 = await handleBuyIntent(PEER_A, '买 50 KAS');
t('1.1 buy intake → dm_quote', r1 === '' && _hasQuote(PEER_A));

const r2 = await handleBuyIntent(PEER_A, 'YES');
t('1.2 YES → return ""', r2 === '');
t('1.3 _pendingAccepts set', _hasPendingAccept(PEER_A));

await new Promise(r => setTimeout(r, 500));  // queue pump

const dms = dmCalls.filter(d => d.kind === 'dm_order_confirmed' || d.kind === 'dm_pay_instr');
const orderConfirmedIdx = dms.findIndex(d => d.kind === 'dm_order_confirmed');
const payInstrIdx = dms.findIndex(d => d.kind === 'dm_pay_instr');
t('1.4 dm_order_confirmed enqueue', orderConfirmedIdx >= 0, JSON.stringify(dmCalls.map(d => d.kind)));
t('1.5 dm_pay_instr enqueue', payInstrIdx >= 0);
t('1.6 dm_order_confirmed 早于 dm_pay_instr (FIFO)', orderConfirmedIdx < payInstrIdx,
  `confirmed=${orderConfirmedIdx} payinstr=${payInstrIdx}`);

// 内容检查
const confirmedMsg = dms[orderConfirmedIdx]?.msg || '';
t('1.7 dm_order_confirmed 含 "订单已确认"', /订单已确认/.test(confirmedMsg));
t('1.8 dm_order_confirmed 含 order#', /#\w{8}/.test(confirmedMsg), confirmedMsg.slice(0, 100));
t('1.9 dm_order_confirmed 含 数量', /50 KAS/.test(confirmedMsg));
t('1.10 dm_order_confirmed 含 服务者承诺 (自动检测/不用查)', /自动检测|不用你查|马上/.test(confirmedMsg), confirmedMsg.slice(0, 120));

const payInstrMsg = dms[payInstrIdx]?.msg || '';
t('1.11 dm_pay_instr 不含 "✓ 已接单"', !/✓\s*已接单/.test(payInstrMsg));
t('1.12 dm_pay_instr 含 "请.*付:"', /请.*付/.test(payInstrMsg));
t('1.13 dm_pay_instr 服务者口吻 (不用回复/会自动检测)', /不用回复|自动检测/.test(payInstrMsg), payInstrMsg.slice(0, 200));

// ── 2. NO 路径不发 dm_order_confirmed ──
console.log('\n-- 2. NO 取消路径不发 order_confirmed --');
_clearQuotes(); _clearPendingAccepts(); _testReset();
const dmCalls2 = [];
_testInjectExecute(async ({ kind }) => {
  dmCalls2.push({ kind });
  return { ok: true, txId: 'mock_no' };
});
const PEER_B = 'kaspa:qrxw_i1_b' + 'fghjkl1234567890';
await handleBuyIntent(PEER_B, '买 50 KAS');
await handleBuyIntent(PEER_B, 'NO');
await new Promise(r => setTimeout(r, 200));
t('2.1 NO 路径无 dm_order_confirmed', !dmCalls2.some(d => d.kind === 'dm_order_confirmed'));
t('2.2 NO 路径有 dm_quote (取消反馈)', dmCalls2.some(d => d.kind === 'dm_quote'));

// ── 3. finalize_order tool 路径不发 dm_order_confirmed (LLM 接管) ──
console.log('\n-- 3. finalize_order tool 路径 (LLM 接管, 不 deterministic confirm) --');
_clearPendingAccepts(); _testReset();
const dmCalls3 = [];
_testInjectExecute(async ({ kind }) => {
  dmCalls3.push({ kind });
  return { ok: true, txId: 'mock_t' };
});
const PEER_C = 'kaspa:qrxw_i1_c' + 'fghjkl1234567890';
const fr = await finalizeBuy({ user_kasia: PEER_C, qty: 50, pay_chain: 'bnb' });
t('3.1 finalize ok', fr.ok === true);
await new Promise(r => setTimeout(r, 200));
t('3.2 finalize 路径无 dm_order_confirmed (留 J1 议 3 SYSTEM_PROMPT)',
  !dmCalls3.some(d => d.kind === 'dm_order_confirmed'),
  JSON.stringify(dmCalls3.map(d => d.kind)));

// ── 4. 拼单 YES 多 picks confirmed 含 "拼 N 笔" ──
console.log('\n-- 4. 拼单 confirmed 显示 picks 数 --');
_clearPendingAccepts(); _clearQuotes(); _testReset();
const dmCalls4 = [];
_testInjectExecute(async ({ kind, payload }) => {
  dmCalls4.push({ kind, msg: payload?.message || '' });
  return { ok: true, txId: 'mock_m' };
});
// 模拟拼单: _testSetQuote 注入 多 picks
const { _testSetQuote } = await import('../src/services/broker-buy-handler.js');
const PEER_D = 'kaspa:qrxw_i1_d' + 'fghjkl1234567890';
_testSetQuote(PEER_D, {
  picks: [
    { id: 'offer_d1' + 'a'.repeat(30), take_qty: 30, take_usdt: 1.02, maker_addr: '0xMaker1' + 'a'.repeat(34) },
    { id: 'offer_d2' + 'b'.repeat(30), take_qty: 20, take_usdt: 0.68, maker_addr: '0xMaker2' + 'b'.repeat(34) },
  ],
  total_kas: 50,
  total_usdt: 1.70,
  pay_chain: 'bnb',
  expires_at: Date.now() + 5 * 60 * 1000,
});
await handleBuyIntent(PEER_D, 'YES');
await new Promise(r => setTimeout(r, 200));
const confirmed4 = dmCalls4.find(d => d.kind === 'dm_order_confirmed');
t('4.1 拼单 confirmed 存在', !!confirmed4);
t('4.2 拼单 confirmed 含 "拼 2 笔"', /拼 2 笔/.test(confirmed4?.msg || ''), confirmed4?.msg?.slice(0, 150));

_testResetPublishOffer();
_testResetSendCommand();
_testReset();
_clearPendingAccepts();
_clearQuotes();

console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
