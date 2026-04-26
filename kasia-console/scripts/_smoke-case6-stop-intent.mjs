// case 6 STOP intent broker 层短路 (NWT 接位原任务面)
// 完整 do_not_contact 跨 system 留 v1.1, 这里只验 broker 层 STOP_REGEX 短路 + dm_stop 告别.
//
// 测试矩阵:
// 6.1 STOP 中文变体 (烦死了 / 滚 / 不要再发 / 别打扰 / 不聊了 / 算了不要了 / 再见 / 结束 / 不需要)
// 6.2 STOP 英文变体 (stop / leave me alone / fuck off / go away / bye)
// 6.3 STOP 不动 _pendingAccepts (订单生命周期独立, 已下单不因 STOP 取消)
// 6.4 STOP 不动 _quotes
// 6.5 negative — 闲聊 / buy intent / 询价 不误触 STOP

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

_testInjectPublishOffer(async (qty) => ({
  ok: true, offer_id: `mock_${Math.random().toString(16).slice(2, 6)}`,
  want_usdt: (qty * 0.034).toFixed(4), maker_chain_addr: '0xmockBroker',
}));
_testInjectSendCommand(async () => ({ ok: true, txId: 'mock_dm' }));

console.log('=== case 6 STOP intent broker 层短路 ===\n');

// ── 6.1 STOP 中文变体 ──
console.log('-- 6.1 STOP 中文变体 --');
const cnVariants = [
  '烦死了', '烦死了！', '烦人',
  '别烦我', '不要再发了', '别再发',
  '滚', '滚开', '走开',
  '别打扰', '不想聊', '不聊了',
  '再见', '结束', '不需要', '不需要了',
  '算了不要了',
];
let cnPass = 0, cnFail = [];
for (const v of cnVariants) {
  _clearQuotes(); _clearPendingAccepts();
  const PEER = 'kaspa:qrxw_stop_cn_' + Math.random().toString(16).slice(2, 8);
  const r = await handleBuyIntent(PEER, v);
  if (r === '') cnPass++;
  else cnFail.push({ v, r });
}
t(`6.1 STOP 中文 ${cnPass}/${cnVariants.length}`, cnPass === cnVariants.length);
if (cnFail.length) console.log('  fail:', JSON.stringify(cnFail).slice(0, 200));

// ── 6.2 STOP 英文变体 ──
console.log('\n-- 6.2 STOP 英文变体 --');
const enVariants = [
  'stop', 'STOP', 'leave me alone',
  'fuck off', 'go away', 'bye',
];
let enPass = 0, enFail = [];
for (const v of enVariants) {
  _clearQuotes(); _clearPendingAccepts();
  const PEER = 'kaspa:qrxw_stop_en_' + Math.random().toString(16).slice(2, 8);
  const r = await handleBuyIntent(PEER, v);
  if (r === '') enPass++;
  else enFail.push({ v, r });
}
t(`6.2 STOP 英文 ${enPass}/${enVariants.length}`, enPass === enVariants.length);
if (enFail.length) console.log('  fail:', JSON.stringify(enFail).slice(0, 200));

// ── 6.3 STOP 不动 _pendingAccepts (订单独立) ──
console.log('\n-- 6.3 STOP 不动 active 订单 --');
_clearPendingAccepts();
const PEER_C = 'kaspa:qrxw_stop_c' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_C, {
  picks: [{ id: 'offer_c', take_qty: 50, take_usdt: 1.7, paid_tx: null }],
  total_kas: 50, total_usdt: 1.7, pay_chain: 'bnb',
  expires_at: Date.now() + 30 * 60 * 1000,
});
const r63 = await handleBuyIntent(PEER_C, '烦死了');
t('6.3.1 STOP 命中 ack', r63 === '');
t('6.3.2 _pendingAccepts 仍在 (订单不被 STOP 取消)', _hasPendingAccept(PEER_C));

// ── 6.4 STOP 不动 _quotes (报价独立, 但用户烦了你也别 push) ──
// 实际上 STOP 不动 _quotes 是当前实现 (5min 过期自动清). 用户重新下单或直接 fall LLM.
console.log('\n-- 6.4 STOP 不动 _quotes --');
_clearQuotes();
const PEER_D = 'kaspa:qrxw_stop_d' + 'fghjkl1234567890';
_testSetQuote(PEER_D, {
  picks: [{ id: 'offer_d', take_qty: 10, take_usdt: 0.34, maker_addr: '0x...' }],
  total_kas: 10, total_usdt: 0.34, pay_chain: 'bnb',
  expires_at: Date.now() + 5 * 60 * 1000,
});
const r64 = await handleBuyIntent(PEER_D, 'bye');
t('6.4.1 STOP 命中 ack', r64 === '');
t('6.4.2 _quotes 仍在 (报价独立 5min TTL 自清)', _hasQuote(PEER_D));

// ── 6.5 negative — 闲聊 / buy / 询价 不误触 STOP ──
console.log('\n-- 6.5 negative (不误触 STOP) --');
_clearQuotes(); _clearPendingAccepts();
const negs = [
  { msg: 'hello', expectStop: false },
  { msg: '你好', expectStop: false },
  { msg: '买 50 KAS', expectStop: false },        // BUY_REGEX 命中
  { msg: '现在kas多少钱', expectStop: false },     // PRICE_QUERY 命中 (含 kas 关键字)
  { msg: '怎么用', expectStop: false },
  { msg: 'NO', expectStop: false },                // CANCEL 词不是 STOP
];
let negPass = 0;
for (const { msg, expectStop } of negs) {
  _clearQuotes(); _clearPendingAccepts();
  const PEER = 'kaspa:qrxw_neg_' + Math.random().toString(16).slice(2, 8);
  const r = await handleBuyIntent(PEER, msg);
  // 期望: 不命中 STOP_REGEX. 若 r==='' 可能是别的短路 (PRICE_QUERY / BUY 命中 _quotes set), 看 _hasQuote 判
  // 简单判: STOP 不应导致 dm_stop send. 这里粗判 r 是否 null (fall LLM = 没 STOP) 或 '' (短路, 但可能是 PRICE 等)
  // 详细分: 'hello'/'你好'/'怎么用' 应 fall LLM (return null); 'NO' 没 quote → null; '买 50 KAS' → '' (BUY 路径)
  // '现在多少钱' → '' (PRICE_QUERY)
  if (msg === '买 50 KAS' || msg === '现在kas多少钱') {
    if (r === '') negPass++;  // 这两个走短路也 OK
    else console.log(`    ✗ "${msg}" → ${r}`);
  } else {
    if (r === null) negPass++;
    else console.log(`    ✗ "${msg}" → ${r} (期望 fall LLM null, 实际 ${JSON.stringify(r)})`);
  }
}
t(`6.5 negative ${negPass}/${negs.length} 不误触 STOP`, negPass === negs.length);

_testResetPublishOffer();
_testResetSendCommand();
_clearQuotes();
_clearPendingAccepts();

console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
