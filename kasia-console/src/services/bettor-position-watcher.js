// Position Watcher (Owner 5/17 钦定 mode 1+2 组合 + UI 可设置).
//
// Differs from bettor-position-protector.js:
//   - protector: auto-fire stop-loss SELL on pnl threshold (heavy automation)
//   - watcher:   alert-on-threshold, broadcast DM to Owner, NO auto-fire (R-DAEMON-DRY-RUN守)
//
// Cron 30 min tick. Reads position_watch_rules (active), fetches Polymarket book midpoint,
// matches thresholds_json (sorted by priority), broadcasts alert to dev-coord ONCE per
// label transition. Audit log every tick.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

const TICK_INTERVAL_MS = 30 * 60 * 1000;  // 30 min
const POLYMARKET_BOOK_URL = (tokenId) =>
  `https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`;

let timer = null;
let running = false;

export function startPositionWatcherCron() {
  if (timer) return;
  console.log('[position-watcher] started (30 min cron, alert-only — no auto-fire)');
  // Startup catchup: last audit > 30 min ago → fire immediate
  try {
    const last = sqlite.prepare('SELECT MAX(check_at) AS t FROM position_watch_audit').get();
    const lastMs = last?.t ? new Date(last.t).getTime() : 0;
    const ageMin = (Date.now() - lastMs) / 60000;
    if (ageMin > 30) {
      console.log(`[position-watcher] startup catchup: last audit ${ageMin.toFixed(1)}min ago > 30min, fire immediate`);
      setTimeout(() => tick().catch(e => console.error('[position-watcher] catchup err:', e.message)), 15_000);
    } else {
      console.log(`[position-watcher] startup: last audit ${ageMin.toFixed(1)}min ago, no catchup`);
    }
  } catch (e) {
    console.error('[position-watcher] startup query err:', e.message);
  }
  timer = setInterval(() => {
    tick().catch(e => console.error('[position-watcher] tick fail:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopPositionWatcherCron() {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function tick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const rules = sqlite.prepare("SELECT * FROM position_watch_rules WHERE status='active'").all();
    if (rules.length === 0) return { ok: true, audited: 0 };
    let alerted = 0;
    let audited = 0;
    for (const rule of rules) {
      try {
        const result = await checkRule(rule);
        audited += 1;
        if (result.alerted) alerted += 1;
      } catch (e) {
        console.error(`[position-watcher] rule ${rule.id.slice(0,8)} fail:`, e.message);
      }
    }
    if (audited > 0 || alerted > 0) {
      console.log(`[position-watcher] tick: ${audited} audited, ${alerted} new alerts fired`);
    }
    return { ok: true, audited, alerted };
  } finally {
    running = false;
  }
}

async function checkRule(rule) {
  const price = await fetchMidPrice(rule.token_id);
  if (price == null || isNaN(price)) {
    insertAudit(rule.id, null, null, null, false, 'price fetch fail');
    return { skipped: true };
  }
  const thresholds = parseThresholds(rule.thresholds_json);
  const triggered = matchThreshold(thresholds, price);

  // Update last_check_at / last_check_price always
  sqlite.prepare(`UPDATE position_watch_rules SET last_check_at = CURRENT_TIMESTAMP, last_check_price = ? WHERE id = ?`).run(price, rule.id);

  if (!triggered) {
    insertAudit(rule.id, price, null, null, false, null);
    return { ok: true, alerted: false };
  }

  // Alert ONLY on label transition (no dup spam if price stays in same band)
  if (rule.last_alert_label === triggered.label) {
    insertAudit(rule.id, price, triggered.label, triggered.action, false, 'dup label, skip alert');
    return { ok: true, alerted: false };
  }

  // Broadcast alert
  const alertMsg = buildAlertMessage(rule, price, triggered);
  const broadcastOk = await broadcastAlert(rule.relay_node_id, alertMsg);
  sqlite.prepare(`UPDATE position_watch_rules SET last_alert_label = ?, last_alert_at = CURRENT_TIMESTAMP WHERE id = ?`).run(triggered.label, rule.id);
  insertAudit(rule.id, price, triggered.label, triggered.action, broadcastOk ? 1 : 0, broadcastOk ? null : 'broadcast fail');
  return { ok: true, alerted: broadcastOk };
}

async function fetchMidPrice(tokenId) {
  const res = await fetch(POLYMARKET_BOOK_URL(tokenId), { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`book HTTP ${res.status}`);
  const book = await res.json();
  const asks = book.asks || [];
  const bids = book.bids || [];
  if (asks.length === 0 || bids.length === 0) return null;
  const bestAsk = parseFloat(asks[asks.length - 1].price);
  const bestBid = parseFloat(bids[bids.length - 1].price);
  return (bestAsk + bestBid) / 2;
}

function parseThresholds(json) {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// Sort thresholds so the most extreme matches first.
// op='gte' → higher price = stronger, sort desc
// op='lte' → lower price = stronger, sort asc
// We check ALL and pick the first that matches in sorted (most-extreme) order per direction.
function matchThreshold(thresholds, price) {
  const gtes = thresholds.filter(t => t.op === 'gte').sort((a, b) => b.price - a.price);
  const ltes = thresholds.filter(t => t.op === 'lte').sort((a, b) => a.price - b.price);
  for (const t of gtes) if (price >= t.price) return t;
  for (const t of ltes) if (price <= t.price) return t;
  return null;
}

function buildAlertMessage(rule, price, triggered) {
  const pnlPerSh = price - rule.entry_avg_price;
  const totalPnl = pnlPerSh * rule.current_size;
  const pnlPct = (pnlPerSh / rule.entry_avg_price) * 100;
  const sellShares = triggered.sell_pct ? Math.floor(rule.current_size * triggered.sell_pct / 100) : 0;
  const sellValue = sellShares * price;

  return `🚨 WATCHER ALERT [${triggered.label}]

market: ${rule.market_title}
outcome: ${rule.outcome}
position: ${rule.current_size} sh @ entry $${rule.entry_avg_price.toFixed(3)}
current: $${price.toFixed(3)} (${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% / ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)})

action proposed: ${triggered.action || '(see thresholds)'}${sellShares > 0 ? `
  → sell ${sellShares} sh @ ~$${price.toFixed(3)} = $${sellValue.toFixed(2)}` : ''}

ACK to fire: explicit "fire ${rule.id.slice(0, 8)}" or use /predictions UI.
rule_id: ${rule.id}`;
}

async function broadcastAlert(relayNodeId, message) {
  try {
    const PORT = process.env.PORT || 3100;
    const res = await fetch(`http://127.0.0.1:${PORT}/api/chat/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ relayId: relayNodeId, channel: 'dev-coord', message }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[position-watcher] broadcast HTTP ${res.status}`);
      return false;
    }
    const j = await res.json();
    return !!j.ok;
  } catch (e) {
    console.error('[position-watcher] broadcast err:', e.message);
    return false;
  }
}

function insertAudit(ruleId, price, triggeredLabel, actionProposed, alerted, notes) {
  try {
    sqlite.prepare(`INSERT INTO position_watch_audit (id, rule_id, price, triggered_label, action_proposed, alerted, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), ruleId, price, triggeredLabel, actionProposed, alerted, notes);
  } catch (e) {
    console.error('[position-watcher] audit insert err:', e.message);
  }
}
