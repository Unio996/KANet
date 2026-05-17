// ════════════════════════════════════════════════════════════════
// broker-v3/user-context.js — ONE 真根因 fix (Owner UAT g3 5/17)
//
// Background: NWT + J2 6 surface fix (BE/BF/BG/BH/BI/BJ) 后 Owner 二测 撞同款 bug,
// 真根因 = "broker 4+ components 看同 user 同 escrow 各自子集, 给互相矛盾视图".
//
// 示例 (Owner g3 5/17 09:30-09:32):
//   intake-watcher: "✓ 已收 1.961 USDT, 正在挂单" (看 escrow 已 active)
//   _doCheckPrepayStatus: "你当前无 active 报价" (narrow filter status='pending_prepay')
//   user 同 conversation 见两条互斥消息 = 系统精分.
//
// 深层架构因 (J2 #440 加深): broker-v3 v0.4 设计 peer=MAKER (legacy OTC), v6 escrow 引入
// peer=USER (broker-as-broker), 但 query handler 没 refactor 双 model 混淆.
//
// Fix: 单一 user-centric aggregator. 所有 reply handler + state-machine prompt 改读 context,
// 不再各自 query 子集.
// ════════════════════════════════════════════════════════════════

import { sqlite } from '../../db/client.js';
import * as stateMachine from './state-machine.js';

// Status sets (single source of truth across all queries)
export const ESCROW_IN_FLIGHT = ['pending_prepay', 'active', 'verifying', 'delivering', 'matched'];
export const ESCROW_CLOSED = ['settled', 'refunded', 'timed_out', 'cancelled'];
export const OFFER_IN_FLIGHT = ['open', 'matched', 'verifying', 'delivering'];

// Stage labels (中文 user-facing, shared 跨 all reply handlers)
export const ESCROW_STAGE_LABEL = {
  pending_prepay: '⏳ 等你真链 transfer (1-2 min)',
  active: '✓ 已收款, 替你挂单/接单中',
  matched: '✓ 已接单, 等付款验证',
  verifying: '⏳ 付款验证中 (~1-3 min)',
  delivering: '⏳ 验证通过, 正在 deliver',
  settled: '✓ 已成交',
  refunded: '↩ 已退款',
  timed_out: '⏰ 已过期',
  cancelled: '⊘ 已取消',
};

const CLOSURE_WINDOW_MS = 5 * 60 * 1000;

/**
 * 单一 aggregator — 拉 user 完整 broker view in 1 SQL snapshot (transaction read).
 * 各 reply handler 不再 query 子集.
 *
 * @param {string} peer - user kasia 地址
 * @returns {Promise<{
 *   flow: object|null,           // broker-v3 in-memory state machine flow
 *   escrows: Array,              // in-flight escrows (5 max, recent first)
 *   closures: Array,             // 5 min 内 closed escrows (closure feedback)
 *   offers: Map<id, offer>,      // linked offers (keyed by id) for escrows
 *   price: number|null,          // live KAS price
 *   as_of_ts: number,            // aggregator snapshot timestamp (ms)
 *   peer: string,
 * }>}
 */
export async function getUserBrokerContext(peer) {
  const as_of_ts = Date.now();

  // 1) flow state (in-memory, TTL safe per Bug BI fix)
  const flow = stateMachine.getFlowState(peer);

  // 2) escrows (single SQL, broad in-flight + 5 min closure)
  // SQLite WAL = consistent read within single statement, race window <1ms.
  const escrows = sqlite.prepare(`
    SELECT id, side, asset, chain, amount_quoted, amount_received, target_amount, target_asset, target_chain,
           broker_recv_addr, user_target_addr, offer_id, status, prepayment_tx, settle_tx, refund_tx,
           expires_at, created_at, updated_at
    FROM user_escrow_balances
    WHERE user_kasia_addr = ?
      AND (status IN ('pending_prepay','active','verifying','delivering','matched')
           OR (status IN ('settled','refunded','timed_out','cancelled')
               AND datetime(updated_at) > datetime('now','-5 minutes')))
    ORDER BY datetime(created_at) DESC LIMIT 5
  `).all(peer);

  const inFlightEscrows = escrows.filter(e => ESCROW_IN_FLIGHT.includes(e.status));
  const closedEscrows = escrows.filter(e => ESCROW_CLOSED.includes(e.status));

  // 3) linked offers (JOIN by escrow.offer_id, in-flight offer protocol_status)
  const offerIds = escrows.map(e => e.offer_id).filter(Boolean);
  const offers = new Map();
  if (offerIds.length > 0) {
    const placeholders = offerIds.map(() => '?').join(',');
    const rows = sqlite.prepare(`
      SELECT id, protocol_status, give_asset, give_amount, give_chain,
             want_asset, want_amount, want_chain, maker, taker,
             broadcast_at, expires_at, matched_at, completed_at, delivery_tx
      FROM exchange_offers
      WHERE id IN (${placeholders})
    `).all(...offerIds);
    for (const o of rows) offers.set(o.id, o);
  }

  // 4) live price (oracle, may be null)
  let price = null;
  try {
    const { getKasPrice } = await import('./exchange-client.js');
    price = await getKasPrice();
  } catch {}

  return { flow, escrows: inFlightEscrows, closures: closedEscrows, offers, price, peer, as_of_ts };
}

/**
 * Get the user's current primary in-flight escrow (most recent, top of list).
 * Used by state-machine WAIT_PREPAY prompt + _doCheckPrepayStatus to determine current stage.
 */
export function getPrimaryEscrow(ctx) {
  return ctx.escrows[0] || null;
}

/**
 * Render stage label for an escrow (single source for user-facing stage text).
 */
export function renderEscrowStage(escrow) {
  return ESCROW_STAGE_LABEL[escrow.status] || `[${escrow.status}]`;
}

/**
 * Closure age in minutes (for "✓ N min 前 settled/refunded" feedback).
 */
export function closureAgeMin(escrow) {
  if (!ESCROW_CLOSED.includes(escrow.status)) return null;
  const ts = new Date(escrow.updated_at + 'Z').getTime();
  return Math.floor((Date.now() - ts) / 60000);
}

/**
 * Format priceline header for user-facing prompts.
 */
export function formatPriceLine(ctx) {
  if (ctx.price && ctx.price > 0) return `📊 KAS 现价 ${ctx.price} USDT (live)`;
  return '⚠ oracle 暂不可用';
}
