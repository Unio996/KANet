// kasia-console/src/services/broker-state-machine.js
//
// SA-1 intermediate state — 仅 export 5 常量, 严禁含函数实现.
// 函数 (transition / getOrderState / findActiveOrder / reconcileStaleOrders) 留 SA-2 + SA-5b 扩.
//
// Owner 2026-04-30 钦定:
//   "我们花了那么多资源, 一直没有 '每个链上动作对应一个数据状态转换' 这条最基本原则
//   — 因为没人在做架构, 全在做 patches."
//
// 来源: docs/STATE-MACHINES.md v0.2 (NWT architect mode)
// Task: tasks/PZ-STATE-MACHINE-shipA.md SA-1

// ── 7 states ──
//   active (3): aligning / awaiting_payment / paid
//   terminal (4): completed / refunded / failed / expired
export const STATES = new Set([
  'aligning',
  'awaiting_payment',
  'paid',
  'completed',
  'refunded',
  'failed',
  'expired',
]);

export const ACTIVE_STATES = new Set([
  'aligning',
  'awaiting_payment',
  'paid',
]);

export const TERMINAL_STATES = new Set([
  'completed',
  'refunded',
  'failed',
  'expired',
]);

// ── 9 allowed transitions ── (per STATE-MACHINES.md v0.2 转换表)
// terminal state value 必为 empty Set (assert_1 守门).
export const ALLOWED_TRANSITIONS = {
  aligning: new Set(['awaiting_payment', 'expired', 'failed']),
  awaiting_payment: new Set(['paid', 'refunded', 'failed', 'expired']),
  paid: new Set(['completed', 'failed']),
  completed: new Set(),
  refunded: new Set(),
  failed: new Set(),
  expired: new Set(),
};

// ── chain TX hash 配对要求 (per toState) ──
// null = 不需 chain tx (e.g. aligning→awaiting_payment workflow marker only)
// 'paymentTxHash' / 'refundTxHash' / 'deliveryTxHash' = required field key in opts
// '_or_no_escrow' = refundTxHash OR opts.no_escrow=true (failed publish_failed before broker held funds)
// '_or_aligning' = aligning→expired 不需; awaiting_payment→expired 必 refundTxHash
export const TX_REQUIRED = {
  awaiting_payment: null,
  paid: 'paymentTxHash',
  refunded: 'refundTxHash',
  failed: 'refundTxHash_or_no_escrow',
  expired: 'refundTxHash_or_aligning',
  completed: 'deliveryTxHash',
};
