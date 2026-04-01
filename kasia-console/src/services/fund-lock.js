/**
 * Fund Lock Service — 资金锁定机制
 *
 * 防止并发订单超支：接单时锁定，完成时扣除，取消时释放。
 * 每笔订单唯一绑定资金（UNIQUE(order_id, asset)）。
 *
 * 调用方提供 currentBalance（来自钱包/链上查询），
 * 本服务只负责锁定记录，不负责余额查询。
 */

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

/**
 * 锁定资金。
 * @param {string} agentAddress
 * @param {string} orderId
 * @param {string} asset — 'kas' / 'usdt_bnb' / 'usdt_eth' / 'usdt_tron'
 * @param {number} amount — 锁定金额
 * @param {number} currentBalance — 调用方提供的当前钱包余额
 * @returns {{ ok: boolean, error?: string, lockId?: string, available?: number }}
 */
export function lockFunds(agentAddress, orderId, asset, amount, currentBalance) {
  if (!agentAddress || !orderId || !asset || !amount || amount <= 0) {
    return { ok: false, error: 'invalid_parameters' };
  }

  // 检查是否已锁定（幂等）
  const existing = sqlite.prepare(
    "SELECT id, status FROM fund_locks WHERE order_id = ? AND asset = ?"
  ).get(orderId, asset);
  if (existing) {
    if (existing.status === 'locked') return { ok: true, lockId: existing.id, already: true };
    // 已 released/spent 的不能重新锁
    return { ok: false, error: `lock already ${existing.status}` };
  }

  // 计算可用余额
  const lockedTotal = getLockedTotal(agentAddress, asset);
  const available = currentBalance - lockedTotal;

  if (available < amount) {
    return {
      ok: false,
      error: 'insufficient_available_balance',
      available: Math.max(0, available),
      needed: amount,
      locked: lockedTotal,
    };
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO fund_locks (id, agent_address, order_id, asset, amount, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'locked', ?)
  `).run(id, agentAddress, orderId, asset, amount, now);

  console.log(`[fund-lock] LOCKED: ${amount} ${asset} for order ${orderId.slice(0, 8)} (agent ${agentAddress.slice(-8)})`);
  return { ok: true, lockId: id };
}

/**
 * 释放锁定（取消/过期时调用）。
 */
export function releaseFunds(orderId) {
  const now = new Date().toISOString();
  const result = sqlite.prepare(
    "UPDATE fund_locks SET status = 'released', released_at = ? WHERE order_id = ? AND status = 'locked'"
  ).run(now, orderId);

  if (result.changes > 0) {
    console.log(`[fund-lock] RELEASED: ${result.changes} lock(s) for order ${orderId.slice(0, 8)}`);
  }
  return { released: result.changes };
}

/**
 * 标记已花费（完成时调用）。
 */
export function spendFunds(orderId) {
  const now = new Date().toISOString();
  const result = sqlite.prepare(
    "UPDATE fund_locks SET status = 'spent', released_at = ? WHERE order_id = ? AND status = 'locked'"
  ).run(now, orderId);

  if (result.changes > 0) {
    console.log(`[fund-lock] SPENT: ${result.changes} lock(s) for order ${orderId.slice(0, 8)}`);
  }
  return { spent: result.changes };
}

/**
 * 查询某个 Agent 某种资产的锁定总额。
 */
export function getLockedTotal(agentAddress, asset) {
  const row = sqlite.prepare(
    "SELECT COALESCE(SUM(amount), 0) as total FROM fund_locks WHERE agent_address = ? AND asset = ? AND status = 'locked'"
  ).get(agentAddress, asset);
  return row.total;
}

/**
 * 计算可用余额（= 当前余额 - 锁定总额）。
 */
export function getAvailableBalance(agentAddress, asset, currentBalance) {
  const locked = getLockedTotal(agentAddress, asset);
  return { available: Math.max(0, currentBalance - locked), locked, balance: currentBalance };
}

/**
 * 查询某个订单的锁定记录。
 */
export function getOrderLocks(orderId) {
  return sqlite.prepare(
    "SELECT * FROM fund_locks WHERE order_id = ?"
  ).all(orderId);
}

/**
 * 查询某个 Agent 的所有活跃锁定。
 */
export function getActiveLocks(agentAddress) {
  return sqlite.prepare(
    "SELECT * FROM fund_locks WHERE agent_address = ? AND status = 'locked' ORDER BY created_at DESC"
  ).all(agentAddress);
}
