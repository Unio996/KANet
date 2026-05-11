/**
 * Bettor Scanner — Phase 3a
 *
 * 6h cron + spike trigger 扫 Polymarket markets, top 10 by score 写表.
 * Owner 5/9 钦定: 默认 ≤14d 窗 / 例外 (yes>95% OR no>95%) AND vol>$50K → ≤30d.
 *
 * Pipeline per market:
 *   1. parseRule(description) → disqualifier 标记 + embeddedFacts
 *   2. LLM estimate pMid/sigma (GLM → bridge → llama 三层 fallback)
 *   3. recommendBet (Phase 1 lib) → side/fraction/size/edge
 *   4. score = fraction × edge × (1 - sigma)
 *   5. top 10 by score → bettor_recommendations 表
 */

import { randomUUID } from 'crypto';
import { sqlite } from '../db/client.js';
import { fetchPredictionData } from './market-data.js';
import { callLLMWithFallback } from './llm-fallback.js';

const KANET_ROOT = process.env.KANET_ROOT || 'C:/kanet';

// Lazy import Phase 1 lib (lives in agent-mind/)
let _parseRule, _latestEmbeddedDate, _recommendBet;
async function loadLib() {
  if (_parseRule) return;
  const rp = await import(`file:///${KANET_ROOT}/agent-mind/src/skills/bettor/rule-parser.mjs`);
  const k = await import(`file:///${KANET_ROOT}/agent-mind/src/skills/bettor/kelly.mjs`);
  _parseRule = rp.parseRule;
  _latestEmbeddedDate = rp.latestEmbeddedDate;
  _recommendBet = k.recommendBet;
}

// ── tunables (Owner 5/9 钦定) ────────────────────────────────────────────
const TRAINING_CUTOFF = '2026-01-31';
const DEFAULT_WINDOW_DAYS = 14;
const DEFAULT_MIN_VOL = 5_000;          // default 窗口至少 $5K vol24h, 滤掉 dust 体育赛事
const EXCEPTION_WINDOW_DAYS = 30;
const EXCEPTION_VOL_USD = 50_000;
const EXCEPTION_PRICE_THRESHOLD = 0.95;
const MAX_SCAN_PER_RUN = 60;             // 防止 200+ 个市场把 LLM 打死
const TOP_N = 10;
const LLM_CONCURRENCY = 3;
const DEFAULT_BANKROLL = 1000;
const KELLY_FRACTION = 0.25;
const INVENTORY_SAFETY_MIN_FRAC = 0.10;     // 即使全仓占满, 仍至少留 10% bankroll 给新单
const SCAN_TIMEOUT_PER_MARKET_MS = 180_000; // 3 min hard cap per market

// Phase 3e-2 Layer 4 auto-fallback (J1 #116 propose, Owner 5/11 钦定 quality>quantity 反向渐进):
// activeThreshold default 0.95 (Owner 字面起步), 若 7 天 0 settled 自动降级 → 0.90 → 0.85
// 数据稳定后 Owner 手动改回 (config_entries override).
const CONFIDENCE_FALLBACK_LEVELS = [0.95, 0.90, 0.85];
const CONFIDENCE_FALLBACK_REVIEW_DAYS = 7;
const CONFIDENCE_THRESHOLD_KEY = 'bettor_confidence_threshold';
const CONFIDENCE_FALLBACK_LOG_KEY = 'bettor_confidence_fallback_log';

// Phase 3e-2 Layer 3 correlation caps (J1 #107 ack, Sophie 5 笔 MLB / 2 笔 Greece Eurovision 实证)
const SAME_SPORT_CAP_PER_BATCH = 2;     // 单 batch 同 sport 最多 2 笔
const SAME_EVENT_CAP_PER_BATCH = 1;     // 单 batch 同事件 (e.g. Greece Eurovision) 最多 1 笔

// Sport detection keywords (lowercase substring match)
const SPORT_KEYWORDS = {
  mlb: ['mlb ', 'yankees', 'red sox', 'tigers', 'royals', 'cardinals', 'mariners', 'cubs', 'rangers', 'padres', 'brewers', 'dodgers', 'braves', 'white sox'],
  nba: ['nba ', 'lakers', 'knicks', '76ers', 'thunder', 'celtics', 'warriors', 'heat'],
  nfl: ['nfl ', 'patriots', 'cowboys', 'giants', 'eagles'],
  ufc: ['ufc ', 'fight to', 'middleweight', 'lightweight', 'welterweight'],
  tennis: ['atp ', 'wta ', 'internazionali', 'roland garros', 'wimbledon'],
  soccer: ['premier league', 'champions league', 'la liga', 'bundesliga'],
};

function detectSport(question) {
  const q = (question || '').toLowerCase();
  for (const [sport, kws] of Object.entries(SPORT_KEYWORDS)) {
    if (kws.some(k => q.includes(k))) return sport;
  }
  return null;
}

// Event signature: extract key event name (Eurovision / playoffs / specific tournament)
// Crude but effective for dup detection within one batch.
function detectEventKey(question) {
  const q = (question || '').toLowerCase();
  const patterns = [
    /eurovision\s*\d{4}/,
    /world cup\s*\d{4}/,
    /super bowl\s*[lxiv]+/,
    /us(?:[-x])iran[^?]*?\d{4}/,
    /ufc\s*\d{2,4}/,
    /nba playoffs/,
    /presidential election\s*\d{4}/,
  ];
  for (const re of patterns) {
    const m = q.match(re);
    if (m) return m[0].trim();
  }
  return null;
}

// ── prompt for LLM estimator ─────────────────────────────────────────────

function buildEstimatorPrompt(market, parsedRule) {
  const facts = parsedRule?.embeddedFacts?.length
    ? `Embedded facts (e.g. clauses): ${parsedRule.embeddedFacts.join(' | ')}`
    : '';
  const disq = parsedRule?.disqualifiers?.length
    ? `Disqualifiers:\n${parsedRule.disqualifiers.map(d => '  - ' + d).join('\n')}`
    : 'No disqualifiers detected.';

  const system = `You are Bettor — a calibrated forecaster for binary prediction markets.
Estimate the YES probability with brutal honesty about uncertainty.
When ambiguous, shave toward NO (conservative).
Output STRICT JSON only, no markdown fences, no commentary.`;

  const user = `MARKET: ${market.question}
CURRENT YES PRICE: ${market.yes != null ? (market.yes / 100).toFixed(3) : 'unknown'}
END DATE: ${market.endDate || 'unknown'}
24H VOLUME: $${Math.round(market.volume24h || 0).toLocaleString()}

DESCRIPTION:
${market.description || '(no description)'}

${disq}
${facts}

Output JSON:
{
  "pMid": <0-1 central estimate>,
  "sigma": <0-1 std dev of estimate>,
  "reasoning": "<one short sentence>"
}`;
  return { system, user };
}

function parseLLMJson(text) {
  if (!text) return null;
  let s = text.trim();
  // Strip code fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // Find first { ... } block
  const m = s.match(/\{[\s\S]*\}/);
  if (m) s = m[0];
  try {
    const obj = JSON.parse(s);
    if (typeof obj.pMid !== 'number' || obj.pMid < 0 || obj.pMid > 1) return null;
    return {
      pMid: obj.pMid,
      sigma: typeof obj.sigma === 'number' ? Math.max(0, Math.min(1, obj.sigma)) : 0.05,
      reasoning: obj.reasoning || '',
    };
  } catch {
    return null;
  }
}

// ── filtering ────────────────────────────────────────────────────────────

function eligible(market, nowMs) {
  if (!market.endDate || market.yes == null) return false;
  const endMs = new Date(market.endDate).getTime();
  if (!Number.isFinite(endMs) || endMs <= nowMs) return false;
  const daysToExpiry = (endMs - nowMs) / (1000 * 60 * 60 * 24);

  const yesFrac = market.yes / 100;
  const noFrac = 1 - yesFrac;
  const isExtreme = yesFrac >= EXCEPTION_PRICE_THRESHOLD || noFrac >= EXCEPTION_PRICE_THRESHOLD;
  const enoughVol = (market.volume24h || 0) >= EXCEPTION_VOL_USD;

  // 默认窗口需 vol >= DEFAULT_MIN_VOL 滤 dust
  if (daysToExpiry <= DEFAULT_WINDOW_DAYS && (market.volume24h || 0) >= DEFAULT_MIN_VOL) return true;
  if (daysToExpiry <= EXCEPTION_WINDOW_DAYS && isExtreme && enoughVol) return true;
  return false;
}

// ── concurrency limiter (no external dep) ────────────────────────────────

async function pMapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try { results[i] = await fn(items[i], i); }
      catch (e) { results[i] = { error: e?.message || String(e) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── confidence threshold auto-fallback (J1 #116 propose) ─────────────────

export function getActiveConfidenceThreshold() {
  const row = sqlite.prepare(`SELECT value_encrypted FROM config_entries WHERE key=?`).get(CONFIDENCE_THRESHOLD_KEY);
  const stored = row?.value_encrypted ? parseFloat(row.value_encrypted) : null;
  if (stored && CONFIDENCE_FALLBACK_LEVELS.includes(stored)) return stored;
  return CONFIDENCE_FALLBACK_LEVELS[0]; // default 0.95
}

function setActiveConfidenceThreshold(newVal, reason) {
  const now = new Date().toISOString();
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  // Upsert threshold
  const existing = sqlite.prepare(`SELECT id FROM config_entries WHERE key=?`).get(CONFIDENCE_THRESHOLD_KEY);
  if (existing) {
    sqlite.prepare(`UPDATE config_entries SET value_encrypted=?, updated_at=? WHERE key=?`)
      .run(String(newVal), now, CONFIDENCE_THRESHOLD_KEY);
  } else {
    sqlite.prepare(`INSERT INTO config_entries (id, key, category, value_encrypted, is_sensitive, created_at, updated_at) VALUES (?, ?, 'bettor', ?, 0, ?, ?)`)
      .run(id, CONFIDENCE_THRESHOLD_KEY, String(newVal), now, now);
  }
  // Append log
  const logRow = sqlite.prepare(`SELECT value_encrypted FROM config_entries WHERE key=?`).get(CONFIDENCE_FALLBACK_LOG_KEY);
  let logArr = [];
  try { logArr = logRow?.value_encrypted ? JSON.parse(logRow.value_encrypted) : []; } catch { logArr = []; }
  logArr.push({ at: now, to: newVal, reason });
  const logStr = JSON.stringify(logArr.slice(-50));
  if (logRow) {
    sqlite.prepare(`UPDATE config_entries SET value_encrypted=?, updated_at=? WHERE key=?`)
      .run(logStr, now, CONFIDENCE_FALLBACK_LOG_KEY);
  } else {
    sqlite.prepare(`INSERT INTO config_entries (id, key, category, value_encrypted, is_sensitive, created_at, updated_at) VALUES (?, ?, 'bettor', ?, 0, ?, ?)`)
      .run(id + '-log', CONFIDENCE_FALLBACK_LOG_KEY, 'bettor', logStr, now, now);
  }
  console.log(`[bettor-scanner] confidence threshold → ${newVal} (reason: ${reason})`);
}

// 检查是否需要 auto-fallback: 7 天内 0 settled recommendation → 降级
function maybeAutoFallback(relayNodeId) {
  if (!relayNodeId) return;
  const cur = getActiveConfidenceThreshold();
  const curIdx = CONFIDENCE_FALLBACK_LEVELS.indexOf(cur);
  if (curIdx < 0 || curIdx >= CONFIDENCE_FALLBACK_LEVELS.length - 1) return; // 已最低或异常

  const recent = sqlite.prepare(`
    SELECT COUNT(*) c FROM bettor_recommendations
    WHERE relay_node_id=? AND status='resolved'
      AND scanned_at > datetime('now', '-${CONFIDENCE_FALLBACK_REVIEW_DAYS} days')
  `).get(relayNodeId);
  if ((recent?.c || 0) > 0) return; // 7 天内有 settled, 不降级

  // Additional safeguard: 至少 scanned 过 N 次才认 "0 settled" 信号
  const anyWritten = sqlite.prepare(`
    SELECT COUNT(*) c FROM bettor_recommendations
    WHERE relay_node_id=? AND scanned_at > datetime('now', '-${CONFIDENCE_FALLBACK_REVIEW_DAYS} days')
  `).get(relayNodeId);
  if ((anyWritten?.c || 0) === 0) {
    // 7 天没扫过, 不是 "0 confidence pass", 不降级
    return;
  }

  const next = CONFIDENCE_FALLBACK_LEVELS[curIdx + 1];
  setActiveConfidenceThreshold(next, `auto-fallback ${cur}→${next} (7d 0 settled, ${anyWritten?.c || 0} scanned)`);
}

// ── inventory-aware bankroll: 扣已 open 仓位 ───────────────────────────────

function getOpenInventory(relayNodeId) {
  if (!relayNodeId) return 0;
  const r = sqlite.prepare(`
    SELECT COALESCE(SUM(size_usd), 0) total FROM bettor_sim_positions
    WHERE relay_node_id = ? AND closed_at IS NULL AND size_usd > 0
  `).get(relayNodeId);
  return r?.total || 0;
}

// ── adapter URL lookup per Agent ─────────────────────────────────────────

export function getAdapterUrlForAgent(relayNodeId) {
  if (!relayNodeId) return null;
  const row = sqlite.prepare(`
    SELECT a.http_port FROM relay_nodes r
    JOIN adapter_nodes a ON a.id = r.adapter_node_id
    WHERE r.id = ?
  `).get(relayNodeId);
  return row?.http_port ? `http://127.0.0.1:${row.http_port}` : null;
}

// ── single-market scan ───────────────────────────────────────────────────

async function scanOne(market, adapterUrl, availableBankroll, activeConfidenceThreshold) {
  await loadLib();
  const yesPrice = market.yes / 100;

  let parsed = null;
  try { parsed = _parseRule(market.description || ''); } catch {}

  // Compute info gap
  let infoGapMonths = 0;
  if (parsed) {
    const latest = _latestEmbeddedDate(parsed);
    if (latest) {
      const cutoffMs = new Date(TRAINING_CUTOFF).getTime();
      infoGapMonths = Math.max(0, (latest.getTime() - cutoffMs) / (1000 * 60 * 60 * 24 * 30.44));
    }
  }

  const { system, user } = buildEstimatorPrompt(market, parsed);
  const llmResult = await Promise.race([
    callLLMWithFallback({ system, user, adapterUrl }),
    new Promise(res => setTimeout(() => res({ ok: false, error: 'scan timeout' }), SCAN_TIMEOUT_PER_MARKET_MS)),
  ]);

  if (!llmResult.ok) {
    return { market, error: llmResult.error };
  }

  const est = parseLLMJson(llmResult.text);
  if (!est) {
    return { market, error: 'LLM JSON parse failed', raw: llmResult.text?.slice(0, 200) };
  }

  // Inventory-aware: bankroll 扣已 open 仓位, 至少留 INVENTORY_SAFETY_MIN_FRAC 防全锁死
  const effectiveBankroll = Math.max(
    availableBankroll != null ? availableBankroll : DEFAULT_BANKROLL,
    DEFAULT_BANKROLL * INVENTORY_SAFETY_MIN_FRAC
  );

  const rec = _recommendBet({
    pMid: est.pMid,
    sigma: est.sigma,
    yesPrice,
    bankroll: effectiveBankroll,
    infoGapMonths,
    kellyFraction: KELLY_FRACTION,
    confidenceThreshold: activeConfidenceThreshold,
  });

  const edge = rec.side === 'YES'
    ? Math.abs(est.pMid - yesPrice)
    : rec.side === 'NO'
      ? Math.abs((1 - est.pMid) - (1 - yesPrice))
      : 0;
  const score = rec.fraction * edge * Math.max(0, 1 - est.sigma);

  return {
    market,
    parsed,
    estimate: est,
    rec,
    edge,
    score,
    infoGapMonths,
    llmTier: llmResult.tier,
  };
}

// ── persist top N ────────────────────────────────────────────────────────

function persist(results, triggerType = 'cron', relayNodeId = null) {
  const now = new Date().toISOString();

  // Phase 3e-2 Layer 3: correlation caps. Sort by score desc, walk + drop over caps.
  const sorted = results
    .filter(r => r && !r.error && r.rec && r.score > 0)
    .sort((a, b) => b.score - a.score);

  const sportCounts = {};
  const eventCounts = {};
  const filtered = [];
  let droppedSport = 0, droppedEvent = 0;
  for (const r of sorted) {
    const q = r.market?.question || '';
    const sport = detectSport(q);
    const eventKey = detectEventKey(q);

    if (eventKey) {
      const c = eventCounts[eventKey] || 0;
      if (c >= SAME_EVENT_CAP_PER_BATCH) { droppedEvent++; continue; }
      eventCounts[eventKey] = c + 1;
    }
    if (sport) {
      const c = sportCounts[sport] || 0;
      if (c >= SAME_SPORT_CAP_PER_BATCH) { droppedSport++; continue; }
      sportCounts[sport] = c + 1;
    }
    filtered.push(r);
    if (filtered.length >= TOP_N) break;
  }
  if (droppedSport || droppedEvent) {
    console.log(`[bettor-scanner] correlation caps: dropped ${droppedSport} same-sport / ${droppedEvent} same-event (Phase 3e-2 Layer 3)`);
  }
  const valid = filtered;

  const stmtRec = sqlite.prepare(`
    INSERT INTO bettor_recommendations
      (id, relay_node_id, market_id, condition_id, slug, question,
       decision, fraction, size_usd, edge, p_mid, sigma, info_gap_months,
       yes_price, volume_24h, liquidity, end_date, score,
       reasoning_json, trigger_type, llm_tier, status, scanned_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `);
  const stmtPos = sqlite.prepare(`
    INSERT INTO bettor_sim_positions
      (id, recommendation_id, relay_node_id, direction,
       entry_yes_price, entry_buy_price, size_usd, shares, opened_at, market_description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = sqlite.transaction((rows) => {
    for (const r of rows) {
      const recId = randomUUID();
      stmtRec.run(
        recId,
        relayNodeId,
        String(r.market.id),
        r.market.conditionId || null,
        r.market.slug || null,
        r.market.question?.slice(0, 500) || '',
        r.rec.side,
        r.rec.fraction,
        r.rec.size,
        r.edge,
        r.estimate.pMid,
        r.estimate.sigma,
        r.infoGapMonths,
        r.market.yes / 100,
        r.market.volume24h || null,
        r.market.liquidity || null,
        r.market.endDate || null,
        r.score,
        JSON.stringify({ reasoning: r.estimate.reasoning, trace: r.rec.reasoning }),
        triggerType,
        r.llmTier,
        now
      );
      // Mirror sim_position: locks entry price/size at decision moment.
      const yesPrice = r.market.yes / 100;
      const dir = r.rec.side;
      const entryBuy = dir === 'YES' ? yesPrice : (dir === 'NO' ? (1 - yesPrice) : 0);
      const shares = entryBuy > 0 ? r.rec.size / entryBuy : 0;
      // Phase 3e-6 P0.1: cap market description at 5000 chars for reactor LLM 重估 (Q1 c, Bettor r31 决断)
      const marketDesc = typeof r.market.description === 'string' ? r.market.description.slice(0, 5000) : null;
      stmtPos.run(
        randomUUID(), recId, relayNodeId, dir,
        yesPrice, entryBuy, dir === 'SKIP' ? 0 : r.rec.size, shares,
        now, marketDesc
      );
    }
  });
  tx(valid);
  return valid.length;
}

// ── public API ───────────────────────────────────────────────────────────

let _runningScan = null;

/**
 * Run a scan. relayNodeId selects which Agent's adapter to use.
 * Cron resolution chain: param → config_entries (per-host) → 'Bettor' agent → null
 * Owner 5/10 钦定单 agent 跑 (Sophie/Bettor/whoever). null 终态 = 跳过 cron 不写脏数据.
 */
export async function runScan(triggerType = 'cron', relayNodeId = null) {
  if (_runningScan) {
    return { ok: false, reason: 'scan already in progress' };
  }
  // Resolve relay id: param > config_entries > 'Bettor' agent name > null
  let resolvedRelayId = relayNodeId;
  let resolutionSource = relayNodeId ? 'param' : null;
  if (!resolvedRelayId) {
    // config_entries column is value_encrypted (also holds plain when is_sensitive=0)
    const cfg = sqlite.prepare(`SELECT value_encrypted FROM config_entries WHERE key='bettor_default_agent_relay_id'`).get();
    if (cfg?.value_encrypted) { resolvedRelayId = cfg.value_encrypted; resolutionSource = 'config'; }
  }
  if (!resolvedRelayId) {
    const bettor = sqlite.prepare(`SELECT id FROM relay_nodes WHERE name='Bettor'`).get();
    if (bettor?.id) { resolvedRelayId = bettor.id; resolutionSource = 'name=Bettor'; }
  }

  // Hard gate: null = skip cron, refuse to write null relay_node_id rows
  if (!resolvedRelayId) {
    console.log(`[bettor-scanner] skip ${triggerType} — no default agent configured. Set config_entries.key='bettor_default_agent_relay_id' or create 'Bettor' relay.`);
    return { ok: false, reason: 'no_default_agent', hint: "set config_entries key='bettor_default_agent_relay_id'" };
  }

  const adapterUrl = getAdapterUrlForAgent(resolvedRelayId);
  if (!adapterUrl) {
    console.log(`[bettor-scanner] skip ${triggerType} — relay ${resolvedRelayId.slice(0,8)} has no adapter`);
    return { ok: false, reason: 'no_adapter', relayNodeId: resolvedRelayId };
  }

  const startedAt = Date.now();
  _runningScan = (async () => {
    try {
      console.log(`[bettor-scanner] start (trigger=${triggerType}, relay=${resolvedRelayId.slice(0,8)} via ${resolutionSource}, adapter=${adapterUrl})`);
      const fetched = await fetchPredictionData();
      if (!fetched.ok) {
        console.log(`[bettor-scanner] fetch failed: ${fetched.error}`);
        return { ok: false, error: `fetch: ${fetched.error}` };
      }
      const all = fetched.data || [];
      const now = Date.now();
      let eligibleList = all.filter(m => eligible(m, now));
      const beforeCap = eligibleList.length;
      eligibleList.sort((a, b) => (b.volume24h || 0) - (a.volume24h || 0));
      if (eligibleList.length > MAX_SCAN_PER_RUN) eligibleList = eligibleList.slice(0, MAX_SCAN_PER_RUN);
      console.log(`[bettor-scanner] ${all.length} total → ${beforeCap} eligible → ${eligibleList.length} scan (cap ${MAX_SCAN_PER_RUN})`);

      if (eligibleList.length === 0) {
        return { ok: true, scanned: 0, written: 0, elapsed_ms: Date.now() - startedAt };
      }

      // Inventory-aware: snapshot already-open size for this relay, derive available bankroll
      const openSize = getOpenInventory(resolvedRelayId);
      const availableBankroll = Math.max(0, DEFAULT_BANKROLL - openSize);
      console.log(`[bettor-scanner] inventory: open=$${openSize.toFixed(2)} / bankroll $${DEFAULT_BANKROLL} → available $${availableBankroll.toFixed(2)}`);

      // Phase 3e-2 Layer 4 J1 #116: read active confidence threshold + maybe auto-fallback
      maybeAutoFallback(resolvedRelayId);
      const activeConfidenceThreshold = getActiveConfidenceThreshold();
      console.log(`[bettor-scanner] confidence threshold: ${activeConfidenceThreshold} (Layer 4 J1 #116 auto-fallback)`);

      const results = await pMapLimit(eligibleList, LLM_CONCURRENCY, (m) => scanOne(m, adapterUrl, availableBankroll, activeConfidenceThreshold));
      const errors = results.filter(r => r?.error).length;
      const valid = results.filter(r => r && !r.error).length;
      console.log(`[bettor-scanner] LLM done: ${valid} ok, ${errors} errors`);

      const written = persist(results, triggerType, resolvedRelayId);
      const elapsed_ms = Date.now() - startedAt;
      console.log(`[bettor-scanner] wrote top ${written} for relay=${resolvedRelayId?.slice(0,8) || 'none'} (${elapsed_ms} ms)`);
      return { ok: true, scanned: eligibleList.length, valid, errors, written, elapsed_ms, relayNodeId: resolvedRelayId };
    } catch (e) {
      console.log(`[bettor-scanner] FAILED: ${e.message}`);
      return { ok: false, error: e.message };
    } finally {
      _runningScan = null;
    }
  })();
  return _runningScan;
}

export function isScanRunning() {
  return !!_runningScan;
}

// ── cron registration ────────────────────────────────────────────────────

const CRON_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
let _cronTimer = null;

export function startCron() {
  if (_cronTimer) return;
  _cronTimer = setInterval(() => {
    runScan('cron').catch(err => console.log(`[bettor-scanner] cron tick error: ${err.message}`));
  }, CRON_INTERVAL_MS);
  console.log(`[bettor-scanner] cron registered: every ${CRON_INTERVAL_MS / 3600000}h`);
}

export function stopCron() {
  if (_cronTimer) {
    clearInterval(_cronTimer);
    _cronTimer = null;
  }
}
