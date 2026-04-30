// kasia-console/src/services/broker-state-machine.js
//
// 状态机唯一 transition owner. retail_dex_orders.state 任何变化必经此函数.
// 直 SQL UPDATE state → lint hard fail (R-NWT-STATE-MACHINE, SA-3 加).
//
// Owner 2026-04-30 钦定:
//   "我们花了那么多资源, 一直没有 '每个链上动作对应一个数据状态转换' 这条最基本原则
//   — 因为没人在做架构, 全在做 patches."
//
// 来源: docs/STATE-MACHINES.md v0.2 (NWT architect mode)
// Task: tasks/PZ-STATE-MACHINE-shipA.md SA-1 (5 const) + SA-2 (3 真函数 + 1 stub)
//
// 函数 export:
//   transition({orderId, expectedFromState, toState, opts, db}) — 唯一 transition entry (SA-2 真实施)
//   getOrderState(orderId, db)                                  — 强 latest read (SA-2 真实施)
//   findActiveOrder(peerAddr, db)                               — 仅返非 terminal state row (SA-2 真实施)
//   reconcileStaleOrders(db)                                    — SA-2 合法 stub (SA-5b 替真实施)
//
// db 参数 optional default sqlite (prod). test 传 in-memory testDb (per task v1.2 SA-5a 同模式).

import crypto from 'node:crypto';
import { sqlite as defaultDb } from '../db/client.js';

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

// ── SA-2 真实施 (3 函数) + SA-2 合法 stub (1 函数) ──

/**
 * 唯一 transition entry. retail_dex_orders.state 任何变化必经此.
 *
 * CAS 双重语义 (per STATE-MACHINES.md v0.2 expectedFromState section):
 *   1. 查转换表 from 边: ALLOWED_TRANSITIONS[expectedFromState].has(toState) — 决定合法性
 *   2. CAS race protection: SQL UPDATE WHERE state=expectedFromState — race/stale read 时 changes=0 → ok:false
 *
 * @param {object} args
 * @param {string} args.orderId - retail_dex_orders.id
 * @param {string} args.expectedFromState - 当前状态 (caller 声明 "我以为它在 X")
 * @param {string} args.toState - 目标状态
 * @param {object} [args.opts] - {
 *   paymentTxHash?, refundTxHash?, deliveryTxHash?,  // chain TX evidence (64-hex)
 *   reason?,           // 'user_cancel' | 'self_deal' | 'TTL' | 'retry_exhausted' | ...
 *   no_escrow?,        // failed 时若 broker 未真收到 KAS 可标 (跳 refundTxHash 要求)
 *   triggeredBy?,      // caller name for audit log
 * }
 * @param {object} [args.db] - optional db handle (default sqlite from prod, test 传 testDb)
 * @returns {{ ok: boolean, transitionedAt?: string, error?: string }}
 * @throws if illegal transition OR required tx hash missing
 */
export function transition({ orderId, expectedFromState, toState, opts = {}, db = defaultDb }) {
  // 1. Validate fromState → toState in ALLOWED_TRANSITIONS
  const allowed = ALLOWED_TRANSITIONS[expectedFromState];
  if (!allowed) {
    throw new Error(`[state-machine] unknown fromState: ${expectedFromState}`);
  }
  if (!allowed.has(toState)) {
    throw new Error(`[state-machine] illegal transition: ${expectedFromState} → ${toState}`);
  }

  // 2. Validate required tx hash (per TX_REQUIRED)
  const required = TX_REQUIRED[toState];
  if (required === 'paymentTxHash' && !opts.paymentTxHash) {
    throw new Error(`[state-machine] paymentTxHash required for ${toState}`);
  }
  if (required === 'refundTxHash' && !opts.refundTxHash && !opts.no_escrow) {
    throw new Error(`[state-machine] refundTxHash (or no_escrow=true) required for ${toState}`);
  }
  if (required === 'refundTxHash_or_no_escrow' && !opts.refundTxHash && !opts.no_escrow) {
    throw new Error(`[state-machine] refundTxHash or no_escrow required for failed`);
  }
  if (required === 'refundTxHash_or_aligning' && expectedFromState === 'awaiting_payment' && !opts.refundTxHash) {
    throw new Error(`[state-machine] refundTxHash required for awaiting_payment→expired`);
  }
  if (required === 'deliveryTxHash' && !opts.deliveryTxHash) {
    throw new Error(`[state-machine] deliveryTxHash required for ${toState}`);
  }

  // 3. SQL UPDATE atomic with CAS (WHERE state=expectedFromState)
  // schema column 名: pay_tx_hash / refund_tx_hash / deliver_tx_hash
  // COALESCE: opts 不传时不动现有列
  const result = db.prepare(`
    UPDATE retail_dex_orders
    SET state = ?,
        pay_tx_hash = COALESCE(?, pay_tx_hash),
        refund_tx_hash = COALESCE(?, refund_tx_hash),
        deliver_tx_hash = COALESCE(?, deliver_tx_hash),
        updated_at = datetime('now')
    WHERE id = ? AND state = ?
  `).run(
    toState,
    opts.paymentTxHash || null,
    opts.refundTxHash || null,
    opts.deliveryTxHash || null,
    orderId,
    expectedFromState
  );

  if (result.changes === 0) {
    return { ok: false, error: `state mismatch: expected ${expectedFromState}, row not in this state OR not exists` };
  }

  // 4. INSERT audit row
  // 真 chain TX (64-hex) → chain_events with 'broker_state_<to>' (撞 trigger 守 64-hex)
  // workflow marker (无 chain TX) → broker_workflow_markers with 'state_<to>'
  const txHash = opts.refundTxHash || opts.paymentTxHash || opts.deliveryTxHash || null;
  const isRealHash = txHash && /^[a-fA-F0-9]{64}$/.test(txHash);
  const auditPayload = JSON.stringify({
    order_id: orderId,
    from: expectedFromState,
    to: toState,
    reason: opts.reason || null,
    triggered_by: opts.triggeredBy || null,
    no_escrow: opts.no_escrow || false,
  });

  if (isRealHash) {
    db.prepare(`
      INSERT INTO chain_events (id, txid, from_address, to_address, event_type, payload, observed_by, observed_at)
      VALUES (?, ?, NULL, NULL, ?, ?, ?, datetime('now'))
    `).run(
      crypto.randomUUID(),
      txHash,
      `broker_state_${toState}`,
      auditPayload,
      'broker-state-machine.transition'
    );
  } else {
    db.prepare(`
      INSERT INTO broker_workflow_markers (id, event_type, src_event_id, payload, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(
      `transition_${orderId.slice(0, 16)}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      `state_${toState}`,
      orderId,
      auditPayload
    );
  }

  return { ok: true, transitionedAt: new Date().toISOString() };
}

/**
 * 查 order 当前 state. v2 router / handlers 必经此读, 不许直 SQL SELECT state.
 * 强制 latest read (避免 stale cache).
 *
 * @param {string} orderId
 * @param {object} [db] - optional db handle (default sqlite, test 传 testDb)
 * @returns {object|null} - { state, pay_tx_hash, refund_tx_hash, deliver_tx_hash, updated_at } OR null
 */
export function getOrderState(orderId, db = defaultDb) {
  const row = db.prepare(`
    SELECT state, pay_tx_hash, refund_tx_hash, deliver_tx_hash, updated_at
    FROM retail_dex_orders
    WHERE id = ?
  `).get(orderId);
  return row || null;
}

/**
 * 从 peer 找 active order. 替 broker-v2/state.getActiveOrder.
 * v0.1 限制: 仅返非 terminal state row. 多 row → 返 most recent created.
 *
 * @param {string} peerAddr
 * @param {object} [db] - optional db handle
 * @returns {object|null} - { id, side, qty, state, pay_chain, pay_address, exchange_offer_id, created_at, updated_at } OR null
 */
export function findActiveOrder(peerAddr, db = defaultDb) {
  return db.prepare(`
    SELECT id, side, qty, state, pay_chain, pay_address, exchange_offer_id, created_at, updated_at
    FROM retail_dex_orders
    WHERE user_kasia_address = ?
      AND state IN ('aligning', 'awaiting_payment', 'paid')
    ORDER BY created_at DESC
    LIMIT 1
  `).get(peerAddr) || null;
}

/**
 * Cron sweep 找 stale awaiting_payment + 强转 'failed'.
 *
 * SA-2 合法 stub — 真实施 (含 SA-5a checkBrokerEscrow 调用 + transition() 调用 + cron schedule)
 * 留 SA-5b 扩. 任何 caller (含未来 import) 调 stub 不会崩, 仅得 placeholder.
 *
 * @param {object} [db] - optional (stub 不用)
 * @returns {Promise<{ stale: number, forceFailed: number, _stub: true }>}
 */
export async function reconcileStaleOrders(db = defaultDb) {
  // SA-2 stub — _stub: true flag 让 cross-review 1 眼识别 OR 未来 caller 检.
  // SA-5b 替为真实施时 (查 DB / 调 transition / setInterval) signature 兼容.
  return { stale: 0, forceFailed: 0, _stub: true };
}
