// oracle-voter-health-monitor.js — KANet-UI (Bettor r989/r997 + NWT durability hard-req, Q2 fix).
//
// WHY: Q2 root cause was an *oracle-voting liveness* gap that stayed SILENT for days — the voter
// cron (bettor-prediction-voter.js) kept running (process-alive) but produced 0 pool votes, so
// committees never reached the 4-of-5 quorum and ~60% of real-bet markets refunded instead of
// settling. process-alive monitoring (supervisor / relay-health-monitor) could not catch this:
// the process was fine, the *output* was zero. The lesson (NWT): a producing-health check —
// "verifying markets are owed votes by a LOCAL committee oracle, but none are being cast" — is the
// signal that would have caught Q2 on day one.
//
// WHAT IT IS / IS NOT:
//   - DETECT + SURFACE: it flags stuck owed-votes (WARN log + an `events` row, level=warn → Brain/UI
//     visible) so the stall is never silent again. This is the durability win.
//   - It does NOT restart things blindly: a 0-vote stall is usually a deriveVote/routing *code* bug
//     (Q2 sub-(b)/②), which a restart cannot fix — claiming "auto-heal" there would be dishonest.
//     Relay-death (a heal-able cause) is already auto-restarted by relay-health-monitor.js; this
//     monitor stays in its lane (the producing gap) and escalates by making it loud + auditable.
//
// OBLIGATION SIGNAL (mirrors processPoolMarket in bettor-prediction-voter.js L303-348 exactly, so
// "owed" here == "the voter should have voted"): a pool_markets row with protocol_status='verifying'
// AND deadline<=now AND oracle_relay_ids (committee, by ADDRESS) includes a LOCAL is_oracle voter's
// address, with NO pool_oracle_vote chain_event from that address, and not consensual-skipped.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';

const TICK_INTERVAL_MS = Number(process.env.ORACLE_VOTER_HEALTH_TICK_MS) || 120_000;   // 2min (= ~2 voter ticks)
const STARTUP_GRACE_MS = 120_000;   // let the voter cron run a couple ticks before judging
// A market is owed the moment its deadline passes; the voter should cast within a tick or two
// (deriveVote fetch+LLM ~10-30s). Past this grace with no vote = a real producing stall, not load.
const STALE_THRESHOLD_MS = Number(process.env.ORACLE_VOTER_HEALTH_STALE_MS) || 600_000;   // 10min

let timer = null;
let running = false;
// (market_id|voter_address) → first epoch we observed it owed. Lets us measure how long a vote has
// been stuck so we alert on *persistence*, not a single transient tick.
const _owedSince = new Map();
// market_id|voter_address already alerted this stall-episode → don't re-emit an events row every tick.
const _alerted = new Set();
let _lastHealth = { ok: true, checkedAt: null, localOracles: 0, owed: 0, stuck: 0, stuckMarkets: [] };

export function getVoterHealth() { return _lastHealth; }

function _localOracleVoters() {
  return sqlite.prepare(`SELECT id, name, address FROM relay_nodes WHERE is_oracle = 1 AND address IS NOT NULL`).all();
}

// Owed = verifying + past deadline + this voter's address in committee + not yet voted + not consensual-skip.
function _owedMarketsForVoter(voter, nowSec) {
  const cand = sqlite.prepare(`
    SELECT id, deadline, oracle_relay_ids FROM pool_markets
    WHERE oracle_relay_ids LIKE ? AND protocol_status = 'verifying' AND deadline <= ?
  `).all(`%"${voter.address}"%`, nowSec);
  const owed = [];
  for (const m of cand) {
    // Defense-in-depth: LIKE can prefix-collide → re-parse to confirm true committee membership.
    let ids; try { ids = JSON.parse(m.oracle_relay_ids || '[]'); } catch { ids = []; }
    if (!Array.isArray(ids) || !ids.includes(voter.address)) continue;
    // Already voted this market → not owed.
    const voted = sqlite.prepare(`
      SELECT 1 FROM chain_events WHERE event_type='pool_oracle_vote' AND from_address=? AND payload LIKE ? LIMIT 1
    `).get(voter.address, `%"market_id":"${m.id}"%`);
    if (voted) continue;
    // Consensual settle dispatched → legitimately skipped, not a stall (mirrors voter L331).
    const consensual = sqlite.prepare(`
      SELECT 1 FROM chain_events WHERE event_type='pool_settle_consensual_dispatched' AND payload LIKE ? LIMIT 1
    `).get(`%"market_id":"${m.id}"%`);
    if (consensual) continue;
    owed.push(m.id);
  }
  return owed;
}

export async function oracleVoterHealthTick() {
  if (running) return { skipped: true };
  running = true;
  try {
    const voters = _localOracleVoters();
    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const liveKeys = new Set();
    let owedTotal = 0;
    const stuckMarkets = [];

    for (const voter of voters) {
      const owed = _owedMarketsForVoter(voter, nowSec);
      owedTotal += owed.length;
      for (const marketId of owed) {
        const key = `${marketId}|${voter.address}`;
        liveKeys.add(key);
        if (!_owedSince.has(key)) _owedSince.set(key, nowMs);
        const owedForMs = nowMs - _owedSince.get(key);
        if (owedForMs >= STALE_THRESHOLD_MS) {
          stuckMarkets.push({ market_id: marketId, voter: voter.name, voter_address: voter.address, owed_for_min: Math.round(owedForMs / 60000) });
        }
      }
    }

    // GC: a key no longer owed (voted / settled / deadline-window changed) → clear its timer + alert flag.
    for (const key of [..._owedSince.keys()]) if (!liveKeys.has(key)) { _owedSince.delete(key); _alerted.delete(key); }

    if (stuckMarkets.length > 0) {
      // Loud log (authoritative, like relay-health) — the anti-silence core.
      console.warn(`[oracle-voter-health] STALL: ${stuckMarkets.length} owed vote(s) unfilled > ${Math.round(STALE_THRESHOLD_MS/60000)}min — ` +
        stuckMarkets.map(s => `${s.voter}→${s.market_id.slice(0,12)}(${s.owed_for_min}m)`).join(', '));
      // Emit one events row per stall-episode per market (de-duped) → Brain/UI/audit visible (Q2 was silent).
      const fresh = stuckMarkets.filter(s => !_alerted.has(`${s.market_id}|${s.voter_address}`));
      if (fresh.length > 0) {
        try {
          sqlite.prepare(`
            INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
            VALUES (?, 'prediction', 'oracle_voter_producing_stall', 'oracle-voter-health-monitor', 'warn', ?, ?, datetime('now'))
          `).run(randomUUID(),
            `${fresh.length} prediction market(s) past deadline with a local committee oracle owing a vote that has not been cast for >${Math.round(STALE_THRESHOLD_MS/60000)}min — oracle voting may be stalled (deriveVote/routing bug or :8000 stall). Committees cannot reach quorum → markets will refund.`,
            JSON.stringify({ stuck: fresh }));
          for (const s of fresh) _alerted.add(`${s.market_id}|${s.voter_address}`);
        } catch (e) { console.warn(`[oracle-voter-health] events insert fail (non-fatal): ${e.message}`); }
      }
    }

    _lastHealth = { ok: stuckMarkets.length === 0, checkedAt: new Date(nowMs).toISOString(), localOracles: voters.length, owed: owedTotal, stuck: stuckMarkets.length, stuckMarkets };
    return _lastHealth;
  } catch (e) {
    console.error('[oracle-voter-health] tick fail:', e.message);
    return { ok: false, error: e.message };
  } finally {
    running = false;
  }
}

export function startOracleVoterHealthMonitorCron() {
  if (timer) return;
  console.log(`[oracle-voter-health] started — tick=${TICK_INTERVAL_MS}ms grace=${STARTUP_GRACE_MS}ms stale=${Math.round(STALE_THRESHOLD_MS/60000)}min`);
  setTimeout(() => { oracleVoterHealthTick().catch(e => console.error('[oracle-voter-health] startup tick:', e.message)); }, STARTUP_GRACE_MS);
  timer = setInterval(() => { oracleVoterHealthTick().catch(e => console.error('[oracle-voter-health] tick:', e.message)); }, TICK_INTERVAL_MS);
}

export function stopOracleVoterHealthMonitorCron() {
  if (timer) { clearInterval(timer); timer = null; }
}
