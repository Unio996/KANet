/**
 * Trade Action Gate — 权限闸门核心
 *
 * 每个交易操作都必须经过这里。
 * Source 由调用方代码路径决定，不由客户端声称：
 *   - trading.js /action（UI 操作）→ source='owner'
 *   - action-executor callback（Mind 触发）→ source='agent'
 *   - ingest-service（链上事件）→ source='peer'
 *   - scheduler/timeout → source='system'
 *
 * Mode 从 DB 读取，不信任调用方。
 *
 * 返回值：
 *   { allowed: true }                                     — 允许执行
 *   { pending: true, executionId, displaySummary }        — approval 模式，等 owner 确认
 *   { denied: true, reason }                              — 拒绝
 */

import { sqlite } from '../db/client.js';
import { checkLimits } from './trade-limits.js';
import { lockFunds } from './fund-lock.js';
import { createExecution, quickStart, completeExecution, rejectExecution } from './execution-state.js';

// ── 有效 source 值 ──
const VALID_SOURCES = new Set(['owner', 'agent', 'peer', 'system']);

// ── 权限矩阵 ──
// action × source → 是否需要走 mode 检查
// true = 需要走 mode 检查，false = 直接判断
const REQUIRES_MODE_CHECK = {
  accept:         { owner: false, agent: true,  peer: true,  system: false },
  pay_usdt:       { owner: false, agent: true,  peer: false, system: false },
  verify_payment: { owner: false, agent: true,  peer: false, system: false },
  send_kas:       { owner: false, agent: true,  peer: false, system: false },
  cancel:         { owner: false, agent: false, peer: false, system: false },
  publish:        { owner: false, agent: true,  peer: false, system: false },
};

// ── source 级别的硬性拒绝 ──
// peer 只能触发 accept，其他全部拒绝
const PEER_ALLOWED = new Set(['accept']);
// system 可触发 verify_payment、send_kas（auto-advance）和 cancel
const SYSTEM_ALLOWED = new Set(['verify_payment', 'send_kas', 'cancel']);

/**
 * 交易操作权限闸门。
 *
 * @param {string} orderId — mm_orders.id
 * @param {string} action — 'accept' | 'pay_usdt' | 'verify_payment' | 'send_kas' | 'cancel' | 'publish'
 * @param {string} source — 'owner' | 'agent' | 'peer' | 'system'（由调用代码硬编码）
 * @param {string} agentAddress — 操作的 Agent 地址
 * @param {object} [opts] — 额外参数
 * @param {string} [opts.peerAddress] — source=peer 时，消息发送方地址
 * @param {object} [opts.actionParams] — 传递给实际执行的参数（txhash, address 等）
 * @returns {{ allowed?, pending?, denied?, reason?, executionId?, displaySummary? }}
 */
export function gateTradeAction(orderId, action, source, agentAddress, opts = {}) {
  // ── 基础校验 ──
  if (!VALID_SOURCES.has(source)) {
    return { denied: true, reason: `invalid source: ${source}` };
  }
  if (!REQUIRES_MODE_CHECK[action]) {
    return { denied: true, reason: `unknown trade action: ${action}` };
  }

  // ── source 级别硬性拒绝 ──
  if (source === 'peer' && !PEER_ALLOWED.has(action)) {
    return { denied: true, reason: `peer cannot trigger ${action}` };
  }
  if (source === 'system' && !SYSTEM_ALLOWED.has(action)) {
    return { denied: true, reason: `system cannot trigger ${action}` };
  }

  // ── owner 和 system 的简单路径（不走 mode 检查）──
  if (source === 'owner') {
    return { allowed: true };
  }
  if (source === 'system') {
    return { allowed: true };
  }

  // ── agent 和 peer 需要读 mode ──
  const order = orderId
    ? sqlite.prepare('SELECT * FROM mm_orders WHERE id = ?').get(orderId)
    : null;

  const mode = order?.mode || _getAgentTradeMode(agentAddress) || 'manual';

  // ── peer accept 校验（设计文档 Section 3.2）──
  if (source === 'peer' && action === 'accept') {
    if (order?.status !== 'published') {
      return { denied: true, reason: `order already ${order?.status}, cannot accept` };
    }
    if (order?.peer_address && opts.peerAddress && order.peer_address !== opts.peerAddress) {
      return { denied: true, reason: 'peer_address mismatch — this order is reserved' };
    }
  }

  // ── mode 检查 ──
  if (!REQUIRES_MODE_CHECK[action]?.[source]) {
    // 不需要 mode 检查 → 直接允许（这个分支理论上不会到达，上面已处理）
    return { allowed: true };
  }

  return _checkMode(action, source, mode, order, agentAddress, opts);
}

/**
 * Mode × source 检查。
 */
function _checkMode(action, source, mode, order, agentAddress, opts) {
  switch (mode) {
    case 'auto': {
      // auto 模式：检查限额 → 预占资金 → 允许执行
      const limitResult = _checkAutoLimits(action, order, agentAddress);
      if (!limitResult.ok) {
        // 限额不足 → 记录 rejected execution
        if (order) {
          const exec = createExecution({
            orderId: order.id, type: action, source, agentAddress,
            amount: order.kas_amount, asset: 'kas',
            displaySummary: `Rejected: ${limitResult.error}`,
            actionDetails: { reason: limitResult.error, detail: limitResult.detail },
          });
          rejectExecution(exec.id, limitResult.error);
        }
        return { denied: true, reason: limitResult.error, detail: limitResult.detail };
      }
      return { allowed: true, mode: 'auto' };
    }

    case 'approval': {
      // approval 模式：创建 pending execution_state → 等 owner 确认
      const summary = _buildDisplaySummary(action, order, opts);
      const details = _buildActionDetails(action, order, opts);
      const timeout = _getApprovalTimeout(order);

      const exec = createExecution({
        orderId: order?.id, type: action, source, agentAddress,
        amount: order?.kas_amount, asset: 'kas',
        approvalTimeout: timeout,
        displaySummary: summary,
        actionDetails: details,
      });

      if (!exec.isNew && exec.status !== 'pending') {
        // 已有非 pending 的记录（可能在执行中）→ 不重复创建
        return { denied: true, reason: `execution already in progress: ${exec.status}` };
      }

      console.log(`[trade-gate] PENDING: ${action} for order ${order?.id?.slice(0, 8) || 'N/A'} — waiting owner approval (${timeout}min)`);
      return {
        pending: true,
        executionId: exec.id,
        displaySummary: summary,
        approvalDeadline: exec.isNew
          ? new Date(Date.now() + timeout * 60_000).toISOString()
          : null,
      };
    }

    case 'manual':
    default: {
      // manual 模式：agent 不能自主操作
      if (source === 'agent') {
        return { denied: true, reason: `manual mode: agent cannot trigger ${action}` };
      }
      // peer accept in manual mode → create pending for owner
      if (source === 'peer' && action === 'accept') {
        const summary = _buildDisplaySummary(action, order, opts);
        const exec = createExecution({
          orderId: order?.id, type: action, source, agentAddress,
          displaySummary: summary,
          actionDetails: _buildActionDetails(action, order, opts),
          approvalTimeout: 15,
        });
        return { pending: true, executionId: exec.id, displaySummary: summary };
      }
      return { denied: true, reason: `manual mode: only owner can operate` };
    }
  }
}

/**
 * Auto 模式限额检查。
 */
function _checkAutoLimits(action, order, agentAddress) {
  if (!order) return { ok: true }; // 无订单的 action（如 cancel）不检查
  if (action === 'cancel') return { ok: true }; // cancel 不检查限额

  return checkLimits(
    agentAddress,
    order.kas_amount || 0,
    order.usdt_amount || (order.kas_amount || 0) * (order.price || 0),
    'auto',
  );
}

/**
 * Accept 完成后触发下一步。
 * 由 trading.js 在 accept 成功后调用。
 *
 * @param {object} order — 刚 accepted 的订单
 * @param {string} triggerSource — 触发 accept 的 source（'owner'/'agent'/'peer'）
 */
export function triggerNextStep(order, triggerSource) {
  if (!order || order.status !== 'accepted') return;

  // 买方需要付 USDT → 创建下一步 execution
  if (order.side === 'buy') {
    const mode = order.mode || _getAgentTradeMode(order.agent_address) || 'manual';
    // manual 模式不自动推进（不论谁触发）
    if (mode === 'manual') return;

    const nextAction = 'pay_usdt';
    const gate = gateTradeAction(order.id, nextAction, 'agent', order.agent_address);

    if (gate.allowed) {
      console.log(`[trade-gate] Auto-trigger: ${nextAction} for order ${order.id.slice(0, 8)} (mode=${mode})`);
      // 实际付款由 trading.js 的执行逻辑完成，这里只记录 execution_state
      quickStart({
        orderId: order.id, type: nextAction, source: 'agent', agentAddress: order.agent_address,
        amount: order.usdt_amount || order.kas_amount * (order.price || 0),
        asset: 'usdt_' + (order.chain || 'bnb'),
      });
    } else if (gate.pending) {
      console.log(`[trade-gate] Pending approval: ${nextAction} for order ${order.id.slice(0, 8)}`);
      // pending 已由 gateTradeAction 创建
    }
    // denied → 不触发，等 owner 手动
  }
}

// ── 内部辅助 ──

function _getAgentTradeMode(agentAddress) {
  if (!agentAddress) return 'manual';
  // 读 Agent 自主权模式（auto/approval/manual），不是交易所模式（LIVE/DRY-RUN）
  // 优先从 config_entries 读 agent_trade_mode，没有则默认 manual
  const row = sqlite.prepare(
    "SELECT value_encrypted as val FROM config_entries WHERE key = 'agent_trade_mode'"
  ).get();
  const mode = row?.val || 'manual';
  // 确保只返回有效值
  if (['auto', 'approval', 'manual'].includes(mode)) return mode;
  return 'manual';
}

function _getApprovalTimeout(order) {
  // 付款前 15min，付款后 60min
  const paidStatuses = ['paid', 'verified', 'delivering'];
  if (order && paidStatuses.includes(order.status)) return 60;
  return 15;
}

function _buildDisplaySummary(action, order, opts) {
  if (!order) return `${action}`;

  const kasAmt = order.kas_amount || '?';
  const usdtAmt = (order.usdt_amount || (order.kas_amount || 0) * (order.price || 0)).toFixed(2);
  const chain = (order.chain || 'bnb').toUpperCase();
  // 尝试从 identities 获取对方名字
  let peerName = '';
  try {
    const row = sqlite.prepare('SELECT display_name FROM identities WHERE address = ?').get(order.peer_address);
    peerName = row?.display_name || '';
  } catch {}
  const peer = peerName || (order.peer_address ? '...' + order.peer_address.slice(-8) : '');

  switch (action) {
    case 'accept':
      return `${order.side === 'buy' ? '买入' : '卖出'} ${kasAmt} KAS @ $${order.price}${peer ? '，对手方 ' + peer : ''} | 限额检查: ${kasAmt} KAS ✓`;
    case 'pay_usdt':
      return `向${peer ? ' ' + peer : '对方'}支付 ${usdtAmt} USDT（${chain} 链），换取 ${kasAmt} KAS`;
    case 'verify_payment':
      return `验证 ${chain} 链上 ${usdtAmt} USDT 到账`;
    case 'send_kas':
      return `发送 ${kasAmt} KAS 给${peer ? ' ' + peer : '对方'}，完成交割`;
    case 'cancel':
      return `取消订单（${kasAmt} KAS @ $${order.price}），锁定资金已释放`;
    case 'publish':
      return `发布${order.side === 'buy' ? '买入' : '卖出'}订单: ${kasAmt} KAS @ $${order.price}（${chain} 链）`;
    default:
      return `${action}: ${kasAmt} KAS`;
  }
}

function _buildActionDetails(action, order, opts) {
  const params = opts?.actionParams || {};
  return {
    action,
    orderId: order?.id || params.orderId || null,
    side: order?.side || params.side || null,
    kasAmount: order?.kas_amount || params.amount || params.kasAmount || null,
    usdtAmount: order?.usdt_amount || (order?.kas_amount || 0) * (order?.price || 0) || params.usdtAmount || null,
    price: order?.price || params.price || null,
    chain: order?.chain || params.chain || null,
    peerAddress: order?.peer_address || params.peerAddress || null,
    agentAddress: order?.agent_address || params.agentAddress || null,
    market: params.market || null,
    // Signal-engine + strategy-engine context (for post-trade analysis)
    strategy: params.strategy || null,
    anchor: params.anchor || null,
    signal: params.signal || null,       // { composite, confidence }
    regime: params.regime || null,
    stopLoss: params.stopLoss || null,
    takeProfit: params.takeProfit || null,
    reason: params.reason || null,
    brainDecision: params.brainDecision || null,  // ACCEPT / REJECT: reason
    ...params,
  };
}
