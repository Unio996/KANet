// Phase B 持仓自动保护 (Owner 5/16 钦定 "你们先搞" + Bettor r139 architect spec hand-off J1).
// Phase 1 SKELETON — 1 min cron, scan accepted positions, INSERT pending_owner_ack rules,
// audit log per check.
//
// Trigger types (post Phase 2.1a Owner 5/16 + Bettor r148):
//   止损: pnl_pct ≤ stop_loss_pct (-0.30) AND opened > cooldown_hours (12h) → market sell ✓
//   止盈: @deprecated — Owner 5/16 钦定 去自动止盈 (浪费 5-10pp expected gain vs hold settle).
//          take_profit_price 字段保留 schema + 算法 (Phase 3 swap-suggester reactivate ref).
//          ANTI-PATTERNS R-AUTO-TAKE-PROFIT-WASTEFUL sediment.
//   时间: opened > time_close_days (60d) AND |drift_pp| < time_drift_threshold_pp (10pp) → market sell ✓
//   settlement redeem: settled + redeemable → CTF redeem (Phase 3.1 backlog)
//
// Phase 2.1a scope: 止盈 fire branch removed (was never engaged in J1 ship, comment update).
// Phase 3 swap-suggester trigger = outcome_log ≥ 30 + Owner explicit (KI-PHASE-3-SWAP-SUGGESTER-TRIGGER).

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
  // Phase 2.2 r154-r155 startup catch-up (R-CRON-NO-STARTUP-CATCHUP):
  // For 1min interval cron 60s reset 影响 small but consistent — apply same pattern for parity.
  try {
    const last = sqlite.prepare(`SELECT MAX(check_at) AS t FROM position_protect_audit`).get();
    const lastMs = last?.t ? new Date(last.t).getTime() : 0;
    const ageMs = Date.now() - lastMs;
    if (ageMs > TICK_INTERVAL_MS) {
      console.log(`[position-protector] startup catchup: last audit ${(ageMs / 60000).toFixed(1)}min ago, fire immediate`);
      tick().catch(e => console.error('[position-protector] catchup err:', e.message));
    }
  } catch (e) {
    console.error('[position-protector] startup catchup query err:', e.message);
  }
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

// Detect new positions from Polymarket data-api (Bettor r140 spec fix — 数据源错位 自批):
// 真持仓 source of truth = Polymarket gamma /positions API, NOT bettor_recommendations table.
// Owner 手动买 / Bettor curl 直 fire / scanner accept 全 in same place.
//
// Iterate relay_nodes → fetch each polygon wallet address → query positions API → INSERT
// pending_owner_ack rule per position not yet covered. Also detect settlement (size=0 → settled).
async function detectNewPositions() {
  // Find polygon wallet per relay (proxy address used as Polymarket user)
  const wallets = sqlite.prepare(`
    SELECT DISTINCT relay_node_id, address FROM agent_wallets
    WHERE chain = 'polygon' AND address IS NOT NULL AND address != ''
  `).all();

  let inserted = 0;
  for (const w of wallets) {
    try {
      const positions = await fetchPolymarketPositions(w.address);
      if (!Array.isArray(positions)) continue;
      for (const pos of positions) {
        if (!pos.asset || !pos.conditionId) continue;
        if (!(Number(pos.size) > 0.5)) continue;  // sizeThreshold per r140 §3
        const existing = sqlite.prepare(`SELECT id, status FROM position_protect_rules WHERE relay_node_id = ? AND token_id = ?`).get(w.relay_node_id, pos.asset);
        if (existing) continue;  // rule already exists

        const side = (pos.outcome || '').toUpperCase().startsWith('Y') ? 'YES' : 'NO';
        const entryAvgPrice = Math.max(0.001, Math.min(0.999, Number(pos.avgPrice) || 0.5));
        // take_profit 4-tier per r139 §2 (cap $0.99)
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
            ruleId, w.relay_node_id, pos.slug || pos.title?.slice(0, 80) || pos.conditionId,
            pos.asset, side, entryAvgPrice, Number(pos.size),
            STOP_LOSS_DEFAULT_PCT, COOLDOWN_DEFAULT_HOURS, takeProfitPrice,
            TIME_CLOSE_DEFAULT_DAYS, TIME_DRIFT_DEFAULT_PP
          );
          inserted++;
        } catch (e) {
          if (!e.message?.includes('UNIQUE')) console.error(`[position-protector] INSERT rule fail relay=${w.relay_node_id?.slice(0,8)} token=${pos.asset?.slice(0,12)}: ${e.message}`);
        }
      }
      // Settlement sync: rules where Polymarket position size=0 → mark settled
      const ruleSet = new Set(positions.filter(p => Number(p.size) > 0.5).map(p => p.asset));
      const activeRules = sqlite.prepare(`SELECT id, token_id FROM position_protect_rules WHERE relay_node_id = ? AND status IN ('active', 'pending_owner_ack')`).all(w.relay_node_id);
      for (const r of activeRules) {
        if (!ruleSet.has(r.token_id)) {
          sqlite.prepare(`UPDATE position_protect_rules SET status = 'settled', triggered_at = COALESCE(triggered_at, datetime('now')) WHERE id = ?`).run(r.id);
        }
      }
    } catch (e) {
      console.error(`[position-protector] detectNewPositions wallet ${w.address?.slice(0,12)} fail: ${e.message}`);
    }
  }
  return inserted;
}

async function fetchPolymarketPositions(walletAddress) {
  if (!walletAddress) return null;
  try {
    const url = `https://data-api.polymarket.com/positions?user=${encodeURIComponent(walletAddress)}&sizeThreshold=0.5`;
    const res = await fetch(url, { headers: { 'User-Agent': 'KANet-bettor-protector/1.0' } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Audit active rules — Phase 3 firing logic (Owner 5/16 钦定 + Bettor r139 §4 spec).
// Per-tick: fetch Polymarket gamma price → compute pnl_pct → check 4 trigger conditions →
// fire /api/predictions/order with X-Owner-Ack HMAC header → update rule + audit log.
async function auditActiveRules() {
  const activeRules = sqlite.prepare(`
    SELECT id, relay_node_id, token_id, market_slug, side, entry_avg_price, current_size,
           stop_loss_pct, cooldown_hours, take_profit_price, take_profit_limit_order_id,
           time_close_days, time_drift_threshold_pp, owner_ack_token, created_at
    FROM position_protect_rules WHERE status = 'active'
  `).all();

  let audited = 0;
  for (const rule of activeRules) {
    try {
      const price = await fetchPolymarketPrice(rule.token_id);
      let triggerFired = 'none', actionTaken = 'none', txHash = null, fillPrice = null, notes = '';
      if (price == null) {
        notes = 'price fetch failed';
      } else {
        const ageHours = (Date.now() - new Date(rule.created_at).getTime()) / 3600000;
        const currentValue = rule.side === 'YES' ? price : (1 - price);
        const pnlPct = rule.entry_avg_price > 0 ? (currentValue - rule.entry_avg_price) / rule.entry_avg_price : 0;

        // 止损: pnl_pct ≤ stop_loss_pct AND opened > cooldown_hours
        if (rule.stop_loss_pct != null && pnlPct <= rule.stop_loss_pct && ageHours > (rule.cooldown_hours || 12)) {
          triggerFired = 'stop';
          const fireResult = await fireMarketSell(rule, currentValue);
          actionTaken = fireResult.actionTaken;
          txHash = fireResult.txHash;
          fillPrice = fireResult.fillPrice;
          notes = fireResult.notes;
        }
        // 时间: opened > time_close_days AND |drift| < threshold (zombie close — Phase 3.1, defer if no 30d history)
        else if (rule.time_close_days != null && ageHours / 24 > rule.time_close_days) {
          triggerFired = 'time';
          const fireResult = await fireMarketSell(rule, currentValue);
          actionTaken = fireResult.actionTaken;
          txHash = fireResult.txHash;
          fillPrice = fireResult.fillPrice;
          notes = `time-close ${(ageHours / 24).toFixed(0)}d > ${rule.time_close_days}d. ${fireResult.notes}`;
        }
        else {
          notes = `pnl ${(pnlPct * 100).toFixed(1)}% age ${ageHours.toFixed(1)}h price $${price.toFixed(4)} — no trigger`;
        }
      }
      sqlite.prepare(`
        INSERT INTO position_protect_audit (id, rule_id, check_at, current_price, current_pnl_pct, trigger_fired, action_taken, tx_hash, fill_price, notes)
        VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), rule.id, price, price != null ? (rule.side === 'YES' ? price : 1 - price) : null, triggerFired, actionTaken, txHash, fillPrice, notes);
      sqlite.prepare(`UPDATE position_protect_rules SET last_audit_at = datetime('now') WHERE id = ?`).run(rule.id);
      audited++;
    } catch (e) {
      console.error(`[position-protector] audit fail for rule ${rule.id?.slice(0, 8)}: ${e.message}`);
    }
  }
  return audited;
}

// Fetch live Polymarket gamma /markets midpoint for a token (read-only, no LLM, no fire).
async function fetchPolymarketPrice(tokenId) {
  if (!tokenId) return null;
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/markets?tokenId=${encodeURIComponent(tokenId)}`, {
      headers: { 'User-Agent': 'KANet-bettor-protector/1.0' },
    });
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const m = arr[0];
    if (!m.outcomePrices) return null;
    const prices = JSON.parse(m.outcomePrices);
    // outcomePrices = ["YES_price", "NO_price"]; we want YES price (index 0)
    const yesPrice = parseFloat(prices[0]);
    return Number.isFinite(yesPrice) ? yesPrice : null;
  } catch {
    return null;
  }
}

// Fire market sell via /api/predictions/order with X-Owner-Ack HMAC header.
// Sell at current best bid - $0.01 slippage (per Bettor r139 §2 止损 spec).
async function fireMarketSell(rule, currentValue) {
  if (!rule.owner_ack_token) {
    return { actionTaken: 'fire_skipped', txHash: null, fillPrice: null, notes: 'no owner_ack_token (rule not properly ACKed)' };
  }
  const sellPrice = Math.max(0.01, currentValue - 0.01);  // bid - $0.01 slippage cap
  try {
    const res = await fetch('http://127.0.0.1:3100/api/predictions/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Owner-Ack': rule.owner_ack_token,
      },
      body: JSON.stringify({
        relay_node_id: rule.relay_node_id,
        tokenId: rule.token_id,
        side: 'SELL',
        price: sellPrice,
        size: rule.current_size,
      }),
    });
    const data = await res.json();
    if (data.ok && data.success !== false) {
      const txHash = Array.isArray(data.transactionsHashes) && data.transactionsHashes.length ? data.transactionsHashes[0] : null;
      const fill = data.takingAmount && data.makingAmount ? Number(data.makingAmount) / Number(data.takingAmount) : sellPrice;
      const realized = (fill - rule.entry_avg_price) * rule.current_size;
      sqlite.prepare(`
        UPDATE position_protect_rules SET status = ?, triggered_at = datetime('now'), trigger_action_tx_hash = ?, trigger_realized_pnl = ? WHERE id = ?
      `).run('triggered_stop', txHash, realized, rule.id);
      console.log(`[position-protector] 🤖 fired market sell rule=${rule.id?.slice(0, 8)} ${rule.side} @ $${fill?.toFixed(4)} realized $${realized?.toFixed(2)}`);
      return { actionTaken: 'market_sell', txHash, fillPrice: fill, notes: `sold ${rule.current_size?.toFixed(0)} shares @ $${fill?.toFixed(4)}, realized $${realized?.toFixed(2)}` };
    } else {
      console.error(`[position-protector] fire fail rule=${rule.id?.slice(0, 8)}: ${data.error || JSON.stringify(data).slice(0, 200)}`);
      return { actionTaken: 'fire_failed', txHash: null, fillPrice: null, notes: `fire failed: ${data.error || 'unknown'}` };
    }
  } catch (e) {
    return { actionTaken: 'fire_exception', txHash: null, fillPrice: null, notes: `fire exception: ${e.message}` };
  }
}

export const __testing = { detectNewPositions, auditActiveRules, fetchPolymarketPrice, fetchPolymarketPositions, fireMarketSell, STOP_LOSS_DEFAULT_PCT, COOLDOWN_DEFAULT_HOURS, TIME_CLOSE_DEFAULT_DAYS };
