/**
 * Bettor Reactor — Kelly delta 决策引擎 (Phase 3e-6, Owner 5/11 钦定 + Bettor r30 architect 第一性原理)
 *
 * 1h cron + boot tick 75s (在 resolver 15s + tracker 45s 之后):
 *   1. SQL JOIN open sim_positions + latest snapshot + recommendation sigma + sim_position.market_description (P0.1 加 column)
 *   2. evaluatePosition(positionRow): LLM 重估 (estimateP) → recommendBet (Kelly + Layer 1-4 闸) → target_size
 *   3. delta = target_size - current_size
 *      - target_size === 0       → CLOSE_ALL (Kelly/confidence/sigma 任一闸 SKIP)
 *      - delta < -size × 0.2      → REDUCE (target 缩 > 20%)
 *      - delta > $5               → ADD (target 升, LLM 重估 pMid 升)
 *      - |delta| < $5             → hold (噪音, 跟 Polymarket min order align)
 *   4. 写 bettor_adjustments (status='pending', Owner UI 审批 — paper trade safety + Phase 3e-3 真盘 endpoint align)
 *   5. dedup 24h 同 position + 同 adj_type
 *
 * 第一性原理: 入场/加仓/止损/批次 = 1 个 delta 模型
 * 加仓: target 升 (LLM 重估 pMid 升), 不是 market 反向跑 (反摊平亏损)
 * 止损: target=0 (Kelly/confidence/sigma 任一闸 SKIP) 自动 CLOSE_ALL
 *
 * Phase 3e-1 legacy:
 *   - STOP_LOSS adj_type 保留 schema, 老 dismissed row 不删 (审计 trail)
 *   - P0.2 reactor 不再写 STOP_LOSS, 全新 adj_type=CLOSE_ALL/ADD/REDUCE
 */

import { randomUUID } from 'crypto';
import { sqlite } from '../db/client.js';
import { callLLMWithFallback } from './llm-fallback.js';
import { getActiveConfidenceThreshold, getAdapterUrlForAgent } from './bettor-scanner.js';

const KANET_ROOT = process.env.KANET_ROOT || 'C:/kanet';

// Lazy load agent-mind lib (跟 scanner 同 pattern, file:// dynamic import)
// P0.3 export loadLib for test setup (prime _parseRule + _recommendBet before evaluatePosition stub)
let _parseRule, _estimateP, _recommendBet;
export async function loadLib() {
  if (_parseRule) return;
  const rp = await import(`file:///${KANET_ROOT}/agent-mind/src/skills/bettor/rule-parser.mjs`);
  const e = await import(`file:///${KANET_ROOT}/agent-mind/src/skills/bettor/estimator.mjs`);
  const k = await import(`file:///${KANET_ROOT}/agent-mind/src/skills/bettor/kelly.mjs`);
  _parseRule = rp.parseRule;
  _estimateP = e.estimateP;
  _recommendBet = k.recommendBet;
}

// Tunables (Phase 3e-6 Bettor r30/r31 决断)
const DEFAULT_BANKROLL = 1000;
const TRAINING_CUTOFF = '2026-01-31';
const HOLD_NOISE_THRESHOLD_USD = 5;        // |delta| < $5 hold (噪音, 跟 Polymarket min order align)
const REDUCE_PCT_THRESHOLD = 0.2;          // delta < -current × 20% → REDUCE
const REACTOR_INTERVAL_MS = 60 * 60 * 1000; // 1h

let _timer = null;
let _running = false;

/**
 * Single position evaluator — Kelly delta 模型 (Phase 3e-6 P0.2 architect spec).
 * Returns: { adj_type, severity, trigger_reason, target_size, delta } OR null (hold/noise).
 *
 * P0.3 dependency injection: opts.estimatePFn override estimateP (test stub support).
 * Default opts={} → 走 module-loaded _estimateP + callLLMWithFallback (production path).
 */
export async function evaluatePosition(pos, opts = {}) {
  // Guard: 老 backfill rows market_description=NULL 跳过 (P0.1 ship 前数据)
  if (!pos.market_description) return null;

  const adapterUrl = opts.adapterUrl || getAdapterUrlForAgent(pos.relay_node_id);
  if (!adapterUrl && !opts.estimatePFn) return null;

  // 1. parse rule + LLM 重估 pMid/sigma
  let parsed;
  try { parsed = _parseRule(pos.market_description); } catch { return null; }

  const llmCallback = opts.llmCallback || (async (prompt) => {
    const r = await callLLMWithFallback({ system: prompt, user: '', adapterUrl });
    return r.ok ? r.text : null;
  });

  const estimatePFn = opts.estimatePFn || _estimateP;

  let estimate;
  try {
    estimate = await estimatePFn({
      ruleText: pos.market_description,
      parsed,
      trainingCutoff: TRAINING_CUTOFF,
      llm: llmCallback,
    });
  } catch (e) {
    console.log(`[bettor-reactor] estimateP fail ${pos.position_id.slice(0, 8)}: ${e.message?.slice(0, 100)}`);
    return null;
  }

  // 2. recommendBet (Kelly + Layer 1-4 闸 same as scanner)
  // P0.3 opts.confidenceThreshold override for test (避 sqlite config_entries 依赖)
  const activeThreshold = (typeof opts.confidenceThreshold === 'number')
    ? opts.confidenceThreshold
    : getActiveConfidenceThreshold();
  const newRec = _recommendBet({
    pMid: estimate.pMid,
    sigma: estimate.sigma,
    infoGapMonths: estimate.infoGapMonths,
    yesPrice: pos.current_yes_price,
    bankroll: DEFAULT_BANKROLL,
    confidenceThreshold: activeThreshold,
  });

  // 3. target = newRec.side 匹 pos.direction ? newRec.size : 0
  const targetSize = (newRec.side === pos.direction) ? newRec.size : 0;
  const delta = targetSize - pos.size_usd;

  // 4. 决定 action
  if (targetSize === 0) {
    // Kelly/confidence/sigma 任一闸 SKIP → CLOSE_ALL
    return {
      adj_type: 'CLOSE_ALL',
      severity: 'critical',
      trigger_reason: `Kelly target=0 (newRec.side=${newRec.side}, pMid=${estimate.pMid.toFixed(3)}, σ=${estimate.sigma.toFixed(3)}, threshold=${activeThreshold}): ${newRec.reasoning?.[0] || 'unknown'}`,
      target_size: 0,
      delta,
    };
  }
  if (Math.abs(delta) < HOLD_NOISE_THRESHOLD_USD) {
    return null; // hold (噪音, 跟 Polymarket min order $5 align)
  }
  if (delta < -pos.size_usd * REDUCE_PCT_THRESHOLD) {
    return {
      adj_type: 'REDUCE',
      severity: 'warning',
      trigger_reason: `target $${targetSize.toFixed(2)} < current $${pos.size_usd.toFixed(2)} × ${(1 - REDUCE_PCT_THRESHOLD).toFixed(1)} (LLM 重估 pMid=${estimate.pMid.toFixed(3)} target 缩)`,
      target_size: targetSize,
      delta,
    };
  }
  if (delta > HOLD_NOISE_THRESHOLD_USD) {
    return {
      adj_type: 'ADD',
      severity: 'warning',
      trigger_reason: `target $${targetSize.toFixed(2)} > current $${pos.size_usd.toFixed(2)} + $${HOLD_NOISE_THRESHOLD_USD} (LLM 重估 pMid=${estimate.pMid.toFixed(3)} target 升)`,
      target_size: targetSize,
      delta,
    };
  }
  return null; // edge case: delta in (-size×0.2, -$5] 区间 hold
}

export async function evaluatePositions() {
  if (_running) return { skipped: 'already running' };
  _running = true;
  try {
    await loadLib();

    // open positions + latest snapshot + sigma + market_description (P0.1 加 column)
    // J1 #104 fix retained: yes_price ∈ (0.01, 0.99) 跳过已 resolve markets (resolver cron close)
    const rows = sqlite.prepare(`
      SELECT
        p.id position_id, p.recommendation_id, p.relay_node_id, p.direction,
        p.entry_yes_price, p.entry_buy_price, p.size_usd, p.shares,
        p.market_description,
        r.sigma, r.question, r.end_date,
        s.current_yes_price, s.unrealized_pnl, s.drift_pp, s.snapshot_at
      FROM bettor_sim_positions p
      JOIN bettor_recommendations r ON r.id = p.recommendation_id
      LEFT JOIN bettor_sim_snapshots s ON s.id = (
        SELECT id FROM bettor_sim_snapshots WHERE position_id = p.id
        ORDER BY snapshot_at DESC LIMIT 1
      )
      WHERE p.closed_at IS NULL AND p.direction != 'SKIP' AND p.size_usd > 0
        AND s.id IS NOT NULL
        AND s.current_yes_price > 0.01 AND s.current_yes_price < 0.99
    `).all();

    if (rows.length === 0) {
      return { evaluated: 0, triggered: 0 };
    }

    const insertAdj = sqlite.prepare(`
      INSERT INTO bettor_adjustments
        (id, position_id, recommendation_id, relay_node_id, adj_type, trigger_reason,
         drift_pp, pnl_pct, unrealized_pnl, current_yes_price, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // dedup 24h: 同 position + 同 adj_type pending 跳 (防 1h cron 重复 ADD 24 次)
    const existsRecent = sqlite.prepare(`
      SELECT id FROM bettor_adjustments
      WHERE position_id = ? AND adj_type = ? AND status = 'pending'
        AND created_at > datetime('now', '-24 hours')
      LIMIT 1
    `);

    let triggered = 0;
    for (const r of rows) {
      const action = await evaluatePosition(r);
      if (!action) continue;

      // dedup
      if (existsRecent.get(r.position_id, action.adj_type)) continue;

      const pnlPct = r.size_usd > 0 ? (r.unrealized_pnl / r.size_usd) * 100 : 0;
      insertAdj.run(
        randomUUID(), r.position_id, r.recommendation_id, r.relay_node_id,
        action.adj_type, action.trigger_reason,
        r.drift_pp, pnlPct, r.unrealized_pnl, r.current_yes_price, action.severity
      );
      triggered++;
      console.log(`[bettor-reactor] ${action.severity.toUpperCase()} ${action.adj_type} ${r.position_id.slice(0, 8)} ${r.direction} target=$${action.target_size.toFixed(2)} delta=$${action.delta.toFixed(2)} — ${action.trigger_reason.slice(0, 150)}`);
    }

    console.log(`[bettor-reactor] evaluated ${rows.length} open, triggered ${triggered} adjustments (Kelly delta 模型 Phase 3e-6)`);
    return { evaluated: rows.length, triggered };
  } finally {
    _running = false;
  }
}

export function isReactorRunning() { return _running; }

export function startReactorCron() {
  if (_timer) return;
  _timer = setInterval(() => {
    evaluatePositions().catch(err => console.log(`[bettor-reactor] cron error: ${err.message}`));
  }, REACTOR_INTERVAL_MS);
  // Boot tick 75s (after resolver 15s + tracker 45s)
  setTimeout(() => {
    evaluatePositions().catch(err => console.log(`[bettor-reactor] boot tick error: ${err.message}`));
  }, 75_000);
  console.log(`[bettor-reactor] cron registered: every ${REACTOR_INTERVAL_MS / 3600000}h (Phase 3e-6 Kelly delta 模型)`);
}

export function stopReactorCron() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

// Inventory query (Phase 3e-1 retained, scanner inventory-aware sizing 用)
export function getOpenInventory(relayNodeId) {
  const r = sqlite.prepare(`
    SELECT COALESCE(SUM(size_usd), 0) total, COUNT(*) n
    FROM bettor_sim_positions
    WHERE relay_node_id = ? AND closed_at IS NULL AND size_usd > 0
  `).get(relayNodeId || '');
  return { total: r.total, count: r.n };
}
