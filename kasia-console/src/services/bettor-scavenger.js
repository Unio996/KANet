// Bettor Scavenger — Owner 5/14 14:50 钦定 pivot
//
// 找便宜稳单 (rules+trajectory+流动性), 弃数学凯莉/LLM 估 pMid.
// 跟 bettor-scanner.js (老 Phase 3a, LLM-pMid + Kelly) 并行存在; cron 启动后取代老 scanner.
//
// Algorithm:
//   1. Fetch active Polymarket markets (gamma /markets?closed=false)
//   2. Filter (trajectory + 流动性 + 价格区间):
//      - yes_price ∈ [0.5%, 20%] (BUY_NO 候选) or [80%, 99.5%] (BUY_YES 候选)
//      - vol_24h > $5K, liquidity > $20K (tiered by candidate position size)
//      - 1mo trajectory: yes ≤ 5% pass auto OR (1mo<-10pp AND 1wk≤0)
//      - deadline 1h-30d window
//   3. Cross-check 现持仓:
//      - 算 expected return (含 tail risk 折扣)
//      - flag candidates expected ≥ min_current_position_return + 3pp
//   4. Insert into bettor_recommendations (trigger_type='scavenger')
//
// Output: ranked candidates 表 → /predictions UI surface + (future) DM trigger.

import { randomUUID } from 'node:crypto';
import https from 'node:https';
import { sqlite } from '../db/client.js';
import { detectDomain } from './bettor-domain-detector.js';
import { enrichSports } from './bettor-sports-enricher.js';
import { reasonFundamental } from './bettor-fundamental-reasoner.js';

// Bettor r118 hotfix 5/14: gamma API hard-capped 100/page today (was 500 earlier).
// Scavenger PAGE_SIZE=500 fetched first page 100 < 500 → premature break → only 100 markets total.
// Fix: PAGE_SIZE=100 align gamma reality + MAX_PAGES=100 keeps 10K market upper bound.
const PAGE_SIZE = 100;
const MAX_PAGES = 100;       // 10K markets max
const DEFAULT_BANKROLL = 1000;
const MIN_EXPECTED_RETURN_SPREAD = 0.03;  // 3pp Owner-mandated replacement threshold
const DEADLINE_GRACE_DAYS = 7;             // 允许 deadline 比现持仓略远

// Phase B Sub B1.4 — Fundamental Enricher 集成 (Owner 5/14 14:50 pivot + Bettor r113 §1).
// 中段 (yes 0.20-0.80) markets 必 fundamental_gap ≥ 15pp 才进 list.
// 注意成本: detectDomain + enricher + reasoner 每 market 3 LLM calls. 用 hard cap 限 LLM 数;
// domain detector cache 1h TTL → 二次 scan 复用.
const FUND_GAP_THRESHOLD = 0.15;          // 中段必 ≥ 15pp gap (spec §B1.4)
const FUND_DOMAIN_MIN_CONFIDENCE = 0.7;   // domain 检测置信度门槛
const MIDDLE_LIQUIDITY_MIN = 50000;       // 中段流动性门槛 ($50K, 高于 tail 的 $20K)
const MIDDLE_VOLUME_MIN = 10000;          // 中段 24h vol 门槛 ($10K, 高于 tail 的 $5K)
const MAX_MIDDLE_ENRICH_PER_SCAN = 100;   // 每次 scan 最多 enrich 100 中段 markets (LLM cost cap)
// 思路 E (Owner 5/15 钦定碰撞质疑 + Bettor r126 PASS): tail enricher-first + trajectory fallback.
// Australia case 5/15 实战 surface — momentum-confirms-direction 假设跟 contrarian Owner pivot 哲学冲突.
// tail enricher 拿 fundamentals 直接对 yes 价 → 不依赖 momentum. Phase 2/3 ship 后 trajectory 自然 deprecate (→ 思路 D).
const TAIL_FUND_GAP_THRESHOLD = 0.05;     // tail 阈值低 (5pp, vs 中段 15pp — tail 价已 extreme, 小 gap 已大 alpha)
const TAIL_ENRICH_LIQUIDITY_MIN = 30000;  // tail enrich 流动性 (低于 middle $50K — tail markets typically thinner)
const TAIL_ENRICH_VOLUME_MIN = 10000;     // tail enrich vol $10K
const MAX_TAIL_ENRICH_PER_SCAN = 50;      // tail 50 cap (vs middle 100, tail count fewer + stakes lower)

// Tail risk 折扣 (rules-based heuristic, Owner pivot framework)
// rules 严的 → tail 1-2%, rules 弱的 → tail 5-10%
function estimateTailRisk(question, description) {
  if (!question) return 0.05;
  const desc = description || '';
  const text = (question + ' ' + desc).toLowerCase();
  // Strict rules signals — lower tail risk
  let tail = 0.03; // default
  if (/physical (custody|transfer|possession)|formally adopt|ratify|signed (and|by both)|cannot be (revoked|undone)/i.test(text)) tail -= 0.02;
  if (/announcement|pledge|commitment|plan|intent|verbal|unilateral declaration/i.test(text)) tail += 0.04;
  if (/credible reporting (also|may) qualif|consensus of (credible|reliable)/i.test(text)) tail += 0.02;
  return Math.max(0.005, Math.min(0.15, tail));
}

// Fetch active markets — paginated
async function fetchActiveMarkets() {
  const all = [];
  for (let off = 0; off < MAX_PAGES * PAGE_SIZE; off += PAGE_SIZE) {
    const url = `https://gamma-api.polymarket.com/markets?closed=false&limit=${PAGE_SIZE}&offset=${off}`;
    const page = await new Promise((resolve) => {
      https.get(url, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve([]); } });
      }).on('error', () => resolve([]));
    });
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

// Score & filter a single market — returns scavenger candidate or null
function scoreMarket(m, nowMs) {
  if (!m.outcomePrices) return null;
  let yes;
  try { yes = parseFloat(JSON.parse(m.outcomePrices)[0]); } catch { return null; }
  if (!Number.isFinite(yes) || yes <= 0 || yes >= 1) return null;
  if (!m.endDate) return null;
  const endMs = new Date(m.endDate).getTime();
  if (!Number.isFinite(endMs) || endMs <= nowMs) return null;
  const hoursToDeadline = (endMs - nowMs) / 3600000;
  if (hoursToDeadline < 1 || hoursToDeadline > 720) return null;  // 1h-30d

  // Direction: BUY_NO (yes ≤ 20%) or BUY_YES (yes ≥ 80%)
  let side, lockPct, gateYes;
  if (yes >= 0.005 && yes <= 0.20) { side = 'NO'; lockPct = yes; gateYes = yes; }
  else if (yes >= 0.80 && yes <= 0.995) { side = 'YES'; lockPct = 1 - yes; gateYes = 1 - yes; }
  else return null;

  // Trajectory check: yes ≤ 5% auto pass OR (1mo<-10pp AND 1wk≤0)
  // 思路 E Layer 1 (Bettor r128 Australia case fix): deadline-decay trajectory.
  //   Short-deadline (< 168h = 7d) markets: momentum is noise not signal. Skip trajectory gate;
  //   allow tail by yes 价区间 + 流动性 + tail risk only. Australia Eurovision 24h 1mo +10.4pp
  //   case 5/15 surface — Eurovision NOT in enrichSports LEAGUE_MAP (8 leagues only) so 思路 E
  //   tail-enrich path null fallback, but Pass 1 sync trajectory hardgate also rejected. This
  //   inline deadline-decay 5-LOC fix lets short-deadline tail markets catch via yes range alone.
  const m1 = m.oneMonthPriceChange || 0;
  const w1 = m.oneWeekPriceChange || 0;
  if (gateYes > 0.05 && hoursToDeadline > 168) {
    // For BUY_NO: trajectory should be 1mo down ≤ -10pp (yes 跌) AND 1wk no bounce-back
    // For BUY_YES: trajectory should be 1mo up ≥ +10pp AND 1wk no drop
    if (side === 'NO') {
      if (m1 > -0.10) return null;
      if (w1 > 0) return null;
    } else {
      if (m1 < 0.10) return null;
      if (w1 < 0) return null;
    }
  }
  // else: deadline ≤ 7d → trajectory skipped, momentum unreliable on short-window

  const vol24 = m.volume24hr || 0;
  const liq = m.liquidity || 0;

  // Liquidity tier based on suggested position size
  // Heavy ($300-700): vol > $50K AND liq > $200K
  // Mid ($100-300):  vol > $10K AND liq > $50K
  // Light ($20-100): vol > $5K  AND liq > $20K
  if (vol24 < 5000 || liq < 20000) return null;
  let sizeTier;
  if (vol24 >= 50000 && liq >= 200000) sizeTier = 'heavy';
  else if (vol24 >= 10000 && liq >= 50000) sizeTier = 'mid';
  else sizeTier = 'light';

  // Tail risk + expected return
  const tail = estimateTailRisk(m.question, m.description);
  const realPSettle = 1 - tail;
  // Expected NO settle (or YES settle) value per $1 cost basis at current market price
  const costBasis = side === 'NO' ? (1 - yes) : yes;
  const expectedPayoff = realPSettle * 1 + tail * 0;  // simple binary
  const expectedReturn = (expectedPayoff - costBasis) / costBasis;

  const suggestedSize = sizeTier === 'heavy' ? 500 : sizeTier === 'mid' ? 200 : 50;

  return {
    market: m,
    side,
    yes_price: yes,
    lockPct,
    expectedReturn,
    tail,
    hoursToDeadline,
    vol24,
    liq,
    sizeTier,
    suggestedSize,
    trajectory: { m1, w1 },
  };
}

// Phase B Sub B1.4 — async middle-range scorer with fundamental enricher.
// scoreMarket above stays sync (handles tails). This handles yes ∈ [0.20, 0.80].
// Returns candidate {..., fundamental_estimate, fundamental_sources, fundamental_confidence, fund_gap, domain} or null.
async function scoreMarketEnriched(m, nowMs) {
  if (!m.outcomePrices) return null;
  let yes;
  try { yes = parseFloat(JSON.parse(m.outcomePrices)[0]); } catch { return null; }
  if (!Number.isFinite(yes) || yes <= 0.20 || yes >= 0.80) return null;  // middle only
  if (!m.endDate) return null;
  const endMs = new Date(m.endDate).getTime();
  if (!Number.isFinite(endMs) || endMs <= nowMs) return null;
  const hoursToDeadline = (endMs - nowMs) / 3600000;
  if (hoursToDeadline < 1 || hoursToDeadline > 720) return null;

  const vol24 = m.volume24hr || 0;
  const liq = m.liquidity || 0;
  // Higher liquidity bar for middle markets — LLM enrichment is expensive, only enrich liquid markets
  if (vol24 < MIDDLE_VOLUME_MIN || liq < MIDDLE_LIQUIDITY_MIN) return null;

  // Step 1: domain detect (cached per market_id 1h TTL via v109 bettor_domain_cache)
  const domain = await detectDomain(m.question, m.description, String(m.id));
  if (!domain || domain.confidence < FUND_DOMAIN_MIN_CONFIDENCE) return null;
  if (domain.domain === 'other') return null;

  // Step 2: domain-specific enrichment. B2.1/B2.2/B3.1 not yet shipped → only sports for now.
  let enriched = null;
  if (domain.domain === 'sports') {
    enriched = await enrichSports(m.question, m.description);
  } else {
    // politics/economic/crypto/legal — defer until B2.x/B3.x ship; middle catch will resume then
    return null;
  }
  if (!enriched?.fundamentals) return null;

  // Step 3: fundamental reasoner — LLM grounded only (Owner invariant 1)
  const fund = await reasonFundamental(m.question, m.description, enriched);
  if (fund.estimate === null) return null;

  const fund_gap = Math.abs(fund.estimate - yes);
  if (fund_gap < FUND_GAP_THRESHOLD) return null;  // 中段必 ≥ 15pp gap

  // Side: market overprices YES → BUY_NO; market underprices YES → BUY_YES
  const side = fund.estimate > yes ? 'YES' : 'NO';
  const lockPct = fund_gap;
  const costBasis = side === 'NO' ? (1 - yes) : yes;
  const tail = Math.max(0.005, 1 - fund.confidence); // higher confidence → lower tail
  const expectedPayoff = 1 - tail;
  const expectedReturn = costBasis > 0 ? (expectedPayoff - costBasis) / costBasis : 0;

  let sizeTier;
  if (vol24 >= 50000 && liq >= 200000) sizeTier = 'heavy';
  else if (vol24 >= 10000 && liq >= 50000) sizeTier = 'mid';
  else sizeTier = 'light';
  const suggestedSize = sizeTier === 'heavy' ? 500 : sizeTier === 'mid' ? 200 : 50;

  return {
    market: m,
    side,
    yes_price: yes,
    lockPct,
    expectedReturn,
    tail,
    hoursToDeadline,
    vol24,
    liq,
    sizeTier,
    suggestedSize,
    trajectory: { m1: m.oneMonthPriceChange || 0, w1: m.oneWeekPriceChange || 0 },
    // Phase B fundamental fields
    fundamental_estimate: fund.estimate,
    fundamental_sources: fund.sources,
    fundamental_confidence: fund.confidence,
    fundamental_reasoning: fund.reasoning,
    domain: domain.domain,
    fund_gap,
    enriched_type: 'fundamental',
  };
}

// 思路 E (Owner 5/15 碰撞质疑 PASS) — tail enricher-first async scorer.
// Handles yes ∈ (0.005, 0.20) BUY_NO OR (0.80, 0.995) BUY_YES range using fundamental enricher.
// Trajectory gate is NOT applied here — enricher fund_gap ≥ 0.05 is the gate. Contrarian-aware.
// Australia Eurovision 5/15 case (yes 17% but 1mo +10.4pp, sports domain) — enricher fund.estimate 3-5% →
// fund_gap 12-14pp ≥ 5pp threshold → BUY_NO catch (无需 trajectory momentum).
async function scoreMarketTailEnriched(m, nowMs) {
  if (!m.outcomePrices) return null;
  let yes;
  try { yes = parseFloat(JSON.parse(m.outcomePrices)[0]); } catch { return null; }
  if (!Number.isFinite(yes) || yes <= 0.005 || yes >= 0.995) return null;
  // Only tail range (skip middle, that's scoreMarketEnriched)
  if (yes > 0.20 && yes < 0.80) return null;
  if (!m.endDate) return null;
  const endMs = new Date(m.endDate).getTime();
  if (!Number.isFinite(endMs) || endMs <= nowMs) return null;
  const hoursToDeadline = (endMs - nowMs) / 3600000;
  if (hoursToDeadline < 1 || hoursToDeadline > 720) return null;
  const vol24 = m.volume24hr || 0;
  const liq = m.liquidity || 0;
  if (vol24 < TAIL_ENRICH_VOLUME_MIN || liq < TAIL_ENRICH_LIQUIDITY_MIN) return null;

  // Step 1: domain detect
  const domain = await detectDomain(m.question, m.description, String(m.id));
  if (!domain || domain.confidence < FUND_DOMAIN_MIN_CONFIDENCE) return null;
  if (domain.domain === 'other') return null;

  // Step 2: domain-specific enrich (only sports supported until B2.x/B3.x ship)
  let enriched = null;
  if (domain.domain === 'sports') {
    enriched = await enrichSports(m.question, m.description);
  } else {
    return null;
  }
  if (!enriched?.fundamentals) return null;

  // Step 3: fundamental reasoning
  const fund = await reasonFundamental(m.question, m.description, enriched);
  if (fund.estimate === null) return null;

  const fund_gap = Math.abs(fund.estimate - yes);
  if (fund_gap < TAIL_FUND_GAP_THRESHOLD) return null;  // tail 阈值 5pp

  // Side derivation — fundamental says yes lower than market → market overprices YES → BUY_NO
  // For tail markets: yes 0.20 typically signals "unlikely event" — if fund estimates LOWER than market (e.g. fund 5% vs market 17%), Owner contrarian thesis → BUY_NO
  // If yes ≥ 0.80, market says "very likely YES" — if fund higher, BUY_YES; if fund lower (rare for high yes), BUY_NO
  const side = fund.estimate > yes ? 'YES' : 'NO';
  const lockPct = fund_gap;
  const costBasis = side === 'NO' ? (1 - yes) : yes;
  const tail = Math.max(0.005, 1 - fund.confidence);
  const expectedPayoff = 1 - tail;
  const expectedReturn = costBasis > 0 ? (expectedPayoff - costBasis) / costBasis : 0;

  let sizeTier;
  if (vol24 >= 50000 && liq >= 200000) sizeTier = 'heavy';
  else if (vol24 >= 10000 && liq >= 50000) sizeTier = 'mid';
  else sizeTier = 'light';
  const suggestedSize = sizeTier === 'heavy' ? 500 : sizeTier === 'mid' ? 200 : 50;

  return {
    market: m,
    side,
    yes_price: yes,
    lockPct,
    expectedReturn,
    tail,
    hoursToDeadline,
    vol24,
    liq,
    sizeTier,
    suggestedSize,
    trajectory: { m1: m.oneMonthPriceChange || 0, w1: m.oneWeekPriceChange || 0 },
    // Phase B fundamental fields
    fundamental_estimate: fund.estimate,
    fundamental_sources: fund.sources,
    fundamental_confidence: fund.confidence,
    fundamental_reasoning: fund.reasoning,
    domain: domain.domain,
    fund_gap,
    enriched_type: 'tail_fundamental',
  };
}

// Get open positions for replacement comparison
function getOpenPositions(relayNodeId) {
  // bettor_recommendations rows currently 'open' status (per Phase 3a schema)
  const rows = sqlite.prepare(`
    SELECT id, condition_id, question, yes_price, decision, end_date,
           p_mid, calibrator_confidence
    FROM bettor_recommendations
    WHERE relay_node_id = ? AND status IN ('open', 'pending')
  `).all(relayNodeId);
  return rows.map(r => {
    const entryYes = Number(r.yes_price) || 0;
    const direction = r.decision === 'YES' || r.decision === 'BUY_YES' ? 'YES' : 'NO';
    const costBasis = direction === 'NO' ? (1 - entryYes) : entryYes;
    // Estimate tail risk from rec's prior p_mid if available, else default 3%
    const tail = r.p_mid != null ? (direction === 'NO' ? Number(r.p_mid) : 1 - Number(r.p_mid)) : 0.03;
    const expectedReturn = costBasis > 0 ? ((1 - tail) - costBasis) / costBasis : 0;
    return { id: r.id, conditionId: r.condition_id, question: r.question, direction, endDate: r.end_date, expectedReturn };
  });
}

// Insert candidate into bettor_recommendations (trigger_type='scavenger')
function persistCandidates(candidates, relayNodeId, triggerType, openPositions) {
  if (!candidates.length) return 0;
  const now = new Date().toISOString();

  // Phase B Sub B1.4: persist + fundamental_estimate/_sources/_confidence (v109 cols)
  const stmt = sqlite.prepare(`
    INSERT INTO bettor_recommendations
      (id, relay_node_id, market_id, condition_id, slug, question,
       decision, fraction, size_usd, edge, p_mid, sigma, info_gap_months,
       yes_price, volume_24h, liquidity, end_date, score,
       reasoning_json, trigger_type, llm_tier, status, calibrator_confidence, lifecycle_state, scanned_at,
       fundamental_estimate, fundamental_sources, fundamental_confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
  `);

  const minOpenReturn = openPositions.length > 0
    ? Math.min(...openPositions.map(p => p.expectedReturn))
    : 0;

  const tx = sqlite.transaction((rows) => {
    let count = 0;
    for (const c of rows) {
      // Determine candidate type: new vs replacement-candidate
      const isReplacement = openPositions.length > 0 && c.expectedReturn >= minOpenReturn + MIN_EXPECTED_RETURN_SPREAD;
      const candidateType = isReplacement ? 'replacement' : 'new';

      const reasoning = {
        algorithm: 'scavenger',
        side: c.side,
        yes_price: c.yes_price,
        lock_pct: c.lockPct,
        expected_return: c.expectedReturn,
        tail_risk: c.tail,
        trajectory: c.trajectory,
        liquidity_tier: c.sizeTier,
        candidate_type: candidateType,
        replacement_for: isReplacement
          ? openPositions.filter(p => c.expectedReturn >= p.expectedReturn + MIN_EXPECTED_RETURN_SPREAD).map(p => p.id)
          : [],
        // Phase B Sub B1.4 — fundamental enricher fields (null for tail candidates, populated for middle)
        enriched_type: c.enriched_type || 'tail',
        domain: c.domain || null,
        fund_gap: c.fund_gap ?? null,
        fundamental_reasoning: c.fundamental_reasoning || null,
      };

      stmt.run(
        randomUUID(),
        relayNodeId,
        String(c.market.id),
        c.market.conditionId || null,
        c.market.slug || null,
        c.market.question?.slice(0, 500) || '',
        c.side,
        c.suggestedSize / DEFAULT_BANKROLL,
        c.suggestedSize,
        c.expectedReturn,
        1 - c.tail,                        // p_mid = real probability of intended direction settling
        c.tail,                            // sigma = tail risk for transparency
        0,                                 // info_gap_months (legacy NOT NULL field, scavenger ignores)
        c.yes_price,
        c.vol24,
        c.liq,
        c.market.endDate,
        c.expectedReturn * (1 - c.tail),   // score = expected return × confidence
        JSON.stringify(reasoning),
        triggerType,
        c.enriched_type === 'fundamental' ? 'scavenger+enricher' : 'scavenger',  // llm_tier marker
        1 - c.tail,                        // calibrator_confidence = our confidence
        'scavenger',                       // lifecycle_state
        now,
        // Phase B v109 fund cols (null for tail candidates, populated for middle enriched)
        c.fundamental_estimate ?? null,
        c.fundamental_sources ? JSON.stringify(c.fundamental_sources) : null,
        c.fundamental_confidence ?? null
      );
      count++;
    }
    return count;
  });
  return tx(candidates);
}

let _runningScan = null;

export async function runScavengerScan(triggerType = 'cron', relayNodeId = null) {
  if (_runningScan) return { ok: false, reason: 'scan in progress' };

  // Resolve relay id (same chain as bettor-scanner)
  let resolvedRelayId = relayNodeId;
  if (!resolvedRelayId) {
    const cfg = sqlite.prepare(`SELECT value_encrypted FROM config_entries WHERE key='bettor_default_agent_relay_id'`).get();
    if (cfg?.value_encrypted) resolvedRelayId = cfg.value_encrypted;
  }
  if (!resolvedRelayId) {
    // Try J2 first (Owner 5/14 钦定 J2 wallet 当前 trade host)
    const j2 = sqlite.prepare(`SELECT id FROM relay_nodes WHERE name='J2'`).get();
    if (j2?.id) resolvedRelayId = j2.id;
  }
  if (!resolvedRelayId) {
    const bettor = sqlite.prepare(`SELECT id FROM relay_nodes WHERE name='Bettor'`).get();
    if (bettor?.id) resolvedRelayId = bettor.id;
  }
  if (!resolvedRelayId) return { ok: false, reason: 'no_default_agent' };

  const startedAt = Date.now();
  _runningScan = (async () => {
    try {
      console.log(`[scavenger] start (trigger=${triggerType}, relay=${resolvedRelayId.slice(0,8)})`);
      const all = await fetchActiveMarkets();
      const nowMs = Date.now();
      const candidates = [];

      // Module 2 (Owner 5/15 推荐历史 + 胜率轨迹): snapshot per-market yes_price into v110 bettor_market_price_history.
      // Snapshot ALL fetched markets each scan tick (not just qualified) — corpus for future analysis.
      // Volume gated to avoid noise: only markets with vol24h ≥ $1K logged. ~3-5K snapshots per 6h scan.
      const snapshotStmt = sqlite.prepare(`
        INSERT INTO bettor_market_price_history (market_id, condition_id, yes_price, no_price, volume_24h, liquidity, one_week_change, one_month_change, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scavenger_scan')
      `);
      const snapshotTx = sqlite.transaction((markets) => {
        let n = 0;
        for (const m of markets) {
          if (!m.outcomePrices) continue;
          let yes;
          try { yes = parseFloat(JSON.parse(m.outcomePrices)[0]); } catch { continue; }
          if (!Number.isFinite(yes) || yes <= 0 || yes >= 1) continue;
          if ((m.volume24hr || 0) < 1000) continue;
          snapshotStmt.run(
            String(m.id), m.conditionId || null,
            yes, 1 - yes,
            m.volume24hr || null, m.liquidity || null,
            m.oneWeekPriceChange || null, m.oneMonthPriceChange || null
          );
          n++;
        }
        return n;
      });
      const snapshots = snapshotTx(all);
      console.log(`[scavenger] price history snapshot: ${snapshots} rows written (vol24h ≥ $1K)`);

      // Pass 1: cheap sync scoreMarket — handles tails (yes ≤ 20% OR ≥ 80%)
      for (const m of all) {
        const c = scoreMarket(m, nowMs);
        if (c) candidates.push(c);
      }
      const tailCount = candidates.length;

      // Pass 2 (Phase B Sub B1.4): async fundamental enricher for middle (yes 20-80%).
      // Hard cap MAX_MIDDLE_ENRICH_PER_SCAN to bound LLM cost. Pre-sort by liquidity desc.
      // Domain detector cache 1h TTL → second-scan-within-1h free.
      const middleRaw = all
        .filter(m => {
          if (!m.outcomePrices) return false;
          try {
            const yes = parseFloat(JSON.parse(m.outcomePrices)[0]);
            return Number.isFinite(yes) && yes > 0.20 && yes < 0.80
              && (m.volume24hr || 0) >= MIDDLE_VOLUME_MIN
              && (m.liquidity || 0) >= MIDDLE_LIQUIDITY_MIN;
          } catch { return false; }
        })
        .sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0))
        .slice(0, MAX_MIDDLE_ENRICH_PER_SCAN);
      console.log(`[scavenger] middle-pass: ${middleRaw.length} candidates (cap ${MAX_MIDDLE_ENRICH_PER_SCAN}), enriching with detectDomain → enricher → reasoner...`);
      let middleEnriched = 0;
      for (const m of middleRaw) {
        try {
          const c = await scoreMarketEnriched(m, nowMs);
          if (c) { candidates.push(c); middleEnriched++; }
        } catch (e) {
          console.log(`[scavenger] middle enrich fail for ${m.id}: ${e.message?.slice(0,80)}`);
        }
      }
      console.log(`[scavenger] middle-pass result: ${middleEnriched} enriched candidates (out of ${middleRaw.length} liquid middle markets)`);

      // Pass 3 (思路 E, Owner 5/15 碰撞质疑 + Bettor r126 PASS):
      // Tail enricher-first — for tail markets (yes ≤ 0.20 OR ≥ 0.80) NOT already caught by sync trajectory gate,
      // try fundamental enricher. Skip if domain='other' OR not sports (until B2.x/B3.x). fund_gap ≥ 5pp threshold.
      // Australia Eurovision 5/15 type case: yes 17% but +10.4pp momentum (sync trajectory rejects) →
      // enricher fund.estimate 3-5% → gap 12-14pp ≥ 5pp → BUY_NO catch (无需 trajectory momentum).
      const tailEnrichTargets = all
        .filter(m => {
          if (!m.outcomePrices) return false;
          // Skip if already caught by Pass 1 sync (would be double-counting)
          if (candidates.some(c => c.market.id === m.id)) return false;
          try {
            const yes = parseFloat(JSON.parse(m.outcomePrices)[0]);
            const isTail = (yes > 0.005 && yes <= 0.20) || (yes >= 0.80 && yes < 0.995);
            return Number.isFinite(yes) && isTail
              && (m.volume24hr || 0) >= TAIL_ENRICH_VOLUME_MIN
              && (m.liquidity || 0) >= TAIL_ENRICH_LIQUIDITY_MIN;
          } catch { return false; }
        })
        .sort((a, b) => (b.liquidity || 0) - (a.liquidity || 0))
        .slice(0, MAX_TAIL_ENRICH_PER_SCAN);
      console.log(`[scavenger] tail-enrich pass: ${tailEnrichTargets.length} candidates (cap ${MAX_TAIL_ENRICH_PER_SCAN}, sync-rejected tail markets), enriching...`);
      let tailEnriched = 0;
      for (const m of tailEnrichTargets) {
        try {
          const c = await scoreMarketTailEnriched(m, nowMs);
          if (c) { candidates.push(c); tailEnriched++; }
        } catch (e) {
          console.log(`[scavenger] tail enrich fail for ${m.id}: ${e.message?.slice(0,80)}`);
        }
      }
      console.log(`[scavenger] tail-enrich result: ${tailEnriched} catches from ${tailEnrichTargets.length} attempts (思路 E enricher-first contrarian catches)`);

      // Sort by expected_return desc, take top 20
      candidates.sort((a, b) => b.expectedReturn - a.expectedReturn);
      const top = candidates.slice(0, 20);
      console.log(`[scavenger] fetched ${all.length} → ${tailCount} tail + ${middleEnriched} middle + ${tailEnriched} tail-enriched (思路 E) = ${candidates.length} total qualified → top ${top.length}`);

      const openPositions = getOpenPositions(resolvedRelayId);
      console.log(`[scavenger] current open positions: ${openPositions.length}, min expected return: ${openPositions.length ? Math.min(...openPositions.map(p => p.expectedReturn)).toFixed(3) : 'n/a'}`);

      const written = persistCandidates(top, resolvedRelayId, triggerType, openPositions);
      const elapsed = Date.now() - startedAt;
      console.log(`[scavenger] wrote ${written} candidates (${elapsed} ms)`);
      return { ok: true, fetched: all.length, qualified: candidates.length, written, elapsed_ms: elapsed };
    } catch (e) {
      console.log(`[scavenger] FAILED: ${e.message}`);
      return { ok: false, error: e.message };
    } finally {
      _runningScan = null;
    }
  })();
  return _runningScan;
}

export function isScavengerRunning() { return !!_runningScan; }

const CRON_INTERVAL_MS = 6 * 60 * 60 * 1000;
let _cronTimer = null;

export function startScavengerCron() {
  if (_cronTimer) return;
  _cronTimer = setInterval(() => {
    runScavengerScan('cron').catch(err => console.log(`[scavenger] cron err: ${err.message}`));
  }, CRON_INTERVAL_MS);
  console.log(`[scavenger] cron registered: every ${CRON_INTERVAL_MS / 3600000}h`);
}

export function stopScavengerCron() {
  if (_cronTimer) { clearInterval(_cronTimer); _cronTimer = null; }
}
