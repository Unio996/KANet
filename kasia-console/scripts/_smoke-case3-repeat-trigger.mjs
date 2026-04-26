// case 3 类 4 重复触发 — J1 转 J2 (T-J2-26 + T-J1-19n 互补验证)
// 测 Owner 真测撞的 multi-turn 场景 + publish 层 idempotency.
//
// 测试矩阵:
// 3.1 同 peer 重复 finalizeBuy 5min 内 → 入口幂等拒 (T-J2-26)
// 3.2 同 peer YES 后没付又下单 → 入口幂等拒 (T-J2-26 + Owner 真撞场景)
// 3.3 不同 peer 同 chain+qty 5min 内 → broker_dynamic publish 层复用 same offer (T-J1-19n)
// 3.4 不同 peer 不同 qty → 各自新 publish 不复用
// 3.5 PAID_NO_TX_REGEX 截胡 + 后续 PAID_REGEX 自动验证 (走完整 finalize→已付!→0xtx 路径)
// 3.6 在 _pendingAccepts 状态下 PAID_NO_TX_REGEX 命中 → 不消 _pendingAccepts (等 tx hash)
// 3.7 用户取消 (NO) 后 _pendingAccepts 应被消 → 后续可重新 finalize

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
  _testSetPendingAccept,
} from '../src/services/broker-buy-handler.js';

let pass = 0, fail = 0, skip = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}  ${info || ''}`); }
};

let publishCalls = 0;
let lastPublishArgs = null;
const mockPublish = async (qty, chain) => {
  publishCalls++;
  lastPublishArgs = { qty, chain };
  return {
    ok: true,
    offer_id: `mock_pub_${publishCalls}_${Math.random().toString(16).slice(2,6)}`,
    want_usdt: (qty * 0.034).toFixed(4),
    maker_chain_addr: '0xmockBrokerWallet',
    mid_price: 0.0337,
    sell_price: 0.0340,
  };
};
_testInjectPublishOffer(mockPublish);
_testInjectSendCommand(async () => ({ ok: true, txid: 'mock_dm_' + Math.random().toString(16).slice(2,8) }));

console.log('=== case 3 类 4 重复触发 (T-J2-26 + T-J1-19n 互补) ===\n');

// ── 3.1 同 peer 重复 finalizeBuy 5min 内 ──
console.log('-- 3.1 同 peer 重复 finalize, 入口幂等 --');
_clearPendingAccepts(); _clearQuotes();
const PEER_A = 'kaspa:qrxw' + 'mock_a' + 'fghjkl1234567890';
const r311 = await finalizeBuy({ user_kasia: PEER_A, qty: 50, pay_chain: 'bnb' });
t('3.1.1 第 1 次 finalize ok', r311.ok === true);
const r312 = await finalizeBuy({ user_kasia: PEER_A, qty: 50, pay_chain: 'bnb' });
t('3.1.2 第 2 次 finalize 入口幂等拒', r312.ok === false && r312.error === 'already_in_pending_accept', JSON.stringify(r312).slice(0,150));
const r313 = await finalizeBuy({ user_kasia: PEER_A, qty: 100, pay_chain: 'bnb' });  // 不同 qty 也应拒 (peer 已有 active)
t('3.1.3 同 peer 不同 qty 也拒 (peer-level 锁)', r313.ok === false && r313.error === 'already_in_pending_accept', JSON.stringify(r313).slice(0,150));

// ── 3.2 同 peer YES 之后没付又来 (Owner 真撞) ──
console.log('\n-- 3.2 Owner 真撞: YES 后没付又下单 --');
// Owner 路径: 已经走过 LLM tool finalize_order, _pendingAccepts 已 set (T-J2-26 修).
// 再发 '想买 55' 走 LLM tool 又调 finalizeBuy → 应拒 (3.1 已验)
// 这里直接验 _pendingAccepts 状态在: 即使 _hasPendingAccept(PEER_A), 任何 finalizeBuy 都拒
t('3.2.1 _hasPendingAccept(PEER_A) true', _hasPendingAccept(PEER_A) === true);

// ── 3.3 不同 peer 同 chain+qty 5min 内 — publish 层复用 ──
console.log('\n-- 3.3 不同 peer 同 chain+qty publish 复用 (T-J1-19n) --');
// T-J1-19n 是 SQL select existing open broker_dynamic_quote, 我们 mock 了 publish 跳过,
// 所以这里需要直接验 _aggregateWithFallback 调用次数.
// 实际复用是 SQL 层, 这里 smoke 用 mockPublish 只能验"不同 peer 同 chain+qty 都触发 finalize ok"
publishCalls = 0;
_clearPendingAccepts(); _clearQuotes();
const PEER_B = 'kaspa:qrxw' + 'mock_b' + 'fghjkl1234567890';
const PEER_C = 'kaspa:qrxw' + 'mock_c' + 'fghjkl1234567890';
const r331 = await finalizeBuy({ user_kasia: PEER_B, qty: 50, pay_chain: 'bnb' });
const callsAfterB = publishCalls;
const r332 = await finalizeBuy({ user_kasia: PEER_C, qty: 50, pay_chain: 'bnb' });
const callsAfterC = publishCalls;
t('3.3.1 PEER_B finalize ok, _pendingAccepts set', r331.ok && _hasPendingAccept(PEER_B));
t('3.3.2 PEER_C 同 chain+qty finalize ok (cross-peer 不撞入口幂等)', r332.ok && _hasPendingAccept(PEER_C));
// note: SQL 复用 真验需要走 _brokerPublishKasOffer 真实路径 (not mock). 集成测验.
console.log(`  (publish mock 调 ${callsAfterC} 次. 真 SQL 复用需 integration 测.)`);

// ── 3.4 不同 peer 不同 qty 各自新 publish ──
console.log('\n-- 3.4 不同 peer 不同 qty 各自 publish --');
publishCalls = 0;
_clearPendingAccepts();
const PEER_D = 'kaspa:qrxw' + 'mock_d' + 'fghjkl1234567890';
const PEER_E = 'kaspa:qrxw' + 'mock_e' + 'fghjkl1234567890';
await finalizeBuy({ user_kasia: PEER_D, qty: 50, pay_chain: 'bnb' });
await finalizeBuy({ user_kasia: PEER_E, qty: 100, pay_chain: 'bnb' });
t('3.4.1 不同 qty 都 finalize ok', _hasPendingAccept(PEER_D) && _hasPendingAccept(PEER_E));

// ── 3.5 PAID_NO_TX_REGEX 截胡 + 后续 PAID_REGEX 自动验证 ──
console.log('\n-- 3.5 完整支付反馈链路 --');
_clearPendingAccepts();
const PEER_F = 'kaspa:qrxw' + 'mock_f' + 'fghjkl1234567890';
await finalizeBuy({ user_kasia: PEER_F, qty: 50, pay_chain: 'bnb' });
const r351 = await handleBuyIntent(PEER_F, '已付!');
t('3.5.1 "已付!" 截胡 (PAID_NO_TX_REGEX)', r351 === '');
t('3.5.2 _pendingAccepts 仍在 (等 tx hash)', _hasPendingAccept(PEER_F));
const r353 = await handleBuyIntent(PEER_F, '我付了 0x' + 'a'.repeat(64));
t('3.5.3 后续 "我付了 0x..." 走 PAID_REGEX', r353 === '');
// 验 picks[0].paid_tx 已 set (走完整路径)
const accept = await import('../src/services/broker-buy-handler.js').then(m => {
  // 直接探内部状态: 用 _testSetPendingAccept 检测? 实际只能间接检测 — _hasPendingAccept 还在 (因为 picks 不全 paid)
  return null;
});

// ── 3.6 PAID_NO_TX 后再发 PAID_NO_TX 仍触发 (引导持续) ──
console.log('\n-- 3.6 反复发 "已付" 引导持续 --');
_clearPendingAccepts();
const PEER_G = 'kaspa:qrxw' + 'mock_g' + 'fghjkl1234567890';
await finalizeBuy({ user_kasia: PEER_G, qty: 50, pay_chain: 'bnb' });
let r361 = null, r362 = null;
r361 = await handleBuyIntent(PEER_G, '已付!');
r362 = await handleBuyIntent(PEER_G, 'paid');
t('3.6.1 多次 PAID_NO_TX 都截胡 (持续引导)', r361 === '' && r362 === '');
t('3.6.2 _pendingAccepts 仍在', _hasPendingAccept(PEER_G));

// ── 3.7 用户取消 (NO) 后 _pendingAccepts 消, 可重新 finalize ──
console.log('\n-- 3.7 用户 NO 取消后清状态 --');
_clearPendingAccepts(); _clearQuotes();
const PEER_H = 'kaspa:qrxw' + 'mock_h' + 'fghjkl1234567890';
await finalizeBuy({ user_kasia: PEER_H, qty: 50, pay_chain: 'bnb' });
t('3.7.1 finalize ok', _hasPendingAccept(PEER_H));
// 用户在 quote 阶段发 NO: handleBuyIntent line 303 CANCEL_WORDS 处理 _quotes 不是 _pendingAccepts
// _pendingAccepts 只能等 expiry (30min) — 这是当前实现, 不变. T-J2-26 不动 NO 路径.
// (注: NO 走 _quotes 删 + cancel 报价. _pendingAccepts 是 YES 之后的状态, NO 不影响.)
// 实际场景: 用户已经 YES + 没付 + 想取消 — 当前没 protocol cancel 入口. 这个 v1.1 任务.
console.log('  (NO 在 quote 阶段, _pendingAccepts 不被 NO 清, 等 30min expiry. v1.1 加 user cancel.)');
skip++;
console.log('  (3.7.2 user cancel after YES — v1.1 待加, skip)');

// ── 3.8 PAID_NO_TX 各种边界变体 (中英混合 / 空格 / 标点) ──
console.log('\n-- 3.8 PAID_NO_TX edge cases --');
_clearPendingAccepts();
const variants = [
  '已付',           // bare
  '已付！！！',      // multi 标点
  '付了。',         // 句号
  '已转账',
  '完成',
  'PAID',           // 大写
  'done',
  '搞定',
  '已经付了',
  '付好了',
];
let edgePass = 0, edgeTested = 0;
for (const v of variants) {
  const PEER = 'kaspa:qrxw_edge_' + Math.random().toString(16).slice(2,10);
  await finalizeBuy({ user_kasia: PEER, qty: 50, pay_chain: 'bnb' });
  const r = await handleBuyIntent(PEER, v);
  edgeTested++;
  if (r === '' && _hasPendingAccept(PEER)) edgePass++;
  else console.log(`    ✗ "${v}" → ${JSON.stringify(r)} _hasPending=${_hasPendingAccept(PEER)}`);
}
t(`3.8 PAID_NO_TX edge ${edgePass}/${edgeTested}`, edgePass === edgeTested);

// ── 3.9 negative — 闲聊不应触发 PAID_NO_TX 也不应触发幂等错 ──
console.log('\n-- 3.9 negative (闲聊不误触发) --');
_clearPendingAccepts();
const PEER_K = 'kaspa:qrxw' + 'mock_k' + 'fghjkl1234567890';
await finalizeBuy({ user_kasia: PEER_K, qty: 50, pay_chain: 'bnb' });
const negs = ['什么情况', '怎么办', '?', 'hello', 'OK 现在?'];
let negPass = 0;
for (const n of negs) {
  const r = await handleBuyIntent(PEER_K, n);
  // 期望: PAID_NO_TX 不匹 + PAID_REGEX 不匹 + BUY_REGEX 不匹 → return null fallback LLM
  if (r === null) negPass++;
  else console.log(`    ✗ "${n}" → ${JSON.stringify(r)}`);
}
t(`3.9 negative ${negPass}/${negs.length} 都 fallback null`, negPass === negs.length);

_testResetPublishOffer();
_testResetSendCommand();
console.log(`\n=== ${pass} pass, ${fail} fail, ${skip} skip ===`);
process.exit(fail === 0 ? 0 : 1);
