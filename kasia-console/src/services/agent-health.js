/**
 * Agent Health Monitor — per-agent health assessment.
 *
 * Data sources (all read-only, no new tables):
 *   - relay-manager.js  → relay process alive?
 *   - adapter-launcher.js → adapter process alive?
 *   - events table → activity recency, error rate, dedup/hallucination blocks
 *   - chain_events table → payment failures
 *   - reflections.json → last reflection time
 *
 * Traffic light:
 *   GREEN  — all systems go
 *   YELLOW — some indicators degraded
 *   RED    — process down or critical anomaly
 *
 * Short-circuit: relay down → immediate RED, skip all other checks.
 * Cache: 30s TTL to avoid DB pressure from polling.
 */

import { sqlite } from '../db/client.js';
import { getStatus as getRelayStatus } from './relay-manager.js';
import { getAllAdapterStatus } from './adapter-launcher.js';
import { existsSync, readFileSync } from 'node:fs';

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';

// ── Cache ──────────────────────────────────────────────────────────────
let _cache = { data: null, at: 0 };
const CACHE_TTL = 30_000;

// ─��� Thresholds ─────────────────────────────────────────────────────────
const T = {
  // Last event age (ms)
  eventYellow: 30 * 60_000,   // 30 min
  eventRed:    2 * 3600_000,  // 2 hours

  // Error/block counts in 2h window
  errorYellow: 3,
  errorRed:    10,
  blockYellow: 3,
  blockRed:    10,

  // Payment failures in 24h
  payFailYellow: 1,
  payFailRed:    3,
};

// ── Prepared statements (lazy init) ────────────────────────────────────
let _stmts = null;
function stmts() {
  if (_stmts) return _stmts;
  _stmts = {
    lastEvent: sqlite.prepare(
      `SELECT MAX(created_at) as ts FROM events WHERE agent_address = ?`
    ),
    lastProactive: sqlite.prepare(
      `SELECT MAX(created_at) as ts FROM events
       WHERE agent_address = ? AND event_type IN ('proactive_event','proactive_cycle','proactive_startup')`
    ),
    errorCount2h: sqlite.prepare(
      `SELECT COUNT(*) as cnt FROM events
       WHERE agent_address = ? AND level = 'error'
       AND created_at > datetime('now', '-2 hours')`
    ),
    blockCount2h: sqlite.prepare(
      `SELECT COUNT(*) as cnt FROM events
       WHERE agent_address = ? AND event_type = 'reactive_silent'
       AND (summary LIKE '%dedup%' OR summary LIKE '%hallucination%')
       AND created_at > datetime('now', '-2 hours')`
    ),
    payFail24h: sqlite.prepare(
      `SELECT COUNT(*) as cnt FROM chain_events
       WHERE (from_address = ? OR to_address = ?)
       AND event_type LIKE '%fail%'
       AND observed_at > datetime('now', '-24 hours')`
    ),
    silentCount2h: sqlite.prepare(
      `SELECT COUNT(*) as cnt FROM events
       WHERE agent_address = ? AND event_type = 'reactive_silent'
       AND created_at > datetime('now', '-2 hours')`
    ),
    activeCount2h: sqlite.prepare(
      `SELECT COUNT(*) as cnt FROM events
       WHERE agent_address = ? AND created_at > datetime('now', '-2 hours')`
    ),
  };
  return _stmts;
}

// ── Core: single agent health ──────────────────────────────────────────

function computeOne(relay, relayStatuses, adapterStatuses) {
  const { id: relayNodeId, name, address, adapter_node_id, proactive_interval_minutes, evolution_interval_hours } = relay;

  // ── Short-circuit: Relay down → RED ──
  const relayRunning = relayStatuses.some(rs => rs.relayNodeId === relayNodeId);
  if (!relayRunning) {
    return {
      name,
      address,
      status: 'red',
      reason: 'relay_down',
      indicators: null,
    };
  }

  // ── Adapter check ──
  const adapterInfo = adapterStatuses[adapter_node_id];
  const adapterRunning = adapterInfo?.running ?? false;

  // ── DB queries ──
  const s = stmts();
  const now = Date.now();

  const lastEventTs = s.lastEvent.get(address)?.ts;
  const lastProTs   = s.lastProactive.get(address)?.ts;
  const errorCnt    = s.errorCount2h.get(address)?.cnt || 0;
  const blockCnt    = s.blockCount2h.get(address)?.cnt || 0;
  const payFailCnt  = s.payFail24h.get(address, address)?.cnt || 0;
  const silentCnt   = s.silentCount2h.get(address)?.cnt || 0;
  const activeCnt   = s.activeCount2h.get(address)?.cnt || 0;

  // ── Reflection time from file ──
  // Use lastReflectionTime (epoch ms) — most reliable, updated by both
  // addReflection() and runReflectionCycle() regardless of JSON parse success.
  let lastReflectionTs = null;
  try {
    const agentDir = name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const reflPath = `${KANET_ROOT}/agent-mind/minds/${agentDir}/reflections.json`;
    if (existsSync(reflPath)) {
      const data = JSON.parse(readFileSync(reflPath, 'utf8'));
      if (data.lastReflectionTime) {
        lastReflectionTs = new Date(data.lastReflectionTime).toISOString();
      } else {
        // Fallback: scan reflections array for newest timestamp
        const refls = data.reflections || [];
        const timestamps = refls.map(r => r.timestamp || r.created_at).filter(Boolean).map(t => new Date(t).getTime());
        if (timestamps.length > 0) lastReflectionTs = new Date(Math.max(...timestamps)).toISOString();
      }
    }
  } catch {}

  // ── Traffic light per indicator ──
  const proIntervalMs = (proactive_interval_minutes || 60) * 60_000;
  const reflIntervalMs = (evolution_interval_hours || 24) * 3600_000;

  const indicators = {
    adapter:    adapterRunning ? 'green' : 'red',
    lastEvent:  _ageLight(lastEventTs, now, T.eventYellow, T.eventRed),
    proactive:  _intervalLight(lastProTs, now, proIntervalMs),
    reflection: _intervalLight(lastReflectionTs, now, reflIntervalMs),
    errors:     _countLight(errorCnt, T.errorYellow, T.errorRed),
    blocks:     _countLight(blockCnt, T.blockYellow, T.blockRed),
    payFails:   _countLight(payFailCnt, T.payFailYellow, T.payFailRed),
  };

  // ── Overall status ──
  const vals = Object.values(indicators);
  const overall = vals.includes('red') ? 'red' : vals.includes('yellow') ? 'yellow' : 'green';

  // ── Pick reason for non-green ──
  let reason = null;
  if (overall !== 'green') {
    const first = Object.entries(indicators).find(([, v]) => v === overall);
    reason = first ? first[0] : null;
  }

  return {
    name,
    address,
    status: overall,
    reason,
    indicators,
    stats: {
      lastEvent: lastEventTs || null,
      lastProactive: lastProTs || null,
      lastReflection: lastReflectionTs || null,
      errors2h: errorCnt,
      blocks2h: blockCnt,
      payFails24h: payFailCnt,
      silent2h: silentCnt,
      active2h: activeCnt,
    },
  };
}

// ── Public API ──────────────────────────────────────────────────────────

export async function computeAllHealth() {
  if (Date.now() - _cache.at < CACHE_TTL) return _cache.data;

  const relays = sqlite.prepare(
    `SELECT r.id, r.name, r.address, r.adapter_node_id,
            r.proactive_interval_minutes, r.evolution_interval_hours
     FROM relay_nodes r
     WHERE r.address IS NOT NULL`
  ).all();

  const relayStatuses = getRelayStatus();
  const adapterStatuses = getAllAdapterStatus();

  const agents = relays.map(r => computeOne(r, relayStatuses, adapterStatuses));

  const result = {
    ts: new Date().toISOString(),
    agents,
    summary: {
      total: agents.length,
      green: agents.filter(a => a.status === 'green').length,
      yellow: agents.filter(a => a.status === 'yellow').length,
      red: agents.filter(a => a.status === 'red').length,
    },
  };

  _cache = { data: result, at: Date.now() };
  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function _ageLight(ts, now, yellowMs, redMs) {
  if (!ts) return 'red';
  const age = now - new Date(ts).getTime();
  if (age > redMs) return 'red';
  if (age > yellowMs) return 'yellow';
  return 'green';
}

function _intervalLight(ts, now, intervalMs) {
  if (!ts) return 'yellow'; // never ran — not critical, but notable
  const age = now - new Date(ts).getTime();
  if (age > intervalMs * 4) return 'red';
  if (age > intervalMs * 2) return 'yellow';
  return 'green';
}

function _countLight(cnt, yellowThreshold, redThreshold) {
  if (cnt >= redThreshold) return 'red';
  if (cnt >= yellowThreshold) return 'yellow';
  return 'green';
}
