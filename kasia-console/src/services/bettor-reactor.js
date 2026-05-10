/**
 * Bettor Reactor — 调仓建议引擎 (Phase 3e-1, Owner 5/10 钦定 A + 30pp 止损)
 *
 * 复用 1h tracker 后跑 (boot tick + 1h interval, 错开 30s):
 *   1. 扫每个 open sim_position 的最新 snapshot
 *   2. 计算反向 drift (NO 仓怕 yes 涨, YES 仓怕 yes 跌)
 *   3. 触发 4 闸:
 *      - 反向 drift > 30pp → STOP_LOSS warning
 *      - 浮亏 < -50% size → STOP_LOSS critical
 *      - 反向 drift > 15pp AND PnL% < -25% → STOP_LOSS warning
 *      - σ-adjusted: 已存 sigma 高 (>20%) drift 容忍放宽到 40pp
 *   4. 写 bettor_adjustments 表 (status=pending)
 *   5. 不自动执行 — Owner UI 审批 (paper trade 阶段安全)
 *
 * Phase 3e-2 待加 (5/16 后):
 *   - LLM 重估 estimateP, sigma 反扩触发
 *   - inventory-aware sizing 入场前 cap
 *   - correlation 簇内累计仓位限
 */

import { randomUUID } from 'crypto';
import { sqlite } from '../db/client.js';

// Tunables (Owner 5/10 钦定起点, 7 天数据后校准)
const STOP_LOSS_DRIFT_PP = 30;          // 反向 drift > 30pp 触止损 warning
const STOP_LOSS_PNL_PCT = -50;          // 浮亏 < -50% 仓位 critical
const EARLY_DRIFT_PP = 15;              // 反向 drift 15pp + PnL% < -25% 提前 warning
const EARLY_PNL_PCT = -25;
const HIGH_SIGMA_TOLERANCE_PP = 40;     // σ>20% 时 drift 阈值放宽到 40pp
const HIGH_SIGMA_THRESHOLD = 0.20;
const REACTOR_INTERVAL_MS = 60 * 60 * 1000; // 1h

let _timer = null;
let _running = false;

// 反向 drift = direction 跟 drift 方向相反 (NO 仓: yes 涨=反向)
function adverseDriftPp(direction, driftPp) {
  if (direction === 'YES') return -driftPp; // YES 怕跌, drift 负 = 反向
  if (direction === 'NO') return driftPp;   // NO 怕涨, drift 正 = 反向
  return 0;
}

export async function evaluatePositions() {
  if (_running) return { skipped: 'already running' };
  _running = true;
  try {
    // open positions + latest snapshot + sigma
    // J1 #104 fix: 跳过已 resolve markets (current_yes_price ∈ {0, 1})
    // — resolver cron 会 close 它们, 不该当 stop-loss false-positive.
    const rows = sqlite.prepare(`
      SELECT
        p.id position_id, p.recommendation_id, p.relay_node_id, p.direction,
        p.entry_yes_price, p.entry_buy_price, p.size_usd, p.shares,
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

    let triggered = 0;
    const insertAdj = sqlite.prepare(`
      INSERT INTO bettor_adjustments
        (id, position_id, recommendation_id, relay_node_id, adj_type, trigger_reason,
         drift_pp, pnl_pct, unrealized_pnl, current_yes_price, severity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Skip if same position already has pending adjustment in last 24h (don't spam)
    const existsRecent = sqlite.prepare(`
      SELECT id FROM bettor_adjustments
      WHERE position_id = ? AND status = 'pending'
        AND created_at > datetime('now', '-24 hours')
      LIMIT 1
    `);

    const tx = sqlite.transaction((items) => {
      for (const r of items) {
        const adverse = adverseDriftPp(r.direction, r.drift_pp);
        const pnlPct = r.size_usd > 0 ? (r.unrealized_pnl / r.size_usd) * 100 : 0;
        const sigma = r.sigma || 0.05;

        // 决定阈值 (σ-adjusted)
        const driftThreshold = sigma > HIGH_SIGMA_THRESHOLD ? HIGH_SIGMA_TOLERANCE_PP : STOP_LOSS_DRIFT_PP;

        let trigger = null;
        let severity = 'warning';
        let reason = null;

        // 闸 1: 浮亏 critical
        if (pnlPct <= STOP_LOSS_PNL_PCT) {
          trigger = 'STOP_LOSS';
          severity = 'critical';
          reason = `pnl_pct ${pnlPct.toFixed(1)}% < ${STOP_LOSS_PNL_PCT}%`;
        }
        // 闸 2: 反向 drift > 阈值
        else if (adverse > driftThreshold) {
          trigger = 'STOP_LOSS';
          severity = adverse > driftThreshold * 1.5 ? 'critical' : 'warning';
          reason = `adverse drift ${adverse.toFixed(1)}pp > ${driftThreshold}pp${sigma > HIGH_SIGMA_THRESHOLD ? ' (σ-adjusted)' : ''}`;
        }
        // 闸 3: 早期止损 (drift + PnL 双确认)
        else if (adverse > EARLY_DRIFT_PP && pnlPct < EARLY_PNL_PCT) {
          trigger = 'STOP_LOSS';
          severity = 'warning';
          reason = `adverse drift ${adverse.toFixed(1)}pp + pnl_pct ${pnlPct.toFixed(1)}%`;
        }

        if (trigger) {
          // dedup: 24h 内已有 pending 同 position 跳过
          if (existsRecent.get(r.position_id)) continue;
          insertAdj.run(
            randomUUID(), r.position_id, r.recommendation_id, r.relay_node_id,
            trigger, reason, r.drift_pp, pnlPct, r.unrealized_pnl, r.current_yes_price, severity
          );
          triggered++;
          console.log(`[bettor-reactor] ${severity.toUpperCase()} ${r.position_id.slice(0,8)} ${r.direction} drift=${r.drift_pp.toFixed(1)}pp pnl=${pnlPct.toFixed(1)}% — ${reason}`);
        }
      }
    });
    tx(rows);

    console.log(`[bettor-reactor] evaluated ${rows.length} open, triggered ${triggered} adjustments`);
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
  // Boot tick at 75s (after tracker boot tick at 45s, give snapshots time first)
  setTimeout(() => {
    evaluatePositions().catch(err => console.log(`[bettor-reactor] boot tick error: ${err.message}`));
  }, 75_000);
  console.log(`[bettor-reactor] cron registered: every ${REACTOR_INTERVAL_MS / 3600000}h (Owner 5/10 钦定 30pp 止损)`);
}

export function stopReactorCron() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

// Inventory-aware sizing: get total open size for a relay (for future use by scanner)
export function getOpenInventory(relayNodeId) {
  const r = sqlite.prepare(`
    SELECT COALESCE(SUM(size_usd), 0) total, COUNT(*) n
    FROM bettor_sim_positions
    WHERE relay_node_id = ? AND closed_at IS NULL AND size_usd > 0
  `).get(relayNodeId || '');
  return { total: r.total, count: r.n };
}
