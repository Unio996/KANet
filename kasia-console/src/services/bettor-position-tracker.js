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
import { evaluatePosition, writeAdjustment } from './bettor-reactor.js';

const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000; // 1h
// Phase 3e-6 P1 (Bettor r33/r36): tracker price diff event trigger
const PRICE_DIFF_TRIGGER_PP = 0.10;          // |latest - prev| > 10pp → trigger reactor immediate
const TRIGGER_COOLDOWN_MS = 5 * 60 * 1000;   // 同 position 5min 内不重触 (防 snapshot race + concurrent ticks)
const _recentlyTriggered = new Map();        // position_id → last trigger timestamp (in-memory, restart 清)
// Phase 3e-6 P2 (Bettor r37 K-P): urgent cron <24h to expiry (binary 价格加速期)
const URGENT_INTERVAL_MS = 15 * 60 * 1000;   // 15min
const URGENT_WINDOW_HOURS = 24;              // positions ending within 24h

let _timer = null;
let _urgentTimer = null;
let _running = false;

function computePnl(direction, entryBuyPrice, currentYesPrice, sizeUsd) {
  if (direction === 'SKIP' || sizeUsd <= 0 || entryBuyPrice <= 0) return 0;
  const currentBuy = direction === 'YES' ? currentYesPrice : (1 - currentYesPrice);
  // shares = sizeUsd / entryBuyPrice; current_value = shares * currentBuy
  // unrealized_pnl = current_value - sizeUsd
  return sizeUsd * (currentBuy / entryBuyPrice - 1);
}

export async function snapshotOpenPositions({ urgentOnly = false } = {}) {
  if (_running) return { skipped: 'already running' };
  _running = true;
  try {
    // Phase 3e-6 P2: urgentOnly filter — 仅扫 endDate < now+24h positions (binary 价格加速期).
    // JOIN bettor_recommendations 拿 end_date (sim_positions 表无此字段).
    const positions = urgentOnly
      ? sqlite.prepare(`
          SELECT p.id, p.recommendation_id, p.direction, p.entry_yes_price, p.entry_buy_price,
                 p.size_usd, p.max_drawdown_pp, p.max_unrealized_gain_pp
          FROM bettor_sim_positions p
          JOIN bettor_recommendations r ON r.id = p.recommendation_id
          WHERE p.closed_at IS NULL AND p.direction != 'SKIP' AND p.size_usd > 0
            AND r.end_date IS NOT NULL
            AND r.end_date < datetime('now', '+${URGENT_WINDOW_HOURS} hours')
            AND r.end_date > datetime('now')
        `).all()
      : sqlite.prepare(`
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

    // Phase 3e-6 P1: prev snapshot lookup for price diff trigger detection
    const prevSnapStmt = sqlite.prepare(`
      SELECT current_yes_price FROM bettor_sim_snapshots
      WHERE position_id = ? ORDER BY snapshot_at DESC LIMIT 1
    `);
    // Collect trigger candidates inside tx (snapshot synchronous), dispatch async after tx commit
    const triggerCandidates = [];

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

        // Phase 3e-6 P1 (Bettor r36 F-J): check prev snapshot price diff BEFORE inserting new
        const prev = prevSnapStmt.get(p.id);
        const priceDiff = prev ? Math.abs(currentYes - prev.current_yes_price) : 0;
        const triggerReactor = prev && priceDiff > PRICE_DIFF_TRIGGER_PP;

        insertSnap.run(randomUUID(), p.id, now, currentYes, currentBuy, unrealizedPnl, driftPp);
        updatePos.run(now, pnlPct, pnlPct, pnlPct, pnlPct, p.id);
        snap++;

        if (triggerReactor) {
          // Cooldown check: same position re-trigger within 5min → skip
          const lastTrig = _recentlyTriggered.get(p.id);
          if (lastTrig && (Date.now() - lastTrig) < TRIGGER_COOLDOWN_MS) {
            continue; // 5min cooldown active, skip
          }
          _recentlyTriggered.set(p.id, Date.now());
          triggerCandidates.push({ position_id: p.id, currentYes, currentBuy, unrealizedPnl, driftPp, priceDiff });
        }
      }
    });
    tx(positions);

    const tag = urgentOnly ? 'urgent tick (<24h to expiry)' : 'cron tick';
    console.log(`[bettor-tracker] ${tag} snapshotted ${snap}/${positions.length} open positions (${missing} missing market data)`);

    // Phase 3e-6 P1: dispatch event-driven evaluatePosition for triggered positions (async, post-tx)
    for (const cand of triggerCandidates) {
      try {
        // Fetch full positionRow for reactor evaluatePosition (含 market_description + relay)
        const fullRow = sqlite.prepare(`
          SELECT p.id position_id, p.recommendation_id, p.relay_node_id, p.direction,
                 p.entry_yes_price, p.entry_buy_price, p.size_usd, p.shares, p.market_description,
                 r.sigma, r.question, r.end_date
          FROM bettor_sim_positions p
          JOIN bettor_recommendations r ON r.id = p.recommendation_id
          WHERE p.id = ?
        `).get(cand.position_id);
        if (!fullRow) continue;
        // Inject latest snapshot fields (just-inserted, not yet visible to fresh JOIN here)
        fullRow.current_yes_price = cand.currentYes;
        fullRow.unrealized_pnl = cand.unrealizedPnl;
        fullRow.drift_pp = cand.driftPp;

        console.log(`[bettor-tracker] market ${cand.position_id.slice(0, 8)} moved ${(cand.priceDiff * 100).toFixed(1)}pp → trigger reactor evaluatePosition`);
        const action = await evaluatePosition(fullRow);
        if (action) {
          writeAdjustment(fullRow, action, '[bettor-tracker→reactor]');
        }
      } catch (e) {
        console.log(`[bettor-tracker] P1 trigger fail ${cand.position_id.slice(0, 8)}: ${e.message?.slice(0, 100)}`);
      }
    }

    return { snapshotted: snap, missing, total: positions.length, triggered: triggerCandidates.length };
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

  // Phase 3e-6 P2: urgent cron 15min tick for positions ending <24h (binary 价格加速期)
  if (_urgentTimer) return;
  _urgentTimer = setInterval(() => {
    snapshotOpenPositions({ urgentOnly: true }).catch(err => console.log(`[bettor-tracker] urgent cron error: ${err.message}`));
  }, URGENT_INTERVAL_MS);
  console.log(`[bettor-tracker] urgent cron registered: every ${URGENT_INTERVAL_MS / 60000}min (positions <${URGENT_WINDOW_HOURS}h to expiry)`);
}

export function stopTrackerCron() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_urgentTimer) { clearInterval(_urgentTimer); _urgentTimer = null; }
}
