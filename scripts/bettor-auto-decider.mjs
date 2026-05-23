#!/usr/bin/env node
// Phase 3g Sub 5 (A) — Auto-decision engine: sim auto-approve + per-event_type confidence_band 自动派 + real config-gate.
//
// Bettor r80 architect spec PASS + 3 决断 + 3 加:
//   - process 隔离 (新 script, 5min cron)
//   - v104 bettor_action_decisions audit 独立
//   - confidence_band 自动派 from event_calendar.event_type (final 95 / semi 85 / null 75)
//   - quality check 3 band (high → auto / mid → small delta only / low → keep pending)
//   - real path graceful degrade (B-1 sub 6 前 SKIP)
//   - 一次性 backfill 历史 recommendations.confidence_band (启动时一次)

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const kasiaRequire = createRequire(`${KANET_ROOT}/kasia-console/`);
const Database = kasiaRequire('better-sqlite3');
const DB_PATH = `${KANET_ROOT}/kasia-console/data/console.db`;
const LOG_FILE = `${KANET_ROOT}/logs/bettor-auto-decider.log`;
const CONSOLE_URL = 'http://127.0.0.1:3100';
const TICK_MS = 5 * 60_000;  // 5min

// Sub 5.5 hotfix per r81 surface: EVENT_TYPE_TO_BAND map 删 (0 reference, backfill 用 inline SQL CASE).
// Effective behavior 由 quality check L65+ 完整覆盖 (event_type → confidence_band 间接通过 backfill).

const MID_DELTA_THRESHOLD = 0.30;  // 30% size delta cap for 'mid' band auto-approve

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) {
  const line = `[${ts()}] ${msg}`;
  process.stdout.write(line + '\n');
  try { writeFileSync(LOG_FILE, line + '\n', { flag: 'a' }); } catch {}
}

// ── one-time backfill historical confidence_band (启动时一次) ───────────────────

function backfillConfidenceBand(db) {
  // For recommendations 老 row (Phase 3f-1 前) 的 confidence_band IS NULL, 自动派 by event_type.
  // 不动 scanner (production code), 留 A-2 / Phase 3h 改写入路径.
  const stmt = db.prepare(`
    UPDATE bettor_recommendations
    SET calibrator_confidence = COALESCE(
      calibrator_confidence,
      CASE
        WHEN EXISTS (SELECT 1 FROM event_calendar ec WHERE ec.market_id = bettor_recommendations.market_id AND ec.event_type = 'final') THEN 'low'
        WHEN EXISTS (SELECT 1 FROM event_calendar ec WHERE ec.market_id = bettor_recommendations.market_id) THEN 'mid'
        ELSE 'mid'
      END
    )
    WHERE calibrator_confidence IS NULL
  `);
  const r = stmt.run();
  if (r.changes > 0) log(`backfill historical confidence_band: ${r.changes} rows updated`);
}

// ── Phase 3g Sub 9.12 — adj target size + side derivation ──────────────────────
// Bettor r95 root cause: `adj.target_size` / `adj.real_size_usd` column 不存在 in
// `bettor_adjustments` schema. 真值在 `trigger_reason` 字符串 (e.g. "target $244.32 > current $25.43 + $5").
// Sub 9.12 grep verify confirm + Bettor r96 PASS green-light + J1 #169 design.
function parseTargetFromTriggerReason(reason) {
  const m = (reason || '').match(/target\s+\$([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

function deriveRealSize(adj) {
  const currentSize = Number(adj.current_size || 0);
  if (adj.adj_type === 'CLOSE_ALL' || adj.severity === 'critical') {
    return { size: currentSize, side: 'SELL' };
  }
  const target = parseTargetFromTriggerReason(adj.trigger_reason);
  if (adj.adj_type === 'REDUCE') {
    return { size: Math.max(0, currentSize - target), side: 'SELL' };
  }
  if (adj.adj_type === 'ADD') {
    return { size: Math.max(0, target - currentSize), side: 'BUY' };
  }
  return { size: 0, side: 'BUY' };
}

// ── quality check (r80 architect 加 2) ─────────────────────────────────────────

// Sub 9.8 per Bettor r89 真问题 1+2: open new path quality (existing 只 cover adj size delta).
// Owner 5/13 19:11 "应该没有限制了" → flip 前 quality check 必 cover open new (0 → cap) 路径.
function autoApproveQuality(adj, currentSize) {
  // band = adj.calibrator_confidence (JOIN recommendation), severity = adj.severity
  if (adj.severity === 'critical') {
    return { auto: true, reason: 'critical severity → auto-approve' };
  }
  const band = adj.calibrator_confidence || 'mid';
  const isOpenNew = (currentSize === 0 || currentSize == null);
  if (band === 'high') {
    return { auto: true, reason: 'high confidence → auto-approve' };
  }
  if (band === 'mid') {
    if (isOpenNew) {
      // Sub 9.8: mid band open new — require strong LLM signal (p_mid extreme ≤ 0.10 OR ≥ 0.90)
      const pMid = Number(adj.p_mid || 0.5);
      if (pMid <= 0.10 || pMid >= 0.90) {
        return { auto: true, reason: `mid + open new + p_mid ${pMid.toFixed(3)} 极值 (LLM strong signal)` };
      }
      return { auto: false, reason: `mid + open new + p_mid ${pMid.toFixed(3)} not 极值 — keep pending` };
    }
    // Sub 9.12: existing position delta — parse target from trigger_reason (target_size column 不存在)
    const target = parseTargetFromTriggerReason(adj.trigger_reason);
    const delta = currentSize > 0 ? Math.abs(target - currentSize) / currentSize : 0;
    if (delta < MID_DELTA_THRESHOLD) return { auto: true, reason: `mid + delta ${(delta * 100).toFixed(1)}% < 30%` };
    return { auto: false, reason: `mid + delta ${(delta * 100).toFixed(1)}% ≥ 30% — keep pending` };
  }
  // band === 'low' → keep pending (高 gap 高不确定, open new 也不 auto)
  return { auto: false, reason: 'low confidence (gap > 30pp) — keep pending for Owner review' };
}

// ── Phase 3g Sub 6 (B-1) — Real-money bridge: Sophie SDK auto-order + 6 安全网 + idempotency ──
//
// Bettor r78 + r81 architect spec PASS. 6 gate check (顺序固定):
//   1. kill_switch_enabled = 0 (else hard stop)
//   2. enabled = 1 (else SKIP, default OFF)
//   3. size <= max_real_size_usd (else cap to max)
//   4. daily_used + size <= daily_cap_usd
//   5. weekly_used + size <= weekly_cap_usd
//   6. market_used + size <= max_real_size_per_market_usd
//
// architect 加: cross-host retry 3x backoff + fallthrough sim + idempotency key
// (bettor_real_positions pre-INSERT before order POST).
//
// Sophie wallet 在 J1 host. Bettor host decider → POST cross-LAN J1:3100/api/predictions/order.

const SOPHIE_HOST = process.env.SOPHIE_HOST || '127.0.0.1';  // J1 host = self, Bettor host override LAN IP
const RETRY_BACKOFFS_MS = [500, 2000, 5000];

// Sub 9.10 per Bettor r90 CRITICAL push back: ORDER BY created_at ASC 选 Trader-A (broker
// line) 不是 Bettor wallet. 修: kanet.env explicit BETTOR_RELAY_NODE_ID 双 host 各自配.
// Priority:
//   1. BETTOR_RELAY_NODE_ID env (kanet.env 显式 host config) — 推荐
//   2. REAL_RELAY env (overrides 1, force specific for testing)
//   3. agent_wallets WHERE label LIKE '%Polymarket%' AND label NOT LIKE '%Trader%' (label-based filter)
//   4. fallback Sophie (J1 host default)
function resolveRealRelay(db) {
  // Priority 2: REAL_RELAY (highest, testing/force override)
  if (process.env.REAL_RELAY) return process.env.REAL_RELAY;
  // Priority 1: BETTOR_RELAY_NODE_ID (kanet.env host config)
  if (process.env.BETTOR_RELAY_NODE_ID) return process.env.BETTOR_RELAY_NODE_ID;
  // Priority 3: label-based filter (exclude Trader-* broker line wallets)
  try {
    const r = db.prepare(`
      SELECT relay_node_id FROM agent_wallets
      WHERE chain = 'polygon' AND is_default = 1
        AND (label LIKE '%Polymarket%' OR label LIKE '%polymarket%')
        AND label NOT LIKE '%Trader%' AND label NOT LIKE '%trader%'
      ORDER BY created_at DESC LIMIT 1
    `).get();
    if (r?.relay_node_id) return r.relay_node_id;
  } catch (e) { log(`resolveRealRelay query err: ${e.message?.slice(0, 60)}`); }
  // Priority 4: fallback Sophie (J1 host default backward compat)
  return 'a83c4b07-eaf7-4d21-972a-1265e0cdcfcf';
}

// Sub 6.5 hotfix per r82 CRITICAL 2: token_id lookup chain.
// market_id → condition_id (stored in bettor_recommendations) → Polymarket CLOB
// /markets/<conditionId> → tokens[0]=yes_token / tokens[1]=no_token.
// Cache 30min in-memory (减少 Polymarket API call rate).
const TOKEN_CACHE = new Map();
const TOKEN_CACHE_TTL_MS = 30 * 60_000;

async function lookupTokenIds(conditionId) {
  if (!conditionId) throw new Error('lookupTokenIds: condition_id required');
  const cached = TOKEN_CACHE.get(conditionId);
  if (cached && Date.now() - cached.cachedAt < TOKEN_CACHE_TTL_MS) return cached.ids;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const r = await fetch(`https://clob.polymarket.com/markets/${conditionId}`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`Polymarket /markets/${conditionId.slice(0, 12)} HTTP ${r.status}`);
    const m = await r.json();
    const ids = {
      yesTokenId: m.tokens?.[0]?.token_id || m.tokens?.find(t => /yes/i.test(t.outcome))?.token_id,
      noTokenId:  m.tokens?.[1]?.token_id || m.tokens?.find(t => /no/i.test(t.outcome))?.token_id,
    };
    if (!ids.yesTokenId || !ids.noTokenId) throw new Error(`token_id missing in market response: ${JSON.stringify(m.tokens).slice(0, 100)}`);
    TOKEN_CACHE.set(conditionId, { ids, cachedAt: Date.now() });
    return ids;
  } finally { clearTimeout(t); }
}

// daily/weekly reset cron (嵌入 tick, 5min check)
function maybeResetCounters(db) {
  const cfg = db.prepare('SELECT * FROM bettor_real_config WHERE id = 1').get();
  if (!cfg) return;
  const nowMs = Date.now();
  const dailyResetMs = cfg.daily_reset_at ? new Date(cfg.daily_reset_at).getTime() : 0;
  const weeklyResetMs = cfg.weekly_reset_at ? new Date(cfg.weekly_reset_at).getTime() : 0;
  if (nowMs - dailyResetMs >= 24 * 60 * 60_000) {
    db.prepare(`UPDATE bettor_real_config SET daily_used_usd = 0, daily_reset_at = datetime('now'), updated_at = datetime('now') WHERE id = 1`).run();
    log(`reset daily_used_usd → 0 (last reset ${cfg.daily_reset_at || 'never'})`);
  }
  if (nowMs - weeklyResetMs >= 7 * 24 * 60 * 60_000) {
    db.prepare(`UPDATE bettor_real_config SET weekly_used_usd = 0, weekly_reset_at = datetime('now'), updated_at = datetime('now') WHERE id = 1`).run();
    log(`reset weekly_used_usd → 0 (last reset ${cfg.weekly_reset_at || 'never'})`);
  }
}

// 6-gate check + size cap. Returns { ok, size, reason }.
function preBetGateCheck(db, adj, requestedSize) {
  const cfg = db.prepare('SELECT * FROM bettor_real_config WHERE id = 1').get();
  if (!cfg) return { ok: false, size: 0, reason: 'config row missing' };
  if (cfg.kill_switch_enabled) return { ok: false, size: 0, reason: 'kill_switch_enabled=1 hard stop' };
  if (!cfg.enabled) return { ok: false, size: 0, reason: 'enabled=0 (Owner not flipped)' };
  let size = Math.min(requestedSize, cfg.max_real_size_usd);  // gate 3: cap to max
  if ((cfg.daily_used_usd || 0) + size > cfg.daily_cap_usd) return { ok: false, size: 0, reason: `daily cap ${cfg.daily_used_usd}+${size}>${cfg.daily_cap_usd}` };
  if ((cfg.weekly_used_usd || 0) + size > cfg.weekly_cap_usd) return { ok: false, size: 0, reason: `weekly cap ${cfg.weekly_used_usd}+${size}>${cfg.weekly_cap_usd}` };
  const marketUsed = db.prepare(`SELECT COALESCE(SUM(size_usd), 0) AS u FROM bettor_real_positions WHERE market_id = ? AND status IN ('filled', 'pending')`).get(adj.market_id || '');
  if ((marketUsed?.u || 0) + size > cfg.max_real_size_per_market_usd) return { ok: false, size: 0, reason: `market cap ${marketUsed.u}+${size}>${cfg.max_real_size_per_market_usd}` };
  return { ok: true, size, reason: '6-gate pass' };
}

// Sophie SDK order via Console HTTP API (cross-host or self). Returns { ok, txId, error }.
async function postSophieOrder(payload) {
  for (let i = 0; i < RETRY_BACKOFFS_MS.length; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15_000);
      const res = await fetch(`http://${SOPHIE_HOST}:3100/api/predictions/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok !== false) return { ok: true, txId: j.txHash || j.txId || null, raw: j };
      if (i < RETRY_BACKOFFS_MS.length - 1) await new Promise(r => setTimeout(r, RETRY_BACKOFFS_MS[i]));
    } catch (e) {
      if (i < RETRY_BACKOFFS_MS.length - 1) await new Promise(r => setTimeout(r, RETRY_BACKOFFS_MS[i]));
    }
  }
  return { ok: false, error: `Sophie SDK order failed after ${RETRY_BACKOFFS_MS.length} retries` };
}

async function decideRealPath(db, adj) {
  // Idempotency: check existing real_position for this adjustment / recommendation
  const existing = db.prepare(`SELECT id, status FROM bettor_real_positions WHERE adjustment_id = ? OR (recommendation_id = ? AND adjustment_id IS NULL) LIMIT 1`).get(adj.id, adj.recommendation_id);
  if (existing && existing.status !== 'failed') {
    return { action: 'skip', reason: `idempotent: existing real_position ${existing.id} status=${existing.status}` };
  }

  // Sub 9.12: target_size column 不存在, derive size + side from adj_type + trigger_reason + current_size
  const { size: derivedSize, side: derivedSide } = deriveRealSize(adj);
  let requestedSize = derivedSize;
  if (!requestedSize || requestedSize < 1) {
    return { action: 'skip', reason: `size ${requestedSize.toFixed(2)} invalid (adj_type=${adj.adj_type} current=${(adj.current_size||0).toFixed(2)} trigger="${(adj.trigger_reason||'').slice(0,40)}")` };
  }

  // Sub 8 E-1 (降级实施 per r83): LLM stability check via estimator sigma proxy.
  // Phase 4 sediment: 真 N-sample median + cross-host quorum 留 KANet broker 协议成熟.
  // 现 estimator.sigma 已 single-call variance estimate (0..1 scale), 直接当 stability proxy:
  //   sigma > LLM_VARIANCE_SKIP (0.20) → SKIP real (LLM 完全不确定 fall through sim)
  //   sigma > LLM_VARIANCE_HALF (0.10) → size × 0.5 (high noise, halve)
  //   sigma ≤ 0.10 → full size
  const LLM_VARIANCE_SKIP = 0.20;
  const LLM_VARIANCE_HALF = 0.10;
  const adjSigma = Number(db.prepare('SELECT sigma FROM bettor_recommendations WHERE id = ?').get(adj.recommendation_id)?.sigma || 0.05);
  if (adjSigma > LLM_VARIANCE_SKIP) {
    return { action: 'skip', reason: `E-1 LLM variance sigma=${adjSigma.toFixed(3)} > ${LLM_VARIANCE_SKIP} (fall through sim)` };
  }
  if (adjSigma > LLM_VARIANCE_HALF) {
    requestedSize = requestedSize * 0.5;
    log(`E-1 high variance sigma=${adjSigma.toFixed(3)} > ${LLM_VARIANCE_HALF} → size × 0.5 = $${requestedSize.toFixed(2)}`);
  }

  const gate = preBetGateCheck(db, adj, requestedSize);
  if (!gate.ok) return { action: 'skip', reason: gate.reason };

  // Get current market price. Stub use entry_yes_price if snapshot missing.
  const yesPrice = Number(adj.current_yes_price || adj.entry_yes_price || 0.5);
  // Sub 9.12: tokenSide derived from adj_type (open new/ADD → BUY, REDUCE/CLOSE_ALL → SELL).
  // Sub 6.5 注释 "SELL 只在 close 路径" misleading — CLOSE_ALL/REDUCE 就是 close 路径, 必 SELL.
  const tokenSide = derivedSide;
  const tokenPrice = adj.direction === 'NO' ? (1 - yesPrice) : yesPrice;

  // Sub 6.5 hotfix per r82 CRITICAL 2: token_id lookup from recommendation.condition_id
  // 否则 Polymarket API 必 fail 400. condition_id stored in bettor_recommendations
  // (scanner persist 已 verify).
  const rec = db.prepare('SELECT condition_id FROM bettor_recommendations WHERE id = ?').get(adj.recommendation_id);
  if (!rec?.condition_id) {
    return { action: 'skip', reason: `recommendation missing condition_id (rec_id=${adj.recommendation_id?.slice(0, 8)})` };
  }
  let tokenIds;
  try { tokenIds = await lookupTokenIds(rec.condition_id); }
  catch (e) { return { action: 'skip', reason: `lookupTokenIds fail: ${e.message?.slice(0, 80)}` }; }
  const tokenId = adj.direction === 'NO' ? tokenIds.noTokenId : tokenIds.yesTokenId;
  const shares = gate.size / tokenPrice;

  // Sub 9.9: resolve per-host wallet relay (auto-detect from agent_wallets OR REAL_RELAY env)
  const realRelay = resolveRealRelay(db);

  // INSERT placeholder bettor_real_positions BEFORE order (idempotency anchor)
  const realPosResult = db.prepare(`
    INSERT INTO bettor_real_positions (adjustment_id, recommendation_id, market_id, relay_node_id, direction, entry_yes_price, size_usd, shares, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `).run(adj.id, adj.recommendation_id, adj.market_id || '', realRelay, adj.direction, yesPrice, gate.size, shares);
  const realPosId = realPosResult.lastInsertRowid;

  // Polymarket SDK POST via local Console (with retry)
  const orderResult = await postSophieOrder({
    relay_node_id: realRelay,
    tokenId,
    side: tokenSide,
    price: tokenPrice,
    size: shares,
  });

  if (orderResult.ok) {
    db.prepare(`UPDATE bettor_real_positions SET status = 'filled', tx_hash = ? WHERE id = ?`).run(orderResult.txId, realPosId);
    db.prepare(`UPDATE bettor_real_config SET daily_used_usd = daily_used_usd + ?, weekly_used_usd = weekly_used_usd + ?, updated_at = datetime('now') WHERE id = 1`).run(gate.size, gate.size);
    log(`🎯 [real] FILLED adj=${adj.id?.slice(0, 8)} size=$${gate.size.toFixed(2)} tx=${orderResult.txId?.slice(0, 12) || '?'}`);
    return { action: 'fill', size: gate.size, txId: orderResult.txId };
  }
  // Failed
  db.prepare(`UPDATE bettor_real_positions SET status = 'failed', error_msg = ? WHERE id = ?`).run(orderResult.error || 'unknown', realPosId);
  log(`❌ [real] FAIL adj=${adj.id?.slice(0, 8)}: ${orderResult.error}`);
  return { action: 'fail', reason: orderResult.error };
}

// ── auto-decide pending adjustments ─────────────────────────────────────────────

async function decideAdjustments(db) {
  const pending = db.prepare(`
    SELECT a.id, a.position_id, a.recommendation_id, a.adj_type, a.severity, a.trigger_reason,
           p.size_usd AS current_size, p.direction, p.entry_yes_price,
           r.calibrator_confidence, r.market_id, r.p_mid, r.sigma,
           s.current_yes_price
    FROM bettor_adjustments a
    JOIN bettor_sim_positions p ON p.id = a.position_id
    JOIN bettor_recommendations r ON r.id = a.recommendation_id
    LEFT JOIN bettor_sim_snapshots s ON s.id = (SELECT id FROM bettor_sim_snapshots WHERE position_id = p.id ORDER BY snapshot_at DESC LIMIT 1)
    WHERE a.status = 'pending'
    ORDER BY a.created_at ASC
    LIMIT 50
  `).all();
  if (pending.length === 0) return { sim: 0, real: 0 };

  let simApproved = 0, simSkipped = 0, realSkipped = 0;

  for (const adj of pending) {
    // sim decision
    const sim = autoApproveQuality(adj, adj.current_size);
    if (sim.auto) {
      try {
        const res = await fetch(`${CONSOLE_URL}/api/bettor/adjustments/${adj.id}/decide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approve', decided_by: 'bettor-auto-decider' }),
        });
        if (res.ok) {
          simApproved++;
          db.prepare(`INSERT OR IGNORE INTO bettor_action_decisions (decided_for_type, decided_for_id, action, reason, mode, confidence_band) VALUES (?, ?, ?, ?, ?, ?)`)
            .run('adjustment', adj.id, 'approve', sim.reason, 'sim', adj.calibrator_confidence);
        } else { log(`sim approve HTTP ${res.status} for ${adj.id.slice(0, 8)}`); }
      } catch (e) { log(`sim approve ERR ${adj.id.slice(0, 8)}: ${e.message?.slice(0, 60)}`); }
    } else {
      simSkipped++;
      db.prepare(`INSERT OR IGNORE INTO bettor_action_decisions (decided_for_type, decided_for_id, action, reason, mode, confidence_band) VALUES (?, ?, ?, ?, ?, ?)`)
        .run('adjustment', adj.id, 'skip', sim.reason, 'sim', adj.calibrator_confidence);
    }

    // real decision (B-1 Sub 6 完整逻辑 + idempotency + 6-gate + Sophie SDK retry)
    const real = await decideRealPath(db, adj);
    if (real.action === 'skip') {
      realSkipped++;
      if (realSkipped <= 3) log(`[real] SKIP ${adj.id?.slice(0, 8)}: ${real.reason}`);
      db.prepare(`INSERT OR IGNORE INTO bettor_action_decisions (decided_for_type, decided_for_id, action, reason, mode, confidence_band) VALUES (?, ?, ?, ?, ?, ?)`)
        .run('adjustment', adj.id, 'skip', real.reason, 'real', adj.calibrator_confidence);
    } else if (real.action === 'fill') {
      db.prepare(`INSERT OR IGNORE INTO bettor_action_decisions (decided_for_type, decided_for_id, action, reason, mode, confidence_band) VALUES (?, ?, ?, ?, ?, ?)`)
        .run('adjustment', adj.id, 'fill', `size=$${real.size?.toFixed(2)} tx=${real.txId?.slice(0,12)}`, 'real', adj.calibrator_confidence);
    } else if (real.action === 'fail') {
      db.prepare(`INSERT OR IGNORE INTO bettor_action_decisions (decided_for_type, decided_for_id, action, reason, mode, confidence_band) VALUES (?, ?, ?, ?, ?, ?)`)
        .run('adjustment', adj.id, 'fail', real.reason, 'real', adj.calibrator_confidence);
    }
  }

  log(`tick decisions: sim approved=${simApproved} skipped=${simSkipped} | real skipped=${realSkipped}/${pending.length}`);
  return { sim: simApproved, real: 0 };
}

// ── main loop ───────────────────────────────────────────────────────────────────

async function tick() {
  const db = new Database(DB_PATH);
  try {
    maybeResetCounters(db);  // B-1 daily/weekly reset cron embedded
    await decideAdjustments(db);
  } catch (e) { log(`tick ERR: ${e.message?.slice(0, 80)}`); }
  finally { db.close(); }
}

// Startup: one-time backfill + first tick
const startupDb = new Database(DB_PATH);
try { backfillConfidenceBand(startupDb); } finally { startupDb.close(); }
log(`Phase 3g A bettor-auto-decider starting · cron ${TICK_MS / 60_000}min · sim auto / real B-1 graceful degrade`);
await tick();
setInterval(async () => { try { await tick(); } catch (e) { log(`outer tick err: ${e.message?.slice(0, 80)}`); } }, TICK_MS);
