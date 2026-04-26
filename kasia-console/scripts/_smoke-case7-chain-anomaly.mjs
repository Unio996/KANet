// case 7 链异常 (NWT 接位原任务面 J1 76742556 标"高风险三方共跑")
// 代码层 mock 测试 — 真付错款由 Owner 知情后三方共跑.
//
// 测试矩阵 (链异常 7 类):
// 7.1 USDT amount 不匹配 (user 付少了 / 多了 / 错币种)
// 7.2 收款地址不匹配 (user 转给别的 maker)
// 7.3 链不匹配 (user 选 BSC 但真转 ETH)
// 7.4 cross-chain RPC 全挂 → scan_failed → broker 不擅自删 _pendingAccepts
// 7.5 多笔 partial — 一笔匹一笔不匹
// 7.6 同一 tx 重复匹 (防重)
// 7.7 amount tolerance ± 1% 边界

import {
  _testSetPendingAccept,
  _hasPendingAccept,
  _clearPendingAccepts,
  _testInjectScan,
  _testResetScan,
  verifyPaymentForPeer,
  _getPendingAccept,
} from '../src/services/broker-buy-handler.js';
import { _testInjectExecute, _testReset } from '../src/services/broker-action-queue.js';

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}  ${info || ''}`); }
};

_testInjectExecute(async () => ({ ok: true, txId: 'mock_' + Math.random().toString(16).slice(2, 8) }));

console.log('=== case 7 链异常 mock 测 (NWT 高风险任务面) ===\n');

// ── 7.1 amount 不匹 (user 付少 / 多 / 错币种) ──
console.log('-- 7.1 amount mismatch --');
_clearPendingAccepts();
const PEER_A = 'kaspa:qrxw_ca_a' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_A, {
  picks: [{ id: 'offer_a', take_qty: 50, take_usdt: 1.7000, paid_tx: null }],
  total_kas: 50, total_usdt: 1.7, pay_chain: 'bnb',
  expires_at: Date.now() + 30 * 60 * 1000,
});
_testInjectScan(async () => ({
  ok: true,
  events: [
    { tx_hash: '0x' + 'a'.repeat(64), from: '0xUser', amount: 0.5, block: 1 },  // 付少 (0.5 vs 1.7)
    { tx_hash: '0x' + 'b'.repeat(64), from: '0xUser', amount: 5.0, block: 2 },  // 付多 (5.0 vs 1.7)
  ],
  head_block: 100, span_blocks: 1500, recipient: '', asset: 'usdt', chain: 'bnb',
}));
const r71 = await verifyPaymentForPeer({ peer: PEER_A, chain: 'bnb' });
t('7.1.1 amount 全不匹 (0.5 / 5.0 vs 期 1.7) → no_match', r71.ok === false && r71.reason === 'no_match');
t('7.1.2 _pendingAccepts 不动 (no_match 不删)', _hasPendingAccept(PEER_A));

// ── 7.2 收款地址不匹 (user 转给别 maker) ──
// 这场景: scanRecentTransfers 已经 filter recipient = broker BSC addr (cross-chain-verify line 147).
// 转给别人不会出现在 events 里. mock 直接返空 events 模拟扫不到.
console.log('\n-- 7.2 转错收款地址 (scan 不到) --');
_clearPendingAccepts();
const PEER_B = 'kaspa:qrxw_ca_b' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_B, {
  picks: [{ id: 'offer_b', take_qty: 50, take_usdt: 1.7, paid_tx: null }],
  total_kas: 50, total_usdt: 1.7, pay_chain: 'bnb',
  expires_at: Date.now() + 30 * 60 * 1000,
});
_testInjectScan(async () => ({ ok: true, events: [], head_block: 100, span_blocks: 1500, recipient: '', asset: 'usdt', chain: 'bnb' }));
const r72 = await verifyPaymentForPeer({ peer: PEER_B, chain: 'bnb' });
t('7.2.1 转错地址 (扫不到 incoming) → no_match', !r72.ok && r72.reason === 'no_match');
t('7.2.2 user_msg 提示等 confirmation 或发 hash', /还没看到任何 USDT 入账|tx 可能还没确认/.test(r72.user_msg || ''), (r72.user_msg || '').slice(0, 100));

// ── 7.3 链不匹 (user 选 BSC 但真转 ETH) ──
// scanRecentTransfers 按 chain=bnb 只扫 BSC. ETH 链转账自然扫不到.
console.log('\n-- 7.3 链不匹 (user 选 BSC 真转 ETH) --');
_clearPendingAccepts();
const PEER_C = 'kaspa:qrxw_ca_c' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_C, {
  picks: [{ id: 'offer_c', take_qty: 50, take_usdt: 1.7, paid_tx: null }],
  total_kas: 50, total_usdt: 1.7, pay_chain: 'bnb',  // 单子是 BSC
  expires_at: Date.now() + 30 * 60 * 1000,
});
_testInjectScan(async ({ chain }) => ({ ok: true, events: [], head_block: 100, span_blocks: 1500, recipient: '', asset: 'usdt', chain }));
const r73 = await verifyPaymentForPeer({ peer: PEER_C, chain: 'bnb' });  // 当 user 选错链回 BSC
t('7.3 BSC 扫不到 (user 真转 ETH) → no_match', !r73.ok && r73.reason === 'no_match');

// ── 7.4 RPC 全挂 (scan_failed) — 不擅自删 _pendingAccepts ──
console.log('\n-- 7.4 RPC 全挂, broker 兜底不破坏状态 --');
_clearPendingAccepts();
const PEER_D = 'kaspa:qrxw_ca_d' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_D, {
  picks: [{ id: 'offer_d', take_qty: 50, take_usdt: 1.7, paid_tx: null }],
  total_kas: 50, total_usdt: 1.7, pay_chain: 'bnb',
  expires_at: Date.now() + 30 * 60 * 1000,
});
_testInjectScan(async () => ({ ok: false, error: 'all RPC failed: timeout' }));
const r74 = await verifyPaymentForPeer({ peer: PEER_D, chain: 'bnb' });
t('7.4.1 RPC 失败 → scan_failed reason', !r74.ok && r74.reason === 'scan_failed');
t('7.4.2 _pendingAccepts 保留 (容错不破坏)', _hasPendingAccept(PEER_D));

// ── 7.5 多笔 partial — 一笔匹一笔不匹 ──
console.log('\n-- 7.5 多笔 partial (一匹一不匹) --');
_clearPendingAccepts();
const PEER_E = 'kaspa:qrxw_ca_e' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_E, {
  picks: [
    { id: 'offer_e1', take_qty: 30, take_usdt: 1.0, paid_tx: null },
    { id: 'offer_e2', take_qty: 20, take_usdt: 0.68, paid_tx: null },
  ],
  total_kas: 50, total_usdt: 1.68, pay_chain: 'bnb',
  expires_at: Date.now() + 30 * 60 * 1000,
});
_testInjectScan(async () => ({
  ok: true,
  events: [
    { tx_hash: '0x' + 'e1'.repeat(32), from: '0xUser', amount: 1.0, block: 1 },  // 匹第 1 笔
    { tx_hash: '0x' + 'e2'.repeat(32), from: '0xUser', amount: 0.99, block: 2 },  // 0.99 vs 0.68 不匹 (差 45% > tolerance)
  ],
  head_block: 100, span_blocks: 1500, recipient: '', asset: 'usdt', chain: 'bnb',
}));
const r75 = await verifyPaymentForPeer({ peer: PEER_E, chain: 'bnb' });
t('7.5.1 一笔匹 (matched=1)', r75.ok && r75.matched.length === 1);
t('7.5.2 _pendingAccepts 仍在 (还差一笔)', _hasPendingAccept(PEER_E));
const accept75 = _getPendingAccept(PEER_E);
t('7.5.3 第 1 笔 paid_tx 已设', accept75?.picks[0]?.paid_tx);
t('7.5.4 第 2 笔 paid_tx 仍 null', accept75?.picks[1]?.paid_tx === null);

// ── 7.6 同一 tx 重复扫 (防重) — 第 2 次 verify 不重复 enqueue paid_v1 ──
console.log('\n-- 7.6 同一 tx 重复扫不重复 paid (防重) --');
// 复用上面 PEER_E 的 accept (第 1 笔已 paid). 再 verify 一次, scan 给同样 events.
const r76 = await verifyPaymentForPeer({ peer: PEER_E, chain: 'bnb' });
// 第 1 笔已 paid_tx 设, filter !p.paid_tx 跳过. 应没 match (就剩第 2 笔, 1.0 vs 0.68 仍不匹).
t('7.6 第 2 次 verify 不重复 match (paid_tx 已过滤)', !r76.matched || r76.matched.length === 0);

// ── 7.7 amount tolerance ± 1% 边界 ──
console.log('\n-- 7.7 amount tolerance 边界 --');
_clearPendingAccepts();
const PEER_F = 'kaspa:qrxw_ca_f' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_F, {
  picks: [{ id: 'offer_f', take_qty: 50, take_usdt: 1.0000, paid_tx: null }],
  total_kas: 50, total_usdt: 1.0, pay_chain: 'bnb',
  expires_at: Date.now() + 30 * 60 * 1000,
});
_testInjectScan(async () => ({
  ok: true,
  events: [{ tx_hash: '0x' + 'f'.repeat(64), from: '0xUser', amount: 1.0099, block: 1 }],  // 0.99% > 期 1.0, 在 ± 1% 内
  head_block: 100, span_blocks: 1500, recipient: '', asset: 'usdt', chain: 'bnb',
}));
const r771 = await verifyPaymentForPeer({ peer: PEER_F, chain: 'bnb' });
t('7.7.1 +0.99% 在 ± 1% tolerance 内 (匹)', r771.ok && r771.matched.length === 1);

_clearPendingAccepts();
const PEER_G = 'kaspa:qrxw_ca_g' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_G, {
  picks: [{ id: 'offer_g', take_qty: 50, take_usdt: 1.0, paid_tx: null }],
  total_kas: 50, total_usdt: 1.0, pay_chain: 'bnb',
  expires_at: Date.now() + 30 * 60 * 1000,
});
_testInjectScan(async () => ({
  ok: true,
  events: [{ tx_hash: '0x' + 'g'.repeat(64), from: '0xUser', amount: 1.02, block: 1 }],  // +2% > tolerance
  head_block: 100, span_blocks: 1500, recipient: '', asset: 'usdt', chain: 'bnb',
}));
const r772 = await verifyPaymentForPeer({ peer: PEER_G, chain: 'bnb' });
t('7.7.2 +2% 超 ± 1% tolerance (no_match)', !r772.ok && r772.reason === 'no_match');

_testResetScan();
_clearPendingAccepts();
_testReset();

console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
