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
const SCAN_TIMEOUT_PER_MARKET_MS = 180_000; // 3 min hard cap per market

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

// ── adapter URL lookup per Agent ─────────────────────────────────────────

function getAdapterUrlForAgent(relayNodeId) {
  if (!relayNodeId) return null;
  const row = sqlite.prepare(`
    SELECT a.http_port FROM relay_nodes r
    JOIN adapter_nodes a ON a.id = r.adapter_node_id
    WHERE r.id = ?
  `).get(relayNodeId);
  return row?.http_port ? `http://127.0.0.1:${row.http_port}` : null;
}

// ── single-market scan ───────────────────────────────────────────────────

async function scanOne(market, adapterUrl) {
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

  const rec = _recommendBet({
    pMid: est.pMid,
    sigma: est.sigma,
    yesPrice,
    bankroll: DEFAULT_BANKROLL,
    infoGapMonths,
    kellyFraction: KELLY_FRACTION,
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
  const valid = results
    .filter(r => r && !r.error && r.rec && r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

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
       entry_yes_price, entry_buy_price, size_usd, shares, opened_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      stmtPos.run(
        randomUUID(), recId, relayNodeId, dir,
        yesPrice, entryBuy, dir === 'SKIP' ? 0 : r.rec.size, shares,
        now
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

      const results = await pMapLimit(eligibleList, LLM_CONCURRENCY, (m) => scanOne(m, adapterUrl));
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
