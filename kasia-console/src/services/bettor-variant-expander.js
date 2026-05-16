// Phase B Variant Expander 3-tier (Owner 5/16 钦定 "B" = 3档变种 display Owner手 pick + Bettor r141 spec).
// Per scanner rec → expander auto-find related markets → 3 档 (激进/适中/保守) variant rec INSERT.
//
// Phase 1 SKELETON: schema + service stub + CRUD endpoints. Real entity extraction + gamma search +
// depth-500 calc + algorithm pickBest deferred to Phase 2 (UI surface in /predictions).
//
// 3-tier algorithm (per r141 §4 Owner ack):
//   🔴 aggressive: max(payout_pct) WHERE hit_rate ≥ 0.25 AND depth_500 fillable
//   🟡 medium:     max(ev_per_dollar) WHERE depth_500 fillable
//   🟢 conservative: max(hit_rate) WHERE payout_pct ≥ 0.03 AND depth_500 fillable
// 每档 top 1 (避免 paralysis).

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

const TICK_INTERVAL_MS = 30 * 60 * 1000;  // 30 min cron (independent scan)
const HIT_RATE_AGGRESSIVE_MIN = 0.25;
const PAYOUT_CONSERVATIVE_MIN = 0.03;
const DEPTH_AGGRESSIVE_MIN = 200;
const DEPTH_OTHER_MIN = 500;
const AGGRESSIVE_EV_FLOOR = -0.05;  // Phase 1.5 r143 hotfix — prevent -10% EV "推荐" misleading Owner

let timer = null;
let running = false;

export function startVariantExpanderCron() {
  if (timer) return;
  console.log('[variant-expander] started (30 min cron, Phase 1 skeleton — 3-tier variant expansion stub, real algorithm Phase 2)');
  setTimeout(() => tick().catch(e => console.error('[variant-expander] initial tick fail:', e.message)), 90_000);
  timer = setInterval(() => {
    tick().catch(e => console.error('[variant-expander] tick fail:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopVariantExpanderCron() {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function tick() {
  if (running) return { skipped: true };
  running = true;
  try {
    // Find recs not yet expanded (no existing variants)
    const unexpanded = sqlite.prepare(`
      SELECT r.id, r.relay_node_id, r.condition_id, r.slug, r.question,
             r.decision, r.yes_price, r.size_usd, r.end_date
      FROM bettor_recommendations r
      LEFT JOIN bettor_variant_recommendations v ON v.parent_rec_id = r.id
      WHERE v.id IS NULL
        AND r.scanned_at > datetime('now', '-7 days')
        AND r.status IN ('pending', 'accepted')
      ORDER BY r.scanned_at DESC LIMIT 50
    `).all();
    let expanded = 0;
    for (const rec of unexpanded) {
      try {
        const variants = await expandVariantsForRec(rec);
        if (variants.length > 0) expanded++;
      } catch (e) {
        console.error(`[variant-expander] expand fail rec=${rec.id?.slice(0,8)}: ${e.message}`);
      }
    }
    if (expanded > 0) console.log(`[variant-expander] tick: ${expanded}/${unexpanded.length} recs expanded`);
    return { ok: true, expanded, total: unexpanded.length };
  } finally {
    running = false;
  }
}

export async function expandVariantsForRec(parentRec) {
  const entity = extractEntity(parentRec.question, parentRec.slug);
  if (!entity) return [];
  const candidates = await fetchRelatedMarkets(entity, parentRec.slug);
  if (!candidates || candidates.length === 0) return [];

  // Score each candidate side (YES + NO)
  const scored = [];
  for (const m of candidates) {
    try {
      const prices = m.outcomePrices ? JSON.parse(m.outcomePrices) : null;
      if (!Array.isArray(prices) || prices.length < 2) continue;
      const tokens = m.clobTokenIds ? JSON.parse(m.clobTokenIds) : null;
      if (!Array.isArray(tokens) || tokens.length < 2) continue;
      for (const sideIdx of [0, 1]) {
        const side = sideIdx === 0 ? 'YES' : 'NO';
        const price = parseFloat(prices[sideIdx]);
        if (!Number.isFinite(price) || price < 0.02 || price > 0.99) continue;
        const hit = price;
        const payout = price > 0 ? (1 - price) / price : 0;
        const ev = hit * payout - (1 - hit);
        scored.push({
          marketSlug: m.slug,
          conditionId: m.conditionId,
          tokenId: tokens[sideIdx],
          side, price, hit, payout, ev,
          depth: 500,  // Phase 1 stub — assume fillable; Phase 3 will fetch real /book depth
          liquidity: Number(m.liquidity) || 0,
        });
      }
    } catch { /* ignore parse errors */ }
  }
  if (scored.length === 0) return [];

  // 3-tier pickBest per r141 §4 + Phase 1.5 r143 hotfix:
  //   (f) aggressive tier add ev > -0.05 filter (prevent surfacing -10% EV bets as "推荐")
  //   ANTI-PATTERNS R-VARIANT-EV-FLOOR sediment
  const tiers = [
    { tier: 'aggressive', scoreFn: x => x.payout, filter: { hit: HIT_RATE_AGGRESSIVE_MIN, depth: DEPTH_AGGRESSIVE_MIN, ev: AGGRESSIVE_EV_FLOOR } },
    { tier: 'medium', scoreFn: x => x.ev, filter: { depth: DEPTH_OTHER_MIN } },
    { tier: 'conservative', scoreFn: x => x.hit, filter: { payout: PAYOUT_CONSERVATIVE_MIN, depth: DEPTH_OTHER_MIN } },
  ];

  const inserted = [];
  for (const { tier, scoreFn, filter } of tiers) {
    const pick = pickBest(scored, scoreFn, filter);
    if (!pick) continue;
    // Skip if pick is same as parent (no improvement)
    if (pick.conditionId === parentRec.condition_id && pick.side === (parentRec.decision === 'NO' ? 'NO' : 'YES')) continue;
    const variantId = randomUUID();
    try {
      sqlite.prepare(`
        INSERT INTO bettor_variant_recommendations
          (id, parent_rec_id, market_slug, condition_id, token_id, side, current_price,
           hit_rate, payout_pct, depth_500_avg_price, ev_per_dollar, risk_score,
           strategy_tier, variant_type, reasoning, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(
        variantId, parentRec.id, pick.marketSlug, pick.conditionId, pick.tokenId,
        pick.side, pick.price, pick.hit, pick.payout, pick.price, pick.ev, 1 - pick.hit,
        tier,
        pick.conditionId === parentRec.condition_id ? 'same_event_inverse' : 'related_entity',
        `${tier} pick: hit=${(pick.hit * 100).toFixed(0)}% payout=${(pick.payout * 100).toFixed(0)}% ev=${(pick.ev * 100).toFixed(1)}%`
      );
      inserted.push(tier);
    } catch (e) {
      console.error(`[variant-expander] INSERT ${tier} fail: ${e.message}`);
    }
  }
  return inserted;
}

// Phase 1 simple entity extraction — country/team/event keywords.
// Phase 1.5 r143 hotfix: regex 失败 fallback to fuzzy LIKE (whole question 提取 keyword) instead of hard null.
// Phase 3 may upgrade to LLM-extracted entity.
function extractEntity(question, slug) {
  if (!question) return null;
  const text = String(question).toLowerCase();
  // Try slug-based hint first (most reliable, no NLP)
  if (slug) {
    const slugMatch = String(slug).toLowerCase().match(/^will-([a-z-]+?)-(win|be-in|top|the|defeat|finish)/);
    if (slugMatch) return slugMatch[1].replace(/-/g, ' ');
  }
  // Common entity patterns: "Will <Entity> win/be in <Event>?"
  const m = text.match(/^will\s+([a-z][a-z\s]+?)\s+(win|be\s+in|top|defeat|finish|reach)/);
  if (m) return m[1].trim();
  // Phase 1.5 r143 fuzzy LIKE fallback — extract longest non-stopword token (skip "will/the/in/of...").
  // Returns null only if no usable token (variant-expander will skip rec gracefully).
  const stopwords = new Set(['will', 'the', 'and', 'or', 'in', 'on', 'of', 'to', 'for', 'with', 'this', 'that', 'be', 'by', 'a', 'an']);
  const tokens = text.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 3 && !stopwords.has(t));
  if (tokens.length > 0) {
    // Return longest token as fuzzy entity candidate (most likely proper noun)
    return tokens.sort((a, b) => b.length - a.length)[0];
  }
  return null;
}

// Phase 1.5 r143 hotfix — eventSlug expansion: parent rec slug 提取 event prefix, 然后 fetch
// 同 event 全 markets (但 filter same_entity only per r143 §4 — Greece top10 NOT a Romania top10 variant).
async function fetchRelatedMarkets(entity, parentSlug) {
  if (!entity) return [];
  try {
    // Phase 1.5 eventSlug expansion: e.g. "will-romania-be-in-the-top-10-at-eurovision-2026"
    // → event hint "eurovision-2026". Combine entity LIKE + eventSlug LIKE for broader coverage
    // BUT filter cross-entity at caller (r143 §4 cross_entity_same_event NOT variant).
    let eventHint = null;
    if (parentSlug) {
      const m = String(parentSlug).toLowerCase().match(/-at-([a-z0-9-]+)$/) || String(parentSlug).toLowerCase().match(/-(eurovision-\d+|epl-?\d+|nba-\d+|nfl-\d+|mlb-\d+|champions-league-\d+)\b/);
      if (m) eventHint = m[1];
    }
    const url = `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=100`;
    const res = await fetch(url, { headers: { 'User-Agent': 'KANet-bettor-variant/1.0' } });
    if (!res.ok) return [];
    const arr = await res.json();
    if (!Array.isArray(arr)) return [];
    const entityLower = entity.toLowerCase();
    return arr.filter(m => {
      const slug = (m.slug || '').toLowerCase();
      const question = (m.question || '').toLowerCase();
      const matchEntity = slug.includes(entityLower) || question.includes(entityLower);
      const matchEvent = eventHint ? (slug.includes(eventHint) || (m.eventSlug || '').toLowerCase().includes(eventHint)) : false;
      // r143 §4: variant 只 include same_entity. eventHint match alone (without entity match) = cross-entity
      // (independent rec, separate UI section). Return only entity-match here.
      return matchEntity || (matchEvent && matchEntity);
    });
  } catch {
    return [];
  }
}

function pickBest(scored, scoreFn, filter) {
  return scored
    .filter(x => Object.entries(filter).every(([k, v]) => (x[k] ?? 0) >= v))
    .sort((a, b) => scoreFn(b) - scoreFn(a))[0];
}

export const __testing = { expandVariantsForRec, extractEntity, fetchRelatedMarkets, pickBest, HIT_RATE_AGGRESSIVE_MIN, PAYOUT_CONSERVATIVE_MIN };
