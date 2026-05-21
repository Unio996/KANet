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
import { sendCommandAsync } from './relay-manager.js';
import { createHash } from 'node:crypto';

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
      SELECT id, maker_relay_id, spine_p2sh, spine_lock_tx, oracle1_pk, oracle2_pk, oracle3_pk,
             oracle_relay_ids, deadline, protocol_status, sides_merkle_root, broker_pk, broker_fee_pct, broker_relay_id,
             updated_at, maker_stake_amount, oracle_bond_amount, miner_fee, metadata,
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
          // Phase 2a-2: skip if already dispatched (check metadata.phase2_dispatched_at)
          let meta = {};
          try { meta = JSON.parse(market.metadata || '{}'); } catch {}
          if (!meta.phase2_dispatched_at) {
            await dispatchPhase2(market, decision);
          }
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

/**
 * Pure function — compute pool payout amounts per Bettor r339 spec.
 * Extracted for testability (= no DB, no IPC).
 *
 * @param {object} args
 * @param {Array<{stake: number, direction: number, isMaker?: boolean}>} args.participants — maker + bettors
 * @param {number} args.winner — 0 or 1
 * @param {number} args.brokerFeePct — basis points (0-9999)
 * @param {number} args.oracleBond — sompi
 * @param {number} args.minerFee — sompi (= must subtract from output sum or kaspad rejects)
 * @param {boolean} args.unanimous
 * @param {?number} args.silentOracleIndex — 0/1/2 if forfeit_1 else null
 * @returns {{
 *   brokerFee: number,
 *   winnerPayouts: Array<{participantIndex: number, isMaker: boolean, amount: number}>,
 *   makerExtraOutput: ?number,
 *   oracleBondReturns: Array<{oracleIndex: number, amount: number}>,  // forfeit_1 silent excluded
 * }}
 */
export function computePoolPayouts(args) {
  const { participants, winner, brokerFeePct, oracleBond, minerFee, unanimous, silentOracleIndex } = args;
  if (!Number.isFinite(minerFee) || minerFee < 0) throw new Error('minerFee required (sompi int)');
  const winners = participants.map((p, i) => ({ ...p, idx: i })).filter(p => p.direction === winner);
  const losers = participants.filter(p => p.direction !== winner);
  if (!winners.length) throw new Error('no winners');

  const totalLoserStake = losers.reduce((s, p) => s + p.stake, 0);
  const totalWinnerStake = winners.reduce((s, p) => s + p.stake, 0);
  // Self-catch: subtract minerFee from losing pool (= same class as 1V1 settle TX fee bug observed
  // 5/21 in tn12 console.log "transaction has 10000 fees which is under the required amount of 13130").
  // Winners absorb fee. losingPool >= brokerFee + minerFee required else throws.
  const losingPool = Math.max(0, totalLoserStake - minerFee);
  if (totalLoserStake < minerFee) {
    throw new Error(`losing pool (${totalLoserStake}) less than minerFee (${minerFee}) — settle impossible without fee`);
  }
  const brokerFee = Math.floor(losingPool * brokerFeePct / 10000);
  const distributablePool = losingPool - brokerFee;

  // Forfeit_1 50/25/25 split per v0.5 spec section 4.4
  let winnerForfeitShare = 0, makerForfeitShare = 0, perOracleForfeitShare = 0;
  if (!unanimous && typeof silentOracleIndex === 'number') {
    winnerForfeitShare = Math.floor(oracleBond * 50 / 100);
    makerForfeitShare = Math.floor(oracleBond * 25 / 100);
    perOracleForfeitShare = Math.floor(oracleBond * 25 / 100 / 2);
  }

  const winnerPayouts = winners.map(w => {
    const winnerShare = totalWinnerStake > 0
      ? Math.floor((distributablePool + winnerForfeitShare) * w.stake / totalWinnerStake)
      : 0;
    let amount = w.stake + winnerShare;
    if (w.isMaker) amount += makerForfeitShare;
    return { participantIndex: w.idx, isMaker: !!w.isMaker, amount };
  });

  const isMakerWinner = winners.some(w => w.isMaker);
  const makerExtraOutput = (!isMakerWinner && makerForfeitShare > 0) ? makerForfeitShare : null;

  const oracleBondReturns = [];
  for (let i = 0; i < 3; i++) {
    if (!unanimous && silentOracleIndex === i) continue;
    oracleBondReturns.push({ oracleIndex: i, amount: oracleBond + perOracleForfeitShare });
  }

  return { brokerFee, winnerPayouts, makerExtraOutput, oracleBondReturns };
}

/**
 * Phase 2a-2: dispatch settle TX preimage construction + DM oracles for sigs.
 * Only handles 'consensus' decisions (= unanimous OR majority_forfeit_1).
 * Refund branch handled separately in Phase 2a-3.
 *
 * Output layout per PoolSpine.sil entry 0 settle_unanimous:
 *   - outputs[0] = broker fee (P2PK brokerPk)
 *   - outputs[1..N] = N winner payouts (P2PK each winning bettor pubkey)
 *   - outputs[last 3] = oracle bond returns (P2PK each oraclePk)
 *
 * For forfeit_1 (1 silent oracle): silent oracle bond NOT returned (= forfeit),
 *   simplified to maker (Phase 2 KIP-10 loop refinement deferred).
 *
 * @param {object} market — pool_markets row
 * @param {{ winner: number, unanimous: boolean, silentOracleIndex?: number }} decision
 */
export async function dispatchPhase2(market, decision) {
  try {
    // 1. Read bettors from pool_bettor_sides
    const sides = sqlite.prepare(`
      SELECT bettor_pk, bettor_relay_id, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index
      FROM pool_bettor_sides
      WHERE market_id = ?
        AND side_lock_tx IS NOT NULL
      ORDER BY merkle_index ASC
    `).all(market.id);

    // Per Bettor r339: maker is a bettor (= not a seeder). maker direction = outcome_side mapping.
    const makerDirection = market.outcome_side === 'YES' ? 0 : 1;
    const makerStake = parseInt(market.maker_stake_amount, 10) || 0;

    // 2. Look up addresses
    const oracleIds = JSON.parse(market.oracle_relay_ids || '[]');
    const oracleRows = oracleIds.map(rid => sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(rid));
    if (oracleRows.some(r => !r?.address)) {
      console.warn(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} missing oracle addresses`);
      return;
    }
    const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
    if (!makerRow?.address) {
      console.warn(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} no maker address`);
      return;
    }

    // r339 push 3: broker_relay_id required (= broker fee output dest, no longer placeholder).
    const brokerRow = market.broker_relay_id
      ? sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.broker_relay_id)
      : null;
    if (!brokerRow?.address) {
      console.warn(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} missing broker address (broker_relay_id=${market.broker_relay_id})`);
      return;
    }

    // Bettor addresses
    const sideAddrs = sides.map(s => {
      const row = s.bettor_relay_id
        ? sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(s.bettor_relay_id)
        : null;
      return row?.address || null;
    });
    if (sideAddrs.some(a => !a)) {
      console.warn(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} missing bettor addresses`);
      return;
    }

    // 3. Build participants array (= maker + bettors), use pure function computePoolPayouts.
    const participants = [
      { addr: makerRow.address, stake: makerStake, direction: makerDirection, isMaker: true },
      ...sides.map((s, i) => ({ addr: sideAddrs[i], stake: parseInt(s.stake_amount, 10) || 0, direction: s.direction, isMaker: false })),
    ];

    let payouts;
    try {
      payouts = computePoolPayouts({
        participants,
        winner: decision.winner,
        brokerFeePct: parseInt(market.broker_fee_pct, 10) || 0,
        oracleBond: parseInt(market.oracle_bond_amount, 10) || 0,
        minerFee: parseInt(market.miner_fee, 10) || 20_000,
        unanimous: decision.unanimous,
        silentOracleIndex: decision.silentOracleIndex ?? null,
      });
    } catch (e) {
      console.warn(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} computePoolPayouts fail: ${e.message}`);
      return;
    }

    // 4. Build outputs per PoolSpine.sil entry 0 ordering:
    //    [broker, winner_1..winner_N, optional maker creator-fee output, oracle_bond_returns[]]
    const outputs = [];
    if (payouts.brokerFee > 0) {
      outputs.push({ address: brokerRow.address, amountSompi: payouts.brokerFee.toString() });
    }
    for (const w of payouts.winnerPayouts) {
      outputs.push({ address: participants[w.participantIndex].addr, amountSompi: w.amount.toString() });
    }
    if (payouts.makerExtraOutput) {
      outputs.push({ address: makerRow.address, amountSompi: payouts.makerExtraOutput.toString() });
    }
    for (const r of payouts.oracleBondReturns) {
      outputs.push({ address: oracleRows[r.oracleIndex].address, amountSompi: r.amount.toString() });
    }

    // 5. Build input outpoints: spine + N side lock TXs
    const requiredInputOutpoints = [
      { outpointTxid: market.spine_lock_tx, outpointIndex: 0 },
      ...sides.map(s => ({ outpointTxid: s.side_lock_tx, outpointIndex: 0 })),
    ];

    // 6. Call maker_relay 'prediction_settle_build_preimage' with multi-p2sh array (= spine + N side p2sh)
    const p2shAddresses = [market.spine_p2sh, ...sides.map(s => s.side_p2sh)];
    const preimage = await sendCommandAsync(market.maker_relay_id, {
      type: 'prediction_settle_build_preimage',
      p2sh_address: p2shAddresses,  // array — multi-p2sh extension Phase 2a-1
      required_input_outpoints: requiredInputOutpoints,
      outputs,
    });
    if (!preimage?.ok || !preimage.tx_obj) {
      console.error(`[pool-settler] dispatchPhase2 build_preimage fail market=${market.id.slice(0,12)}: ${preimage?.error}`);
      return;
    }

    // 7. Stash phase2_tx_obj + winner + silent_oracle_index in pool_markets.metadata
    const newMeta = {
      phase2_tx_obj: preimage.tx_obj,
      phase2_winner: decision.winner,
      phase2_unanimous: decision.unanimous,
      phase2_silent_oracle_index: decision.silentOracleIndex ?? null,
      phase2_dispatched_at: new Date().toISOString(),
      phase2_input_count: requiredInputOutpoints.length,
      phase2_output_count: outputs.length,
    };
    sqlite.prepare('UPDATE pool_markets SET metadata = ?, protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(newMeta), 'collecting_sigs', market.id);

    // 8. DM 3 oracle relays with kanet_pool_oracle_tx_sign_req_v1
    //    (= adapted from 1V1 kanet_oracle_tx_sign_req_v1, uses market_id instead of offer_id)
    const reqPayload = JSON.stringify({
      t: 'kanet_pool_oracle_tx_sign_req_v1',
      market_id: market.id,
      winner: decision.winner,
      unanimous: decision.unanimous,
      silent_oracle_index: decision.silentOracleIndex ?? null,
      input_count: requiredInputOutpoints.length,
    });
    const signingOracles = decision.unanimous
      ? [0, 1, 2]
      : [0, 1, 2].filter(i => i !== decision.silentOracleIndex);
    Promise.allSettled(signingOracles.map(i =>
      sendCommandAsync(market.maker_relay_id, { type: 'send_message', target: oracleRows[i].address, message: reqPayload })
    )).catch(() => {});

    console.log(`[pool-settler] DISPATCHED Phase 2 market=${market.id.slice(0,12)} winner=${decision.winner} unanimous=${decision.unanimous} inputs=${requiredInputOutpoints.length} outputs=${outputs.length} → collecting_sigs`);
  } catch (e) {
    console.error(`[pool-settler] dispatchPhase2 fail market=${market.id?.slice(0,12)}: ${e.message}`);
  }
}
