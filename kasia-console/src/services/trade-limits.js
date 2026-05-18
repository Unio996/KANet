/**
 * Trade Limits Service — 限额检查 + 配置校验
 *
 * 硬约束：auto_mode_max <= per_order_max × 0.3
 * 三层限额：per_order → daily_total → auto_mode（最严格）
 */

import { sqlite } from '../db/client.js';

// ── 配置读取 ──

function _getLimit(key) {
  const row = sqlite.prepare(
    "SELECT value_encrypted as val FROM config_entries WHERE key = ?"
  ).get(key);
  return row ? parseFloat(row.val) : null;
}

/**
 * 获取所有限额配置。
 */
export function getLimits() {
  return {
    per_order_max_kas:    _getLimit('per_order_max_kas') ?? 1000,
    per_order_max_usdt:   _getLimit('per_order_max_usdt') ?? 100,
    daily_total_max_kas:  _getLimit('daily_total_max_kas') ?? 5000,
    daily_total_max_usdt: _getLimit('daily_total_max_usdt') ?? 500,
    auto_mode_max_kas:    _getLimit('auto_mode_max_kas') ?? 200,
    auto_mode_max_usdt:   _getLimit('auto_mode_max_usdt') ?? 20,
  };
}

// ── 当日用量查询 ──

/**
 * 查询某 Agent 当日的交易总量（已完成/已付款的订单）。
 */
export function getDailyUsage(agentAddress) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const since = todayStart.toISOString();

  // NWT N14 Phase β Step 2 sub#2 (5/18 OTC deprecated): mm_orders read → exchange_offers.
  // Schema 转: kas_amount/usdt_amount 从 give/want_asset 抽, status → protocol_status.
  // agent_address 在 exchange_offers 是 maker (broker = maker pattern).
  const kas = sqlite.prepare(`
    SELECT COALESCE(SUM(
      CASE WHEN UPPER(give_asset) = 'KAS' THEN CAST(give_amount AS REAL)
           WHEN UPPER(want_asset) = 'KAS' THEN CAST(want_amount AS REAL) ELSE 0 END
    ), 0) as total
    FROM exchange_offers
    WHERE maker = ? AND created_at >= ? AND protocol_status NOT IN ('cancelled', 'expired', 'timed_out', 'refunded', 'failed')
  `).get(agentAddress, since);

  const usdt = sqlite.prepare(`
    SELECT COALESCE(SUM(
      CASE WHEN UPPER(give_asset) LIKE 'USD%' THEN CAST(give_amount AS REAL)
           WHEN UPPER(want_asset) LIKE 'USD%' THEN CAST(want_amount AS REAL) ELSE 0 END
    ), 0) as total
    FROM exchange_offers
    WHERE maker = ? AND created_at >= ? AND protocol_status NOT IN ('cancelled', 'expired', 'timed_out', 'refunded', 'failed')
  `).get(agentAddress, since);

  return { kas: kas.total, usdt: usdt.total };
}

// ── 限额检查 ──

/**
 * 检查一笔交易是否在限额内。
 *
 * @param {string} agentAddress
 * @param {number} kasAmount — KAS 数量
 * @param {number} usdtAmount — USDT 金额
 * @param {string} mode — 'auto' / 'approval' / 'manual'
 * @returns {{ ok: boolean, error?: string, detail?: object }}
 */
export function checkLimits(agentAddress, kasAmount, usdtAmount, mode = 'manual') {
  const limits = getLimits();

  // 1. per_order 限额
  if (kasAmount > limits.per_order_max_kas) {
    return { ok: false, error: 'per_order_kas_exceeded', detail: { max: limits.per_order_max_kas, requested: kasAmount } };
  }
  if (usdtAmount > limits.per_order_max_usdt) {
    return { ok: false, error: 'per_order_usdt_exceeded', detail: { max: limits.per_order_max_usdt, requested: usdtAmount } };
  }

  // 2. auto 模式更严格的限额
  if (mode === 'auto') {
    if (kasAmount > limits.auto_mode_max_kas) {
      return { ok: false, error: 'auto_mode_kas_exceeded', detail: { max: limits.auto_mode_max_kas, requested: kasAmount } };
    }
    if (usdtAmount > limits.auto_mode_max_usdt) {
      return { ok: false, error: 'auto_mode_usdt_exceeded', detail: { max: limits.auto_mode_max_usdt, requested: usdtAmount } };
    }
  }

  // 3. daily_total 限额
  const usage = getDailyUsage(agentAddress);
  if (usage.kas + kasAmount > limits.daily_total_max_kas) {
    return { ok: false, error: 'daily_kas_exceeded', detail: { max: limits.daily_total_max_kas, used: usage.kas, requested: kasAmount } };
  }
  if (usage.usdt + usdtAmount > limits.daily_total_max_usdt) {
    return { ok: false, error: 'daily_usdt_exceeded', detail: { max: limits.daily_total_max_usdt, used: usage.usdt, requested: usdtAmount } };
  }

  return { ok: true };
}

// ── 配置校验 ──

/**
 * 校验限额配置是否合法。
 * 硬约束：auto_mode_max <= per_order_max × 0.3
 *
 * @param {object} config — { per_order_max_kas, auto_mode_max_kas, ... }
 * @returns {{ ok: boolean, errors?: string[] }}
 */
export function validateLimitConfig(config) {
  const errors = [];

  const perKas = config.per_order_max_kas;
  const perUsdt = config.per_order_max_usdt;
  const autoKas = config.auto_mode_max_kas;
  const autoUsdt = config.auto_mode_max_usdt;

  if (perKas !== undefined && perKas <= 0) errors.push('per_order_max_kas must be positive');
  if (perUsdt !== undefined && perUsdt <= 0) errors.push('per_order_max_usdt must be positive');

  // 硬约束：auto <= per_order × 0.3
  const effectivePerKas = perKas ?? _getLimit('per_order_max_kas') ?? 1000;
  const effectivePerUsdt = perUsdt ?? _getLimit('per_order_max_usdt') ?? 100;
  const effectiveAutoKas = autoKas ?? _getLimit('auto_mode_max_kas') ?? 200;
  const effectiveAutoUsdt = autoUsdt ?? _getLimit('auto_mode_max_usdt') ?? 20;

  if (effectiveAutoKas > effectivePerKas * 0.3) {
    errors.push(`auto_mode_max_kas (${effectiveAutoKas}) exceeds 30% of per_order_max_kas (${effectivePerKas} × 0.3 = ${effectivePerKas * 0.3})`);
  }
  if (effectiveAutoUsdt > effectivePerUsdt * 0.3) {
    errors.push(`auto_mode_max_usdt (${effectiveAutoUsdt}) exceeds 30% of per_order_max_usdt (${effectivePerUsdt} × 0.3 = ${effectivePerUsdt * 0.3})`);
  }

  // daily >= per_order
  const dailyKas = config.daily_total_max_kas ?? _getLimit('daily_total_max_kas') ?? 5000;
  const dailyUsdt = config.daily_total_max_usdt ?? _getLimit('daily_total_max_usdt') ?? 500;
  if (effectivePerKas > dailyKas) errors.push('per_order_max_kas exceeds daily_total_max_kas');
  if (effectivePerUsdt > dailyUsdt) errors.push('per_order_max_usdt exceeds daily_total_max_usdt');

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

// ═══════════════════════════════════════════════════════════════
//  Risk Management — Drawdown Controls
// ═══════════════════════════════════════════════════════════════

/**
 * Check daily P&L drawdown (3-tier circuit breaker).
 * @param {number} todayPnl — today's P&L (negative = loss)
 * @param {number} totalValue — total portfolio value
 * @returns {{ allowed: boolean, halfPosition?: boolean, reason?: string }}
 */
export function checkDrawdown(todayPnl, totalValue) {
  if (!totalValue || totalValue <= 0) return { allowed: true, halfPosition: false };
  const drawdownPct = Math.abs(Math.min(0, todayPnl)) / totalValue * 100;

  if (drawdownPct >= 10) {
    return { allowed: false, reason: `日亏损 ${drawdownPct.toFixed(1)}% ≥ 10%，停止交易` };
  }
  if (drawdownPct >= 5) {
    return { allowed: true, halfPosition: true, reason: `日亏损 ${drawdownPct.toFixed(1)}% ≥ 5%，仓位减半` };
  }
  return { allowed: true, halfPosition: false };
}

/**
 * Check volatility circuit breaker.
 * @param {number} volatilitySignal — from signal-engine (0-100)
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkVolatility(volatilitySignal) {
  if (volatilitySignal > 80) {
    return { allowed: false, reason: `波动率 ${volatilitySignal}/100 > 80，暂停交易` };
  }
  return { allowed: true };
}

/**
 * Check total equity drawdown (hard freeze).
 * @param {number} currentValue — current portfolio value
 * @param {number} peakValue — historical peak value
 * @returns {{ allowed: boolean, freeze?: boolean, reason?: string }}
 */
export function checkTotalDrawdown(currentValue, peakValue) {
  if (!peakValue || peakValue <= 0) return { allowed: true };
  const drawdownPct = (peakValue - currentValue) / peakValue * 100;
  if (drawdownPct >= 15) {
    return { allowed: false, freeze: true, reason: `总回撤 ${drawdownPct.toFixed(1)}% ≥ 15%，冻结交易等待人工确认` };
  }
  return { allowed: true };
}
