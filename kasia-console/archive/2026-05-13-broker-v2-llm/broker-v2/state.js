// ════════════════════════════════════════════════════════════════
// broker-v2/state.js — SQL 单点 (retail_dex_orders 单一 source)
//
// Spec: docs/NEW-BROKER-PROPOSAL.md v2 (commit ecdd98874) §"state.js"
// Lock: 三方共识 7e776598dc + NWT v2 spec ecdd98874
//
// 设计:
// - 草稿 state = retail_dex_orders WHERE user_kasia_address=peer AND state='aligning'
// - LOCKED_FIELDS (R31/R33) 全 SQL guard, 不 inline JS check
// - 任何 broker-v2 read/write 必经此 API, 不准别处直接 SQL 写状态字段
// - partial fill 字段 (filled_qty / settle_grace_until / price_tolerance) 在 order-book.js 处理
// ════════════════════════════════════════════════════════════════

import { sqlite } from '../../db/client.js';
import crypto from 'node:crypto';

// R31 (pay_address 不可改) + R33 (side 不可改) — 全 SQL guard, 不 inline
const LOCKED_FIELDS = ['side', 'pay_address'];
const DRAFT_TTL_MS = 30 * 60 * 1000;

/**
 * 获取 peer 的活跃草稿 (state='aligning'). 没有返 null.
 * 'aligning' 是 broker session 字段收集阶段, finalize (publish offer) 后 advance 'awaiting_payment'.
 */
export function getActiveDraft(peer) {
  if (!peer) return null;
  const row = sqlite.prepare(`
    SELECT id, user_kasia_address, side, qty, price, pay_chain, pay_address,
           receive_address, agent_pay_addr, state, expires_at, created_at, updated_at
    FROM retail_dex_orders
    WHERE user_kasia_address = ?
      AND state = 'aligning'
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY created_at DESC LIMIT 1
  `).get(peer);
  if (!row) return null;
  // complete = 字段齐 (sell 必 pay_address EVM, buy 不要 — receive_address 默 user_kasia_address)
  const complete = !!(row.side && row.qty && row.pay_chain &&
                      (row.side === 'buy_kas' || row.pay_address));
  return { ...row, complete };
}

/**
 * 获取 peer 任一非终态 order. router/order-book/cancel-refund 复用.
 *
 * post NWT b7f32220 v84 决定: state CHECK enum 不扩, partial fill 进度由 filled_qty/qty 比值推:
 *   - filled_qty > 0 AND filled_qty < qty  → "partially_filled" 概念 (无单独 state enum)
 *   - settle_grace_until IS NOT NULL       → "ttl_expiring" 概念
 *
 * Active state (5 个非终态): aligning / awaiting_payment / paid / executing / refunding
 * Terminal: completed / refunded / failed / expired
 */
export function getActiveOrder(peer) {
  if (!peer) return null;
  return sqlite.prepare(`
    SELECT id, user_kasia_address, side, qty, price, pay_chain, pay_address,
           receive_address, agent_pay_addr, state, expires_at,
           filled_qty, settle_grace_until, exchange_offer_id,
           created_at, updated_at
    FROM retail_dex_orders
    WHERE user_kasia_address = ?
      AND state IN ('aligning', 'awaiting_payment', 'paid', 'executing', 'refunding')
    ORDER BY created_at DESC LIMIT 1
  `).get(peer) || null;
}

/**
 * Seed 新 draft row. caller (router) 第一次知 user direction 时调.
 * NOT NULL constraint side → 必须显式 INSERT with side.
 * (NWT 565bfe4b critical fix vote A: 移除 auto-create, caller 责任 seed.)
 *
 * @param {string} peer
 * @param {'buy_kas'|'sell_kas'} side
 * @returns {{ ok: boolean, id?: string }}
 */
export function seedDraft(peer, side) {
  if (!peer || !side) return { ok: false };
  if (side !== 'buy_kas' && side !== 'sell_kas') return { ok: false };
  // 已有 'aligning' draft → 不重 INSERT (idempotent)
  const existing = getActiveDraft(peer);
  if (existing) return { ok: true, id: existing.id, existing: true };
  const id = `bv2_${peer.slice(-12)}_${Date.now()}`;
  sqlite.prepare(`
    INSERT INTO retail_dex_orders
      (id, user_kasia_address, side, state, order_type, qty,
       created_at, updated_at, expires_at)
    VALUES (?, ?, ?, 'aligning', 'limit', NULL,
            datetime('now'), datetime('now'),
            datetime('now', '+30 minutes'))
  `).run(id, peer, side);
  return { ok: true, id };
}

/**
 * 写字段进当前 active draft. 仅 UPDATE existing 'aligning' row, 不 auto-create.
 * caller 责任先调 seedDraft (避免 INSERT NOT NULL constraint side 触爆).
 * R31/R33 SQL guard: LOCKED_FIELDS UPDATE WHERE col IS NULL OR col = :value.
 * rowsAffected=0:
 *   - locked field 拒 → {ok:false, reason:'X_locked'}
 *   - 没 active draft → {ok:true, set:false} (caller 应先 seedDraft)
 */
export function setField(peer, name, value) {
  if (!peer) return { ok: false, set: false, reason: 'no peer' };
  if (value === null || value === undefined || value === '') return { ok: true, set: false };

  // bug 6 fix layer 2 (J2 r25 vote (a) double-layer): qty < 1 KAS reject — broker minimum unit guard.
  // Pairs with parser.js scrub layer 1. Catches anything bypass parser (e.g. tool_call set_qty 0.0336).
  // 0.99 threshold (not 1.0) — allow user '1 KAS' edge case (parseFloat).
  if (name === 'qty') {
    const n = parseFloat(value);
    if (!Number.isFinite(n) || n < 0.99) return { ok: false, set: false, reason: 'qty_too_small' };
  }

  // R31/R33 SQL guard. col=name 静态 (caller 控制), value 参数化 SQL injection safe.
  const guard = LOCKED_FIELDS.includes(name)
    ? `AND (${name} IS NULL OR ${name} = :value)`
    : '';

  // lint-allow-state-update: PZ-STATE-T-V2-FIELDSET broker-v2 state.setField 是 column 写 (qty/price/pay_chain/pay_address 等), 非 state transition. lint regex 因 WHERE state='aligning' clause 误抓.
  const result = sqlite.prepare(`
    UPDATE retail_dex_orders
    SET ${name} = :value, updated_at = datetime('now')
    WHERE user_kasia_address = :peer
      AND state = 'aligning'
      ${guard}
  `).run({ peer, value: String(value) });

  if (result.changes === 0 && LOCKED_FIELDS.includes(name)) {
    return { ok: false, set: false, reason: `${name}_locked` };
  }
  return { ok: true, set: result.changes > 0 };
}

/**
 * Advance lifecycle state. 仅从 'aligning' advance, 防误覆盖已 finalized order.
 * router 'YES' 路径调 advance(peer, 'awaiting_payment'); cancel 调 clearDraft.
 */
export function advance(peer, newState) {
  if (!peer || !newState) return { ok: false };
  // lint-allow-state-update: PZ-STATE-T-V2-ADVANCE broker-v2 state.advance() helper multi-row batch (peer 可能多 aligning row 全 advance). transition() 是 single-row CAS, batch SELECT-then-loop ETA 大. phase Z 重构 advance() 内部走 SELECT all + per-row transition.
  const result = sqlite.prepare(`
    UPDATE retail_dex_orders
    SET state = ?, updated_at = datetime('now')
    WHERE user_kasia_address = ? AND state = 'aligning'
  `).run(newState, peer);
  return { ok: result.changes > 0 };
}

/**
 * 清 active draft. user 'cancel' / 'reset' 路径调.
 * 仅删 'aligning' state row — 已 finalize 的 order 不动 (走 advanceToRefunded).
 */
export function clearDraft(peer) {
  if (!peer) return 0;
  const result = sqlite.prepare(`
    DELETE FROM retail_dex_orders
    WHERE user_kasia_address = ? AND state = 'aligning'
  `).run(peer);
  return result.changes;
}

// ── Test helpers ──────────────────────────────────────────────────
export function _testReset(peer) {
  if (peer) {
    sqlite.prepare(`
      DELETE FROM retail_dex_orders
      WHERE user_kasia_address = ? AND state = 'aligning'
    `).run(peer);
  } else {
    sqlite.prepare(`
      DELETE FROM retail_dex_orders WHERE state = 'aligning'
    `).run();
  }
}
