/**
 * Bettor Position Tracker — 纸面持仓时点快照 (Phase 3e-0, Owner 5/9 钦定)
 *
 * 1h cron 给每个 open sim_position 拍价格快照:
 *   current_yes_price → unrealized_pnl + drift_pp
 *   累更 max_drawdown_pp / max_unrealized_gain_pp 到 sim_position
 *
 * 数据用途:
 *   - 7 天后看 drift 分布 → Phase 3e-1 标定止损阈值
 *   - 看持仓时长 vs PnL → 标定持有期
 *   - 看 mean-revert 模式 → 加仓/减仓策略输入
 */

import { randomUUID } from 'crypto';
import { sqlite } from '../db/client.js';
import { fetchPredictionData } from './market-data.js';

const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000; // 1h
let _timer = null;
let _running = false;

function computePnl(direction, entryBuyPrice, currentYesPrice, sizeUsd) {
  if (direction === 'SKIP' || sizeUsd <= 0 || entryBuyPrice <= 0) return 0;
  const currentBuy = direction === 'YES' ? currentYesPrice : (1 - currentYesPrice);
  // shares = sizeUsd / entryBuyPrice; current_value = shares * currentBuy
  // unrealized_pnl = current_value - sizeUsd
  return sizeUsd * (currentBuy / entryBuyPrice - 1);
}

export async function snapshotOpenPositions() {
  if (_running) return { skipped: 'already running' };
  _running = true;
  try {
    const positions = sqlite.prepare(`
      SELECT id, recommendation_id, direction, entry_yes_price, entry_buy_price,
             size_usd, max_drawdown_pp, max_unrealized_gain_pp
      FROM bettor_sim_positions
      WHERE closed_at IS NULL AND direction != 'SKIP' AND size_usd > 0
    `).all();

    if (positions.length === 0) {
      return { snapshotted: 0, missing: 0, total: 0 };
    }

    const fetched = await fetchPredictionData();
    if (!fetched.ok) {
      console.log(`[bettor-tracker] fetch failed: ${fetched.error}`);
      return { error: fetched.error };
    }

    // Build lookup: condition_id → market
    const byCid = new Map();
    for (const m of (fetched.data || [])) {
      if (m.conditionId) byCid.set(m.conditionId, m);
    }
    // Also lookup by market_id (id) for any without conditionId
    const byMid = new Map();
    for (const m of (fetched.data || [])) {
      if (m.id != null) byMid.set(String(m.id), m);
    }

    const now = new Date().toISOString();
    let snap = 0, missing = 0;

    const insertSnap = sqlite.prepare(`
      INSERT INTO bettor_sim_snapshots (id, position_id, snapshot_at, current_yes_price, current_buy_price, unrealized_pnl, drift_pp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updatePos = sqlite.prepare(`
      UPDATE bettor_sim_positions
      SET last_snapshot_at = ?,
          max_drawdown_pp = CASE WHEN ? < COALESCE(max_drawdown_pp, 0) THEN ? ELSE max_drawdown_pp END,
          max_unrealized_gain_pp = CASE WHEN ? > COALESCE(max_unrealized_gain_pp, 0) THEN ? ELSE max_unrealized_gain_pp END
      WHERE id = ?
    `);

    const tx = sqlite.transaction((rows) => {
      for (const p of rows) {
        // Find rec to get cid/mid
        const rec = sqlite.prepare(`SELECT condition_id, market_id FROM bettor_recommendations WHERE id = ?`).get(p.recommendation_id);
        if (!rec) { missing++; continue; }
        const market = (rec.condition_id && byCid.get(rec.condition_id)) || byMid.get(String(rec.market_id));
        if (!market || market.yes == null) { missing++; continue; }

        const currentYes = market.yes / 100;
        const currentBuy = p.direction === 'YES' ? currentYes : (1 - currentYes);
        const unrealizedPnl = computePnl(p.direction, p.entry_buy_price, currentYes, p.size_usd);
        // drift_pp from entry yes price (positive = yes went up)
        const driftPp = (currentYes - p.entry_yes_price) * 100;
        // For position P&L tracking: drawdown is the most-negative pnl/size %, gain is most-positive
        const pnlPct = p.size_usd > 0 ? (unrealizedPnl / p.size_usd) * 100 : 0;

        insertSnap.run(randomUUID(), p.id, now, currentYes, currentBuy, unrealizedPnl, driftPp);
        updatePos.run(now, pnlPct, pnlPct, pnlPct, pnlPct, p.id);
        snap++;
      }
    });
    tx(positions);

    console.log(`[bettor-tracker] snapshotted ${snap}/${positions.length} open positions (${missing} missing market data)`);
    return { snapshotted: snap, missing, total: positions.length };
  } finally {
    _running = false;
  }
}

export function isTrackerRunning() { return _running; }

export function startTrackerCron() {
  if (_timer) return;
  _timer = setInterval(() => {
    snapshotOpenPositions().catch(err => console.log(`[bettor-tracker] cron error: ${err.message}`));
  }, SNAPSHOT_INTERVAL_MS);
  // Boot tick at 45s (after Console settles, after resolver boot tick at 30s)
  setTimeout(() => {
    snapshotOpenPositions().catch(err => console.log(`[bettor-tracker] boot tick error: ${err.message}`));
  }, 45_000);
  console.log(`[bettor-tracker] cron registered: every ${SNAPSHOT_INTERVAL_MS / 3600000}h`);
}

export function stopTrackerCron() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
