/**
 * Execution State Service — 执行追踪 + 权限闸门
 *
 * 每个花钱操作必须经过这里：
 *   createExecution → pending
 *   approveExecution → approved（auto 模式自动，approval 模式等人）
 *   startExecution → executing
 *   completeExecution → completed（记 output_txid）
 *   failExecution → failed（记 error_text）
 *   rejectExecution → rejected（权限不够或限额超限）
 *
 * 查重：同 order_id + type 的未终结记录不重复创建。
 */

import { sqlite } from '../db/client.js';
import { randomUUID } from 'crypto';

const TERMINAL = ['completed', 'failed', 'rejected'];

// ── Create ──

/**
 * 创建一条执行记录。
 * 如果同 order+type 已有未终结的记录，返回已有的（幂等）。
 *
 * @returns {{ id, status, isNew }}
 */
export function createExecution({
  orderId, type, source, agentAddress,
  permissionLevel = 'owner', amount = null, asset = null,
  intentId = null, inputTxid = null, approvalTimeout = 15,
  displaySummary = null, actionDetails = null, approvalDeadline = null,
}) {
  if (!type || !source || !agentAddress) {
    throw new Error('type, source, agentAddress are required');
  }

  // 查重：同 order+type 未终结的
  if (orderId) {
    const existing = sqlite.prepare(`
      SELECT id, status FROM execution_states
      WHERE order_id = ? AND type = ? AND status NOT IN ('completed', 'failed', 'rejected')
    `).get(orderId, type);
    if (existing) {
      return { id: existing.id, status: existing.status, isNew: false };
    }
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  // 自动计算审批截止时间（如果是 pending 状态且有 timeout）
  if (!approvalDeadline && approvalTimeout > 0) {
    approvalDeadline = new Date(Date.now() + approvalTimeout * 60_000).toISOString();
  }

  const detailsJson = actionDetails ? JSON.stringify(actionDetails) : null;

  sqlite.prepare(`
    INSERT INTO execution_states
      (id, intent_id, type, source, agent_address, permission_level, status,
       input_txid, order_id, amount, asset, approval_timeout,
       display_summary, action_details, approval_deadline,
       created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, intentId, type, source, agentAddress, permissionLevel,
    inputTxid, orderId, amount, asset, approvalTimeout,
    displaySummary, detailsJson, approvalDeadline,
    now, now
  );

  console.log(`[execution] CREATED: ${type} for order ${orderId?.slice(0, 8) || 'N/A'} (${source}) → pending`);
  return { id, status: 'pending', isNew: true };
}

// ── Status transitions ──

export function approveExecution(executionId) {
  return _transition(executionId, 'approved', 'pending');
}

export function startExecution(executionId) {
  return _transition(executionId, 'executing', 'approved');
}

export function completeExecution(executionId, { outputTxid = null, summary = null } = {}) {
  const extra = {};
  if (outputTxid) extra.output_txid = outputTxid;
  if (summary) extra.display_summary = summary;
  return _transition(executionId, 'completed', 'executing', extra);
}

export function failExecution(executionId, errorText) {
  return _transition(executionId, 'failed', null, { error_text: errorText });
}

export function rejectExecution(executionId, errorText) {
  return _transition(executionId, 'rejected', 'pending', { error_text: errorText });
}

// ── Queries ──

export function getExecution(executionId) {
  return sqlite.prepare('SELECT * FROM execution_states WHERE id = ?').get(executionId) || null;
}

export function getOrderExecutions(orderId) {
  return sqlite.prepare(
    'SELECT * FROM execution_states WHERE order_id = ? ORDER BY created_at DESC'
  ).all(orderId);
}

export function getPendingExecutions(agentAddress) {
  return sqlite.prepare(
    "SELECT * FROM execution_states WHERE agent_address = ? AND status = 'pending' ORDER BY created_at"
  ).all(agentAddress);
}

/**
 * 快速执行流程（手动/auto 模式）：pending → approved → executing 一步到位。
 * 返回 executionId，调用方负责最后 complete 或 fail。
 */
export function quickStart({
  orderId, type, source, agentAddress,
  permissionLevel = 'owner', amount = null, asset = null,
  intentId = null, inputTxid = null,
  displaySummary = null, actionDetails = null,
}) {
  const exec = createExecution({
    orderId, type, source, agentAddress,
    permissionLevel, amount, asset, intentId, inputTxid,
    displaySummary, actionDetails,
  });

  if (exec.isNew) {
    approveExecution(exec.id);
    startExecution(exec.id);
  } else if (exec.status === 'pending') {
    approveExecution(exec.id);
    startExecution(exec.id);
  } else if (exec.status === 'approved') {
    startExecution(exec.id);
  }
  // executing 或 terminal → 不动

  return exec.id;
}

// ── Internal ──

function _transition(executionId, newStatus, expectedFrom = null, extraFields = {}) {
  const now = new Date().toISOString();
  const existing = sqlite.prepare('SELECT id, status, type, order_id FROM execution_states WHERE id = ?').get(executionId);
  if (!existing) return { ok: false, error: 'Execution not found' };

  // 终态不能再改
  if (TERMINAL.includes(existing.status)) {
    return { ok: false, error: `Already in terminal state: ${existing.status}` };
  }

  // 如果指定了 expectedFrom，校验当前状态
  if (expectedFrom && existing.status !== expectedFrom) {
    // 宽松：failed 可以从任何非终态到达
    if (newStatus !== 'failed') {
      return { ok: false, error: `Expected ${expectedFrom}, got ${existing.status}` };
    }
  }

  const updates = ['status = ?', 'updated_at = ?'];
  const values = [newStatus, now];

  for (const [key, val] of Object.entries(extraFields)) {
    if (val !== undefined && val !== null) {
      updates.push(`${key} = ?`);
      values.push(val);
    }
  }

  values.push(executionId);
  sqlite.prepare(`UPDATE execution_states SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  console.log(`[execution] ${existing.type} ${existing.order_id?.slice(0, 8) || ''}: ${existing.status} → ${newStatus}`);
  return { ok: true, status: newStatus };
}
