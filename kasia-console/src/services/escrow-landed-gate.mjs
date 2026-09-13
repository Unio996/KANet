// escrow-landed-gate.mjs — (c) 第 5 笔 (B) · escrow_landed_at 硬消费门 (J2 2026-09-13 · Codex 8118732e HOLD · Bettor 派单)。
//
// 不变量: 带 escrow 锁的预测 offer(metadata.escrow_lock_tx 或 escrow_p2sh 非空), `escrow_landed_at IS NULL ⇒ 无 taker 接受、无匹配、
//   无结算资格、无对手方价值移动、无声誉终态`。这是【业务码硬门】不是 UI 标记/超时清理:
//   ① 单一所有权点 exchange-machine.transition(): matched 需 maker 锁落链; verifying/collecting_sigs/delivering/completed 需 maker 锁落链
//      ∧ (有 taker 锁 ⇒ taker 锁落链)。refunded/cancelled/expired/timed_out/disputed 不是对手方价值移动, 不拦。
//   ② settler 每 offer 入口 assertSettleEligible(): 未落链 ⇒ 不做 oracle/派彩(无结算资格)。
//   ③ taker-stake 处理器: maker 锁未落链 ⇒ 409, taker 押金不发(无 taker 接受)。
//   ④ 声誉 'paid' 只在 completed 之后(payout-gate), 被 ① 传递覆盖。
// 写入方: tx-landed-reconciler(把 submit_intents landed 回填, applyIntentLanded)。HTTP 处理器仍异步返回 txId, 对象落库即 pending/non-consumable。
import { sqlite } from '../db/client.js';

const SETTLE_STATES = new Set(['verifying', 'awaiting_oracle', 'awaiting_manual_confirm', 'collecting_sigs', 'delivering', 'verified', 'completed']);
const MATCH_STATES = new Set(['matched', 'open_awaiting_taker_stake', 'handshake_done']);

function meta(offer) { try { return JSON.parse(offer.metadata || '{}'); } catch { return {}; } }

/** 是不是"带 escrow 锁的预测 offer"——只有这类受门约束(普通 exchange offer 不变)。 */
export function usesEscrowLock(offer) {
  if (!offer) return false;
  const isPrediction = offer.give_asset === 'prediction_outcome_share' || offer.want_asset === 'prediction_outcome_share';
  if (!isPrediction) return false;
  const m = meta(offer);
  return !!(m.escrow_lock_tx || offer.escrow_p2sh);
}

/** 转换门: 返回 { ok:true } 或 { ok:false, reason }。 */
export function escrowGateFor(offer, newStatus) {
  if (!usesEscrowLock(offer)) return { ok: true };
  if (MATCH_STATES.has(newStatus) || SETTLE_STATES.has(newStatus)) {
    if (!offer.escrow_landed_at) return { ok: false, reason: `maker escrow lock not landed (escrow_landed_at NULL, lock tx ${String(meta(offer).escrow_lock_tx || '?').slice(0, 12)})` };
  }
  if (SETTLE_STATES.has(newStatus) && offer.taker_escrow_lock_tx && !offer.taker_escrow_landed_at) {
    return { ok: false, reason: `taker escrow lock not landed (taker_escrow_landed_at NULL, lock tx ${String(offer.taker_escrow_lock_tx).slice(0, 12)})` };
  }
  return { ok: true };
}

/** settler 入口: 有结算资格? 等价于 escrowGateFor(offer, 'delivering')。 */
export function assertSettleEligible(offer) {
  return escrowGateFor(offer, 'delivering');
}

/** taker 接受门: maker 锁必须已落链。 */
export function takerAcceptGate(offerId) {
  const row = sqlite.prepare('SELECT id, give_asset, want_asset, metadata, escrow_p2sh, escrow_landed_at, escrow_landed_depth FROM exchange_offers WHERE id = ?').get(offerId);
  if (!row) return { ok: false, reason: 'offer not found' };
  if (!usesEscrowLock(row)) return { ok: true };
  if (!row.escrow_landed_at) return { ok: false, reason: `maker escrow lock not landed yet (escrow_landed_at NULL) — retry after it lands (REORG_SAFE depth)` };
  return { ok: true, depth: row.escrow_landed_depth };
}

/**
 * submit_intents 行落链 ⇒ 回填 offer 列(唯一写入方)。kind escrow_lock/maker_stake → escrow_landed_*; taker_stake → taker_escrow_landed_*。
 * 只在列为 NULL 时写(首次落链时刻), 幂等。返回 { applied, column }。
 */
export function applyIntentLanded(intent, { landedAt = null, depth = null } = {}) {
  if (!intent || intent.status !== 'landed') return { applied: false, reason: 'intent not landed' };
  const at = landedAt || intent.landed_at || new Date().toISOString();
  const d = depth ?? intent.landed_depth ?? null;
  let column = null;
  if (intent.intent_kind === 'escrow_lock' || intent.intent_kind === 'maker_stake') column = 'escrow_landed';
  else if (intent.intent_kind === 'taker_stake') column = 'taker_escrow_landed';
  else return { applied: false, reason: `kind ${intent.intent_kind} has no offer column` };
  const r = sqlite.prepare(`UPDATE exchange_offers SET ${column}_at = ?, ${column}_depth = ?, updated_at = ? WHERE id = ? AND ${column}_at IS NULL`)
    .run(at, d, new Date().toISOString(), intent.offer_id);
  return { applied: r.changes > 0, column };
}
