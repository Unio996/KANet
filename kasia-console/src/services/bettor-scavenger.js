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

const PAGE_SIZE = 500;
const MAX_PAGES = 20;        // 10K markets max
const DEFAULT_BANKROLL = 1000;
const MIN_EXPECTED_RETURN_SPREAD = 0.03;  // 3pp Owner-mandated replacement threshold
const DEADLINE_GRACE_DAYS = 7;             // 允许 deadline 比现持仓略远

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
  const m1 = m.oneMonthPriceChange || 0;
  const w1 = m.oneWeekPriceChange || 0;
  if (gateYes > 0.05) {
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

  const stmt = sqlite.prepare(`
    INSERT INTO bettor_recommendations
      (id, relay_node_id, market_id, condition_id, slug, question,
       decision, fraction, size_usd, edge, p_mid, sigma, info_gap_months,
       yes_price, volume_24h, liquidity, end_date, score,
       reasoning_json, trigger_type, llm_tier, status, calibrator_confidence, lifecycle_state, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
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
        'scavenger',                       // llm_tier marker
        1 - c.tail,                        // calibrator_confidence = our confidence
        'scavenger',                       // lifecycle_state
        now
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
      for (const m of all) {
        const c = scoreMarket(m, nowMs);
        if (c) candidates.push(c);
      }
      // Sort by expected_return desc, take top 20
      candidates.sort((a, b) => b.expectedReturn - a.expectedReturn);
      const top = candidates.slice(0, 20);
      console.log(`[scavenger] fetched ${all.length} → ${candidates.length} qualified → top ${top.length}`);

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
