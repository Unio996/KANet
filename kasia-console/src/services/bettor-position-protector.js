// Phase B 持仓自动保护 (Owner 5/16 钦定 "你们先搞" + Bettor r139 architect spec hand-off J1).
// Phase 1 SKELETON — 1 min cron, scan accepted positions, INSERT pending_owner_ack rules,
// audit log per check. NO firing logic in Phase 1 (Phase 3 will engage /api/predictions/order
// with HMAC owner_ack_token verify).
//
// Trigger types per Bettor r139 §2 (Owner default):
//   止损: pnl_pct ≤ stop_loss_pct (-0.30) AND opened > cooldown_hours (12h)
//   止盈: 分级 entry_avg_price 区间 → take_profit_price 触发 (limit sell 挂)
//   时间: opened > time_close_days (60d) AND |drift_pp| < time_drift_threshold_pp (10pp) 30d
//   settlement redeem: settled + redeemable
//   settlement stuck alert: settled + verdict=PENDING + end_date < now-7d (dev-alert only)
//
// Phase 1 scope (本): only DETECT + INSERT pending_owner_ack rule + audit log.
// NO fire any /api/predictions/order — Phase 3 engages firing.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

const TICK_INTERVAL_MS = 60 * 1000;  // 1 min cron (per r139 §4)
const STOP_LOSS_DEFAULT_PCT = -0.30;
const COOLDOWN_DEFAULT_HOURS = 12;
const TIME_CLOSE_DEFAULT_DAYS = 60;
const TIME_DRIFT_DEFAULT_PP = 0.10;

let timer = null;
let running = false;

export function startPositionProtectorCron() {
  if (timer) return;
  console.log('[position-protector] started (1 min cron, Phase 1 skeleton — detect new positions + INSERT pending_owner_ack rules, NO firing)');
  setTimeout(() => tick().catch(e => console.error('[position-protector] initial tick fail:', e.message)), 30_000);
  timer = setInterval(() => {
    tick().catch(e => console.error('[position-protector] tick fail:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopPositionProtectorCron() {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function tick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const inserted = await detectNewPositions();
    const audited = await auditActiveRules();
    if (inserted > 0 || audited > 0) {
      console.log(`[position-protector] tick: +${inserted} new pending rules / ${audited} active audited`);
    }
    return { ok: true, inserted, audited };
  } finally {
    running = false;
  }
}

// Detect new accepted positions (bettor_recommendations status='accepted', outcome=NULL)
// without an existing rule. INSERT rule status='pending_owner_ack' with default thresholds.
async function detectNewPositions() {
  const accepted = sqlite.prepare(`
    SELECT r.id AS rec_id, r.relay_node_id, r.condition_id, r.slug, r.market_id,
           r.question, r.decision, r.size_usd, r.yes_price AS entry_yes_price,
           r.scanned_at AS opened_at
    FROM bettor_recommendations r
    LEFT JOIN position_protect_rules p ON p.relay_node_id = r.relay_node_id AND p.token_id = r.condition_id
    WHERE r.status = 'accepted' AND r.outcome IS NULL AND p.id IS NULL
      AND r.condition_id IS NOT NULL
  `).all();

  let inserted = 0;
  for (const rec of accepted) {
    if (!rec.relay_node_id || !rec.condition_id) continue;
    // entry_avg_price = direction-adjusted cost basis
    // BUY YES at yes_price → cost = yes_price per share
    // BUY NO at (1 - yes_price) → cost = (1 - yes_price) per share
    const entryAvgPrice = rec.decision === 'NO'
      ? Math.max(0.001, 1 - (rec.entry_yes_price || 0.5))
      : Math.max(0.001, rec.entry_yes_price || 0.5);
    // take_profit分级 (per r139 §2):
    //   ≥ 0.90: entry + 0.04 (cap 0.99)
    //   0.75-0.90: entry + 0.07
    //   0.50-0.75: entry + 0.12
    //   < 0.50: entry × 1.50 (cap 0.99)
    let takeProfitPrice;
    if (entryAvgPrice >= 0.90) takeProfitPrice = Math.min(0.99, entryAvgPrice + 0.04);
    else if (entryAvgPrice >= 0.75) takeProfitPrice = Math.min(0.99, entryAvgPrice + 0.07);
    else if (entryAvgPrice >= 0.50) takeProfitPrice = Math.min(0.99, entryAvgPrice + 0.12);
    else takeProfitPrice = Math.min(0.99, entryAvgPrice * 1.50);

    const ruleId = randomUUID();
    try {
      sqlite.prepare(`
        INSERT INTO position_protect_rules
          (id, relay_node_id, market_slug, token_id, side, entry_avg_price, current_size,
           stop_loss_pct, cooldown_hours, take_profit_price, time_close_days, time_drift_threshold_pp,
           status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_owner_ack', datetime('now'))
      `).run(
        ruleId, rec.relay_node_id, rec.slug || rec.market_id, rec.condition_id,
        rec.decision === 'NO' ? 'NO' : 'YES',
        entryAvgPrice,
        rec.size_usd / entryAvgPrice,  // shares
        STOP_LOSS_DEFAULT_PCT,
        COOLDOWN_DEFAULT_HOURS,
        takeProfitPrice,
        TIME_CLOSE_DEFAULT_DAYS,
        TIME_DRIFT_DEFAULT_PP
      );
      inserted++;
    } catch (e) {
      // UNIQUE constraint OR other — log + continue
      if (!e.message?.includes('UNIQUE')) console.error(`[position-protector] INSERT rule fail rec=${rec.rec_id?.slice(0,8)}: ${e.message}`);
    }
  }
  return inserted;
}

// Audit active rules — read current price + log audit row (NO firing in Phase 1)
async function auditActiveRules() {
  const activeRules = sqlite.prepare(`
    SELECT id, relay_node_id, token_id, side, entry_avg_price, current_size,
           stop_loss_pct, cooldown_hours, take_profit_price, time_close_days,
           created_at
    FROM position_protect_rules WHERE status = 'active'
  `).all();

  let audited = 0;
  for (const rule of activeRules) {
    // Phase 1: just log audit. Phase 3 will fetch Polymarket price + check triggers.
    sqlite.prepare(`
      INSERT INTO position_protect_audit (id, rule_id, check_at, trigger_fired, action_taken, notes)
      VALUES (?, ?, datetime('now'), 'none', 'none', ?)
    `).run(randomUUID(), rule.id, 'Phase 1 skeleton — no price fetch yet');
    sqlite.prepare(`UPDATE position_protect_rules SET last_audit_at = datetime('now') WHERE id = ?`).run(rule.id);
    audited++;
  }
  return audited;
}

export const __testing = { detectNewPositions, auditActiveRules, STOP_LOSS_DEFAULT_PCT, COOLDOWN_DEFAULT_HOURS, TIME_CLOSE_DEFAULT_DAYS };
