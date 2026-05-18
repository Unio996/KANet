// Fossa-stable scanner (Owner 5/17 钦定 + Bettor r173 + r178 ack — R-COMPETITOR-BLIND-SPOT 治本).
//
// Specialized scanner with strict due-diligence enforcement. Per Owner pattern: prefer
// stable 5-15% upside + short settle (≤15d) + liquid markets. Per LLM 二审: result
// pinned status='pending_due_diligence' until Owner explicit ACK fire (autoTaker 永不动).
//
// Cron 1h tick. NO auto-fire. Owner final ack gate enforced at /api/bettor/recommendation/:id/accept.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';
import { classifyStrategy } from './bettor-scavenger.js';

const TICK_INTERVAL_MS = 60 * 60 * 1000;  // 1h
const PER_RUN_CAP = 5;
const POLYMARKET_URL = 'https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=200&order=volume24hr&ascending=false';

// Fossa-stable strict criteria (per Owner pattern):
const MIN_VOL24_USD = 50_000;
const MIN_LIQUIDITY_USD = 50_000;
const MIN_UPSIDE_PCT = 5;
const MAX_UPSIDE_PCT = 15;
const MAX_SETTLE_DAYS = 15;
const MIN_SETTLE_DAYS = 0.5;  // ≥ 12h, 防 settle-now noise

let timer = null;
let running = false;

export function startFossaStableScannerCron() {
  if (timer) return;
  console.log('[fossa-stable-scanner] started (1h cron, due-diligence enforced, no auto-fire)');
  try {
    const last = sqlite.prepare(`SELECT MAX(scanned_at) AS t FROM bettor_recommendations WHERE strategy = 'fossa-stable'`).get();
    const lastMs = last?.t ? new Date(last.t).getTime() : 0;
    const ageMin = (Date.now() - lastMs) / 60000;
    if (ageMin > 60) {
      console.log(`[fossa-stable-scanner] startup catchup: last scan ${ageMin.toFixed(0)}min ago > 60min, fire in 30s`);
      setTimeout(() => runFossaStableScan().catch(e => console.error('[fossa-stable-scanner] catchup err:', e.message)), 30_000);
    }
  } catch (e) {
    console.error('[fossa-stable-scanner] startup query err:', e.message);
  }
  timer = setInterval(() => {
    runFossaStableScan().catch(e => console.error('[fossa-stable-scanner] tick fail:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopFossaStableScannerCron() {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function runFossaStableScan() {
  if (running) return { skipped: true };
  running = true;
  try {
    const res = await fetch(POLYMARKET_URL, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Polymarket HTTP ${res.status}`);
    const markets = await res.json();
    const nowMs = Date.now();
    const candidates = [];
    for (const m of markets) {
      const cand = scoreFossaStable(m, nowMs);
      if (cand) candidates.push(cand);
      if (candidates.length >= PER_RUN_CAP) break;
    }
    let inserted = 0;
    for (const c of candidates) {
      try {
        const id = randomUUID();
        const exists = sqlite.prepare(`SELECT 1 FROM bettor_recommendations WHERE condition_id = ? AND strategy = 'fossa-stable' AND status IN ('pending', 'pending_due_diligence')`).get(c.condition_id);
        if (exists) continue;
        // fossa-stable conservative defaults — strategy = market-price (no LLM probability yet), Kelly low fraction
        const pMid = c.decision === 'YES' ? c.yes_price : (1 - c.yes_price);
        const sigma = 0.1;  // moderate uncertainty default (LLM 二审 Phase 2 will refine)
        const fraction = 0.02;  // 2% Kelly (conservative for unaudited pre-due-diligence)
        const score = c.upside_pct / 10;  // upside % normalized
        sqlite.prepare(`INSERT INTO bettor_recommendations (id, scanned_at, market_id, condition_id, slug, question, end_date, yes_price, decision, size_usd, edge, p_mid, sigma, fraction, score, trigger_type, strategy, status, pass_due_diligence) VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'cron', 'fossa-stable', 'pending_due_diligence', 0)`)
          .run(id, c.market_id, c.condition_id, c.slug, c.question, c.end_date, c.yes_price, c.decision, c.size_usd, c.upside_pct, pMid, sigma, fraction, score);
        inserted += 1;
      } catch (e) {
        console.error('[fossa-stable-scanner] insert err:', e.message);
      }
    }
    if (inserted > 0) console.log(`[fossa-stable-scanner] inserted ${inserted} pending_due_diligence recs (waiting Owner final ack)`);
    return { ok: true, scanned: markets.length, inserted };
  } finally {
    running = false;
  }
}

function scoreFossaStable(m, nowMs) {
  if (!m.outcomePrices || !m.endDate) return null;
  let yes;
  try { yes = parseFloat(JSON.parse(m.outcomePrices)[0]); } catch { return null; }
  if (!Number.isFinite(yes)) return null;
  const endMs = new Date(m.endDate).getTime();
  if (!Number.isFinite(endMs)) return null;
  const daysToSettle = (endMs - nowMs) / 86400000;
  if (daysToSettle < MIN_SETTLE_DAYS || daysToSettle > MAX_SETTLE_DAYS) return null;
  const vol24 = m.volume24hr || 0;
  const liq = m.liquidity || 0;
  if (vol24 < MIN_VOL24_USD || liq < MIN_LIQUIDITY_USD) return null;
  // upside check: pick the heavier side (favorite), upside = 1 - favorite_price
  const noPrice = 1 - yes;
  const favorite = yes >= 0.5 ? 'YES' : 'NO';
  const favPrice = yes >= 0.5 ? yes : noPrice;
  const upsidePct = (1 - favPrice) / favPrice * 100;
  if (upsidePct < MIN_UPSIDE_PCT || upsidePct > MAX_UPSIDE_PCT) return null;
  return {
    market_id: String(m.id),
    condition_id: m.conditionId,
    slug: m.slug,
    question: m.question,
    end_date: m.endDate,
    yes_price: yes,
    decision: favorite,
    size_usd: 100,  // fossa-stable conservative default, Owner can override at ACK
    upside_pct: upsidePct,
  };
}
