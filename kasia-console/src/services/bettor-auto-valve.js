// Phase B auto-valve (Owner 5/16 钦定 "万一我忘记了" 兜底救命 + Bettor r137 spec hand-off J1).
// 1h cron tick, 4 valve check per open sim_position:
//   A: settled + Polymarket CTF redeemable → auto-redeem chain TX (零风险)
//   B: sim 仓位 condition_id resolved via historical_resolutions OR /api/predictions/positions → mark closed (sim only)
//   C: unrealized pnl < -30% AND opened_at > 12h ago → close @ market (sim) / sell (真盘 future) (🟡 损失锁定截 catastrophic)
//   D: opened_at > 90d AND 30d 内 abs price drift < 20pp → close @ market (zombie 释放资金)
//
// 不写 bettor_adjustments (bypass Owner approve, 这是兜底自动 valve 不是 propose).
// 触发后写 chain_events 表 + dev-alert 频道 broadcast.
// Phase B Sub B5/B6 strategy 多样性 (task #22) standby — 不在此 service scope.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

const TICK_INTERVAL_MS = 60 * 60 * 1000;  // 1h cron
const VALVE_C_PNL_THRESHOLD = -0.30;        // -30% unrealized pnl
const VALVE_C_COOLDOWN_HOURS = 12;          // 12h opened_at minimum
const VALVE_D_AGE_DAYS = 90;                // 90 天 zombie age
const VALVE_D_DRIFT_THRESHOLD_PP = 0.20;    // 30 天内 abs price drift < 20pp

let timer = null;
let running = false;

export function startAutoValveCron() {
  if (timer) return;
  console.log('[auto-valve] started (1h cron, 4 valves: A redeem / B sim resolved / C -30%pnl 12h / D 90d zombie)');
  // First tick after 60s grace (let other crons settle on Console startup)
  setTimeout(() => evaluateAll().catch(e => console.error('[auto-valve] initial tick fail:', e.message)), 60_000);
  timer = setInterval(() => {
    evaluateAll().catch(e => console.error('[auto-valve] tick fail:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopAutoValveCron() {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function evaluateAll() {
  if (running) {
    console.log('[auto-valve] tick skipped (previous still running)');
    return { skipped: true };
  }
  running = true;
  const startedAt = Date.now();
  const triggers = { A: 0, B: 0, C: 0, D: 0 };
  try {
    const openPositions = sqlite.prepare(`
      SELECT p.id, p.recommendation_id, p.relay_node_id, p.direction, p.entry_yes_price,
             p.entry_buy_price, p.size_usd, p.shares, p.opened_at, p.last_snapshot_at,
             p.max_drawdown_pp, p.max_unrealized_gain_pp,
             r.condition_id, r.question, r.yes_price AS current_yes_price
      FROM bettor_sim_positions p
      LEFT JOIN bettor_recommendations r ON r.id = p.recommendation_id
      WHERE p.closed_at IS NULL
    `).all();
    console.log(`[auto-valve] tick: ${openPositions.length} open positions to evaluate`);

    for (const pos of openPositions) {
      try {
        const triggered = await evaluatePosition(pos);
        if (triggered) triggers[triggered.valve] = (triggers[triggered.valve] || 0) + 1;
      } catch (e) {
        console.error(`[auto-valve] eval fail for pos ${pos.id?.slice(0, 8)}: ${e.message}`);
      }
    }

    const elapsed = Date.now() - startedAt;
    console.log(`[auto-valve] tick done in ${elapsed}ms: A=${triggers.A} B=${triggers.B} C=${triggers.C} D=${triggers.D}`);
    return { ok: true, elapsed_ms: elapsed, triggers };
  } finally {
    running = false;
  }
}

async function evaluatePosition(pos) {
  // Valve A: settled + Polymarket CTF redeemable (零风险, real-money safe)
  // Detect via historical_resolutions corpus presence (resolved markets pulled from Polymarket).
  if (pos.condition_id) {
    const resolved = sqlite.prepare(
      `SELECT final_yes, final_no FROM historical_resolutions WHERE condition_id = ?`
    ).get(pos.condition_id);
    if (resolved) {
      // condition resolved — for sim positions, mark closed with realized pnl based on direction outcome
      const outcomeWasYes = Number(resolved.final_yes) === 1;
      const won = (pos.direction === 'YES' && outcomeWasYes) || (pos.direction === 'NO' && !outcomeWasYes);
      const realized = won
        ? (pos.shares * (1 - pos.entry_buy_price))   // each share pays $1 if win, cost was entry_buy_price
        : -(pos.shares * pos.entry_buy_price);
      closePosition(pos, 'auto_valve_a', realized, `settled (${won ? 'WIN' : 'LOSE'}, outcome=${outcomeWasYes ? 'YES' : 'NO'})`);
      await notify('A', pos, realized, `settled (${won ? 'WIN' : 'LOSE'}, outcome=${outcomeWasYes ? 'YES' : 'NO'})`);
      return { valve: 'A' };
    }
  }

  // Valve B: sim 仓位 outcome via bettor_outcome_log (Module 3 resolver populated)
  if (pos.recommendation_id) {
    const ol = sqlite.prepare(
      `SELECT actual_outcome, was_correct, actual_pnl_usd FROM bettor_outcome_log WHERE recommendation_id = ?`
    ).get(pos.recommendation_id);
    if (ol) {
      const realized = ol.actual_pnl_usd ?? 0;
      closePosition(pos, 'auto_valve_b', realized, `outcome_log resolved (correct=${ol.was_correct === 1})`);
      await notify('B', pos, realized, `outcome_log resolved actual=${ol.actual_outcome}`);
      return { valve: 'B' };
    }
  }

  // Valve C: unrealized pnl < -30% AND opened > 12h ago (损失锁定截 catastrophic)
  const ageHours = (Date.now() - new Date(pos.opened_at).getTime()) / 3600000;
  if (ageHours > VALVE_C_COOLDOWN_HOURS && pos.current_yes_price != null) {
    const currentValue = pos.direction === 'YES'
      ? pos.shares * pos.current_yes_price
      : pos.shares * (1 - pos.current_yes_price);
    const cost = pos.size_usd;
    const unrealizedPnlPct = cost > 0 ? (currentValue - cost) / cost : 0;
    if (unrealizedPnlPct < VALVE_C_PNL_THRESHOLD) {
      const realized = currentValue - cost;
      closePosition(pos, 'auto_valve_c', realized, `-30%+ pnl after ${ageHours.toFixed(1)}h (unrealized ${(unrealizedPnlPct * 100).toFixed(1)}%)`);
      await notify('C', pos, realized, `-30%+ pnl ${(unrealizedPnlPct * 100).toFixed(1)}% age=${ageHours.toFixed(1)}h`);
      return { valve: 'C' };
    }
  }

  // Valve D: opened > 90d AND 30d 内 abs price drift < 20pp (zombie 释放资金)
  const ageDays = ageHours / 24;
  if (ageDays > VALVE_D_AGE_DAYS) {
    // 30 天内 price drift: compare current vs price 30 天前 (from market_price_history if available)
    const driftRow = sqlite.prepare(`
      SELECT yes_price FROM bettor_market_price_history
      WHERE condition_id = ? AND snapshot_at <= datetime('now', '-30 days')
      ORDER BY snapshot_at DESC LIMIT 1
    `).get(pos.condition_id);
    if (driftRow && pos.current_yes_price != null) {
      const drift = Math.abs(pos.current_yes_price - driftRow.yes_price);
      if (drift < VALVE_D_DRIFT_THRESHOLD_PP) {
        const currentValue = pos.direction === 'YES'
          ? pos.shares * pos.current_yes_price
          : pos.shares * (1 - pos.current_yes_price);
        const realized = currentValue - pos.size_usd;
        closePosition(pos, 'auto_valve_d', realized, `zombie 90d+ age + 30d drift ${(drift * 100).toFixed(1)}pp < 20pp`);
        await notify('D', pos, realized, `zombie 90d+ drift ${(drift * 100).toFixed(1)}pp`);
        return { valve: 'D' };
      }
    }
  }

  return null;
}

function closePosition(pos, closedBy, realizedPnl, reasonText) {
  sqlite.prepare(`
    UPDATE bettor_sim_positions
    SET closed_at = datetime('now'), closed_by = ?, close_reason = ?, realized_pnl = ?
    WHERE id = ?
  `).run(closedBy, reasonText, realizedPnl, pos.id);
}

async function notify(valve, pos, realizedPnl, reason) {
  const payload = {
    valve,
    position_id: pos.id,
    recommendation_id: pos.recommendation_id,
    condition_id: pos.condition_id,
    question: pos.question,
    direction: pos.direction,
    size_usd: pos.size_usd,
    realized_pnl: realizedPnl,
    reason,
    triggered_at: new Date().toISOString(),
  };
  try {
    sqlite.prepare(`
      INSERT INTO chain_events (id, event_type, payload, observed_at)
      VALUES (?, 'bettor_auto_valve_trigger', ?, datetime('now'))
    `).run(randomUUID(), JSON.stringify(payload));
  } catch (e) {
    console.error('[auto-valve] chain_events insert fail:', e.message);
  }
  // Console log for ops visibility (dev-alert channel broadcast left to Bettor host or future integration)
  const sign = realizedPnl >= 0 ? '+' : '';
  console.log(`[auto-valve] 🤖 valve-${valve} trigger pos=${pos.id?.slice(0, 8)} ${pos.direction} $${pos.size_usd?.toFixed(2)} → pnl ${sign}$${realizedPnl?.toFixed(2)} (${reason})`);
}

export const __testing = { evaluatePosition, closePosition, notify, VALVE_C_PNL_THRESHOLD, VALVE_C_COOLDOWN_HOURS, VALVE_D_AGE_DAYS, VALVE_D_DRIFT_THRESHOLD_PP };
