// T-NWT-V2 bsc-incoming-watcher smoke
// mock _scanOverride 模拟 BSC USDT 入账 → watcher tick → 验:
// - verifyPaymentForPeer 被调 + matched
// - _pendingAccepts 全 paid 后被 delete
// - dm_auto_payment_detected 进 broker-action-queue
// - 防重 (二次 tick 不再 match)

import {
  _testSetPendingAccept,
  _hasPendingAccept,
  _clearPendingAccepts,
  _testInjectScan,
  _testResetScan,
  _pendingPeers,
} from '../src/services/broker-buy-handler.js';
import { tick, getStats } from '../src/services/bsc-incoming-watcher.js';
import { _testInjectExecute, _testReset, getQueueStats } from '../src/services/broker-action-queue.js';

let pass = 0, fail = 0;
const t = (name, ok, info) => {
  if (ok) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}  ${info || ''}`); }
};

// mock broker-action-queue execute (防真 send) — 让 enqueue 进队但不 pump 真发
let executedKinds = [];
_testInjectExecute(async ({ kind, peer, payload }) => {
  executedKinds.push({ kind, peer, msg: payload?.message?.slice(0, 60) });
  return { ok: true, txId: 'mock_dm_' + Math.random().toString(16).slice(2, 8) };
});

console.log('=== T-NWT-V2 bsc-incoming-watcher smoke ===\n');

// ── 1. happy path: pending accept + 链上匹配 → auto-paid ──
console.log('-- 1. happy path: 单笔匹配自动付 --');
_clearPendingAccepts(); _testReset();
_testInjectExecute(async ({ kind, peer, payload }) => {
  executedKinds.push({ kind, peer, msg: payload?.message?.slice(0, 60) });
  return { ok: true, txId: 'mock_dm_' + Math.random().toString(16).slice(2, 8) };
});
executedKinds = [];
const PEER_A = 'kaspa:qrxw_v2_a' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_A, {
  picks: [{ id: 'offer_a1', take_qty: 45, take_usdt: 1.5387, paid_tx: null }],
  total_kas: 45,
  total_usdt: 1.5387,
  pay_chain: 'bnb',
  expires_at: Date.now() + 30 * 60 * 1000,
});
_testInjectScan(async ({ chain, recipient }) => ({
  ok: true,
  events: [
    { tx_hash: '0x' + 'a'.repeat(64), from: '0xUserBSC', amount: 1.5387, block: 12345 },
  ],
  head_block: 12345, span_blocks: 1500, recipient, asset: 'usdt', chain,
}));
const r1 = await tick();
await new Promise(r => setTimeout(r, 200));  // let broker-action-queue pump async
t('1.1 tick ok', r1.ok === true, JSON.stringify(r1));
t('1.2 matched=1', r1.matched === 1);
t('1.3 _hasPendingAccept false (全 paid)', !_hasPendingAccept(PEER_A));
const dmEvents = executedKinds.filter(e => e.kind === 'dm_auto_payment_detected');
t('1.4 dm_auto_payment_detected enqueue', dmEvents.length >= 1, JSON.stringify(executedKinds));
const paidEvents = executedKinds.filter(e => e.kind === 'paid_v1');
t('1.5 paid_v1 enqueue', paidEvents.length >= 1);

// ── 2. 二次 tick 防重 ──
console.log('\n-- 2. 二次 tick 防重 (peer 已删, 不再 match) --');
executedKinds = [];
const r2 = await tick();
t('2.1 tick peers=0', r2.peers === 0);
t('2.2 不再 enqueue', executedKinds.length === 0);

// ── 3. amount 不匹配 → no_match, _pendingAccepts 不动 ──
console.log('\n-- 3. amount 不匹配 → 不误付 --');
_clearPendingAccepts();
const PEER_B = 'kaspa:qrxw_v2_b' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_B, {
  picks: [{ id: 'offer_b1', take_qty: 100, take_usdt: 3.4, paid_tx: null }],
  total_kas: 100,
  total_usdt: 3.4,
  pay_chain: 'bnb',
  expires_at: Date.now() + 30 * 60 * 1000,
});
_testInjectScan(async () => ({
  ok: true,
  events: [
    { tx_hash: '0x' + 'b'.repeat(64), from: '0xElse', amount: 0.5, block: 12346 },  // 0.5 ≠ 3.4
  ],
  head_block: 12346, span_blocks: 1500, recipient: '', asset: 'usdt', chain: 'bnb',
}));
executedKinds = [];
const r3 = await tick();
t('3.1 tick matched=0', r3.matched === 0);
t('3.2 _pendingAccepts 仍在 (no_match 不删)', _hasPendingAccept(PEER_B));
t('3.3 不 enqueue 任何 paid_v1', executedKinds.filter(e => e.kind === 'paid_v1').length === 0);

// ── 4. 多 picks 部分匹配 ──
console.log('\n-- 4. 多 picks 部分匹配 --');
_clearPendingAccepts();
const PEER_C = 'kaspa:qrxw_v2_c' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_C, {
  picks: [
    { id: 'offer_c1', take_qty: 30, take_usdt: 1.0, paid_tx: null },
    { id: 'offer_c2', take_qty: 20, take_usdt: 0.68, paid_tx: null },
  ],
  total_kas: 50,
  total_usdt: 1.68,
  pay_chain: 'bnb',
  expires_at: Date.now() + 30 * 60 * 1000,
});
_testInjectScan(async () => ({
  ok: true,
  events: [
    { tx_hash: '0x' + 'c'.repeat(64), from: '0xUser', amount: 1.0, block: 12347 },  // 只匹第 1 笔
  ],
  head_block: 12347, span_blocks: 1500, recipient: '', asset: 'usdt', chain: 'bnb',
}));
executedKinds = [];
const r4 = await tick();
t('4.1 matched=1 (部分)', r4.matched === 1);
t('4.2 _pendingAccepts 仍在 (还差一笔)', _hasPendingAccept(PEER_C));

// ── 5. unsupported chain 跳过 ──
console.log('\n-- 5. SOL/TRON 跳过 (留 v1.1) --');
_clearPendingAccepts();
const PEER_D = 'kaspa:qrxw_v2_d' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_D, {
  picks: [{ id: 'offer_d', take_qty: 50, take_usdt: 1.7, paid_tx: null }],
  total_kas: 50, total_usdt: 1.7, pay_chain: 'sol',
  expires_at: Date.now() + 30 * 60 * 1000,
});
let scanCalledForSol = false;
_testInjectScan(async () => { scanCalledForSol = true; return { ok: true, events: [] }; });
executedKinds = [];
const r5 = await tick();
t('5.1 sol 不调 scanRecentTransfers', scanCalledForSol === false);
t('5.2 _pendingAccepts SOL 保留 (待 v1.1 SOL indexer)', _hasPendingAccept(PEER_D));

// ── 6. scan 失败 (RPC 全挂) → 不破坏 _pendingAccepts ──
console.log('\n-- 6. scan_failed 容错 --');
_clearPendingAccepts();
const PEER_E = 'kaspa:qrxw_v2_e' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_E, {
  picks: [{ id: 'offer_e', take_qty: 10, take_usdt: 0.34, paid_tx: null }],
  total_kas: 10, total_usdt: 0.34, pay_chain: 'bnb',
  expires_at: Date.now() + 30 * 60 * 1000,
});
_testInjectScan(async () => ({ ok: false, error: 'all RPC failed: timeout' }));
executedKinds = [];
const r6 = await tick();
t('6.1 RPC 失败时 matched=0', r6.matched === 0);
t('6.2 _pendingAccepts 保留', _hasPendingAccept(PEER_E));
t('6.3 不 enqueue', executedKinds.length === 0);

// ── 7. expires_at 过期 → verifyPaymentForPeer 内会清, watcher 也跳 ──
console.log('\n-- 7. expired pendingAccept 不被误付 --');
_clearPendingAccepts();
const PEER_F = 'kaspa:qrxw_v2_f' + 'fghjkl1234567890';
_testSetPendingAccept(PEER_F, {
  picks: [{ id: 'offer_f', take_qty: 5, take_usdt: 0.17, paid_tx: null }],
  total_kas: 5, total_usdt: 0.17, pay_chain: 'bnb',
  expires_at: Date.now() - 1000,  // 已过期
});
_testInjectScan(async () => ({ ok: true, events: [{ tx_hash: '0x' + 'f'.repeat(64), from: '0xUser', amount: 0.17, block: 12348 }] }));
executedKinds = [];
const r7 = await tick();
t('7.1 expired 不误付', r7.matched === 0);
t('7.2 verifyPaymentForPeer 自清 expired', !_hasPendingAccept(PEER_F));

_testResetScan();
_clearPendingAccepts();
_testReset();

const stats = getStats();
console.log(`\nstats: ticks=${stats.ticks} matches=${stats.matches}`);
console.log(`\n=== ${pass} pass, ${fail} fail ===`);
process.exit(fail === 0 ? 0 : 1);
