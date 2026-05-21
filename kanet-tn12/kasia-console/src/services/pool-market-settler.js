// B2 v0.5 Sub 2d Phase 1 — pool_markets settler service
//
// Per service spec docs/poolspine-service-layer-spec-2026-05-21.md Section 8 (settlement flow).
//
// Architecture: Hybrid Option D + Angle 2 (= per-bettor side P2SH + oracle aggregated settlement).
// Settler responsibilities:
//   1. Cron tick: SELECT pool_markets WHERE status='verifying' AND deadline passed
//   2. Aggregate 3 oracle votes (= chain_events 'pool_oracle_vote' filter by market_id)
//   3. Consensus check:
//      - 3-of-3 unanimous → entry 0 settle_unanimous
//      - 2-of-3 (1 silent past timeout, e.g. 30 min) → entry 1 settle_majority_forfeit_1
//      - 0/3 votes after timeout → entry 2 refund_unanimous_silent
//   4. Phase 2 (deferred this sub): build settle TX + request 3 oracle sigs + broadcast
//
// Sub 2d Phase 1 scope: cron + vote aggregation + consensus decision logging only.
//                       Actual TX construction + sig orchestration → Sub 2d Phase 2.

import { sqlite } from '../db/client.js';

const TICK_INTERVAL_MS = 5 * 60 * 1000;     // 5 min
const STARTUP_GRACE_MS = 60 * 1000;         // 60s grace (= 错峰 voter daemon 45s startup)

// Per Bettor r336 + v0.5 spec section 4.3: ORACLE_SILENT_TIMEOUT_MIN ENV var.
// Default 30 min OK for testnet rapid iteration. Mainnet deploy MUST set 1440 (= 24h 钢线).
const ORACLE_SILENT_TIMEOUT_MIN = parseInt(process.env.ORACLE_SILENT_TIMEOUT_MIN, 10) || 30;
const ORACLE_SILENT_TIMEOUT_MS = ORACLE_SILENT_TIMEOUT_MIN * 60_000;

let timer = null;
let running = false;

export function startPoolMarketSettlerCron() {
  if (timer) return;
  console.log(`[pool-settler] started — 5min cron, aggregate 3 oracle votes + consensus check, silent_timeout=${ORACLE_SILENT_TIMEOUT_MIN}min (Sub 2d Phase 1)`);
  if (ORACLE_SILENT_TIMEOUT_MIN < 1440) {
    console.warn(`[pool-settler] WARN: ORACLE_SILENT_TIMEOUT_MIN=${ORACLE_SILENT_TIMEOUT_MIN} < 1440 (= mainnet 24h 钢线 per v0.5 spec section 4.3). Set ORACLE_SILENT_TIMEOUT_MIN=1440 for mainnet.`);
  }
  setTimeout(() => {
    poolSettlerTick().catch(e => console.error('[pool-settler] startup tick:', e.message));
  }, STARTUP_GRACE_MS);
  timer = setInterval(() => {
    poolSettlerTick().catch(e => console.error('[pool-settler] tick:', e.message));
  }, TICK_INTERVAL_MS);
}

export function stopPoolMarketSettlerCron() {
  if (timer) { clearInterval(timer); timer = null; }
}

export async function poolSettlerTick() {
  if (running) { return { skipped: true }; }
  running = true;
  try {
    const markets = sqlite.prepare(`
      SELECT id, maker_relay_id, spine_p2sh, oracle1_pk, oracle2_pk, oracle3_pk,
             oracle_relay_ids, deadline, protocol_status, sides_merkle_root,
             updated_at, maker_stake_amount, oracle_bond_amount,
             outcome_market_source, outcome_token_id, outcome_side
      FROM pool_markets
      WHERE protocol_status = 'verifying'
        AND deadline <= ?
    `).all(Math.floor(Date.now() / 1000));
    if (!markets.length) return { ok: true, processed: 0 };

    let consensus = 0, pending = 0, refund = 0, errored = 0;
    for (const market of markets) {
      try {
        const decision = decideConsensus(market);
        if (decision.action === 'consensus') {
          consensus++;
          console.log(`[pool-settler] CONSENSUS market=${market.id.slice(0,12)} winner=${decision.winner} unanimous=${decision.unanimous} silent_oracle=${decision.silentOracleIndex ?? 'none'}`);
          // Phase 2: build settle TX + request 3 oracle sigs (= deferred)
        } else if (decision.action === 'refund') {
          refund++;
          console.log(`[pool-settler] REFUND market=${market.id.slice(0,12)} reason=${decision.reason}`);
          // Phase 2: build refund TX (= maker single-sig, all 3 oracle bonds forfeited)
        } else {
          pending++;
        }
      } catch (e) {
        errored++;
        console.error(`[pool-settler] process fail market=${market.id?.slice(0,12)}: ${e.message}`);
      }
    }
    console.log(`[pool-settler] tick: ${markets.length} verifying markets, consensus=${consensus} refund=${refund} pending=${pending} errored=${errored}`);
    return { ok: true, processed: markets.length, consensus, refund, pending, errored };
  } finally {
    running = false;
  }
}

/**
 * Aggregate 3 oracle votes + decide settlement action.
 * @param {object} market — pool_markets row
 * @returns {{
 *   action: 'consensus' | 'refund' | 'pending',
 *   winner?: number,                       // 0 = YES wins, 1 = NO wins
 *   unanimous?: boolean,                   // 3-of-3 same outcome
 *   silentOracleIndex?: number,            // 0/1/2 for forfeit_1 entry (only when 2-of-3 + 1 silent past timeout)
 *   reason?: string,
 * }}
 */
export function decideConsensus(market) {
  let oracleIds;
  try { oracleIds = JSON.parse(market.oracle_relay_ids || '[]'); } catch { oracleIds = []; }
  if (!Array.isArray(oracleIds) || oracleIds.length !== 3) {
    return { action: 'pending', reason: `invalid oracle_relay_ids (expected 3, got ${oracleIds?.length || 0})` };
  }

  // Collect votes per oracle (= chain_events 'pool_oracle_vote' from each oracle's relay address)
  const votes = []; // [{ oracleIndex, outcome, voter_relay_id, ts }]
  for (let i = 0; i < 3; i++) {
    const oracleRelayId = oracleIds[i];
    const row = sqlite.prepare(`
      SELECT payload, observed_at FROM chain_events
      WHERE event_type = 'pool_oracle_vote'
        AND payload LIKE ?
        AND payload LIKE ?
      ORDER BY observed_at ASC
      LIMIT 1
    `).get(`%"market_id":"${market.id}"%`, `%"voter_relay_id":"${oracleRelayId}"%`);
    if (!row) continue;
    let payload;
    try { payload = JSON.parse(row.payload); } catch { continue; }
    if (payload.outcome !== 'YES' && payload.outcome !== 'NO' && payload.outcome !== 'DISPUTE') continue;
    votes.push({ oracleIndex: i, outcome: payload.outcome, voter_relay_id: oracleRelayId, ts: row.observed_at });
  }

  const verifyingSinceMs = market.updated_at ? new Date(market.updated_at).getTime() : Date.now();
  const ageMs = Date.now() - verifyingSinceMs;
  const pastSilentTimeout = ageMs >= ORACLE_SILENT_TIMEOUT_MS;

  // Case 1: 3-of-3 same outcome → unanimous consensus
  if (votes.length === 3) {
    const outcomes = new Set(votes.map(v => v.outcome));
    if (outcomes.size === 1 && (outcomes.has('YES') || outcomes.has('NO'))) {
      const winner = votes[0].outcome === 'YES' ? 0 : 1;
      return { action: 'consensus', winner, unanimous: true };
    }
    // Disagreement (e.g. 2 YES + 1 NO, or any DISPUTE) — could trigger Phase 5 challenge or refund
    return { action: 'pending', reason: `disagreement: ${[...outcomes].join(',')}` };
  }

  // Case 2: 2-of-3 same outcome + 1 silent past timeout → majority forfeit
  if (votes.length === 2 && pastSilentTimeout) {
    const outcomes = new Set(votes.map(v => v.outcome));
    if (outcomes.size === 1 && (outcomes.has('YES') || outcomes.has('NO'))) {
      const winner = votes[0].outcome === 'YES' ? 0 : 1;
      const signedIndices = new Set(votes.map(v => v.oracleIndex));
      const silentOracleIndex = [0, 1, 2].find(i => !signedIndices.has(i));
      return { action: 'consensus', winner, unanimous: false, silentOracleIndex };
    }
    return { action: 'pending', reason: `2-of-3 disagreement: ${[...outcomes].join(',')}` };
  }

  // Case 3: ≤1 vote past silent timeout → refund_all (= per Bettor r335: 1 vote insufficient majority)
  // v0.5 spec rejected "1 oracle 单独决定" in r317-321 adversarial dialogue. Must have ≥2 votes to settle.
  // Both 0/3 and 1/3 fall under refund_unanimous_silent SS entry (= all 3 oracle bonds forfeit to maker,
  // bettors self-refund via PoolSide refund_market_cancelled entry). 1 voter loses bond as v0.5 simplification.
  if (votes.length <= 1 && pastSilentTimeout) {
    return {
      action: 'refund',
      reason: votes.length === 0
        ? 'all 3 oracles silent past 30min timeout'
        : '1 vote insufficient majority + 2 silent past 30min timeout (v0.5 spec ≥2 vote requirement)',
    };
  }

  return { action: 'pending', reason: `votes=${votes.length}/3 age=${Math.floor(ageMs/60000)}min (timeout 30min)` };
}
