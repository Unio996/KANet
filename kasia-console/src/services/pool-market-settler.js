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
// Area-7 T5 / area-4 Gap 6: DISAGREEMENT_TIMEOUT independent timer (= NOT ORACLE_SILENT_TIMEOUT
// reuse, different semantics — disagreement is info-complete, no value waiting 24h). testnet
// 5 min default, matches PoolSpine.sil refund_disagreement entry's `tx.time >= deadline + 300`
// SS-hardcoded value. Mainnet rebuild SS + Console with longer value (1-2h per area-7 T5).
const DISAGREEMENT_TIMEOUT_MIN = parseInt(process.env.DISAGREEMENT_TIMEOUT_MIN, 10) || 5;
const DISAGREEMENT_TIMEOUT_MS = DISAGREEMENT_TIMEOUT_MIN * 60_000;

// B2 v0.5 Phase 3 bug 8 — Kaspa Crescendo KIP-9 storage mass constraints.
// A pool settle TX with many small-value outputs blows the storage mass cap (= UAT cycle 3:
// 0.5 KAS bettor stakes → broker_fee 500k sompi → storage_mass 1.99M > 500k cap).
const KIP9_C = 1e12;                          // KIP-9 mass constant
const STORAGE_MASS_CAP = 500_000;             // kaspad standardness cap
const STORAGE_MASS_SAFE_THRESHOLD = 400_000;  // 20% buffer — settle aborts above this
const MIN_BROKER_FEE_SOMPI = 5_000_000;       // 0.05 KAS broker_fee floor (Bettor r370)

let timer = null;
let running = false;

/**
 * Estimate a transaction's KIP-9 storage mass.
 * storage_mass = C × max(0, Σ(1/output_value) − inputCount² / Σ(input_value))
 * Verified against UAT cycle 3 observed mass (1,991,668 ≈ computed).
 *
 * @param {number[]} inputValues - sompi values of each input UTXO
 * @param {number[]} outputValues - sompi values of each output
 * @returns {number} estimated storage mass
 */
export function estimateStorageMass(inputValues, outputValues) {
  const sumOutInv = outputValues.reduce((s, v) => s + (v > 0 ? 1 / v : 0), 0);
  const sumIn = inputValues.reduce((s, v) => s + v, 0);
  const inputsTerm = sumIn > 0 ? (inputValues.length * inputValues.length) / sumIn : 0;
  return Math.max(0, Math.round(KIP9_C * (sumOutInv - inputsTerm)));
}

/**
 * Parse a SQLite CURRENT_TIMESTAMP string as UTC.
 * SQLite stores 'YYYY-MM-DD HH:MM:SS' with no timezone — it IS UTC, but JS `new Date(str)`
 * on a space-separated string parses it as LOCAL time → 中国 host UTC+8 → 8h skew →
 * instant false ORACLE_SILENT_TIMEOUT. Phase 3 e2e caught this (= market false-refunded 3 min in).
 */
export function parseSqliteUtc(ts) {
  if (!ts) return Date.now();
  if (typeof ts === 'number') return ts;
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T');
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z').getTime();
}

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
      WHERE protocol_status IN ('verifying', 'collecting_sigs')
        AND deadline <= ?
    `).all(Math.floor(Date.now() / 1000));
    if (!markets.length) return { ok: true, processed: 0 };

    let consensus = 0, pending = 0, refund = 0, errored = 0, doomed = 0;
    for (const market of markets) {
      try {
        // Phase 2b Ship #1 — doomed-market skip. A market marked needs_larger_pot can never
        // settle (settle TX storage mass exceeds the 500k cap). Without this skip dispatchPhase2
        // recomputes the same doomed mass every tick forever, starving healthy markets.
        let doomedMeta = {};
        try { doomedMeta = JSON.parse(market.metadata || '{}'); } catch {}
        if (doomedMeta.needs_larger_pot) { doomed++; continue; }

        // Phase 2b: collecting_sigs status → handle sig aggregation + submit
        if (market.protocol_status === 'collecting_sigs') {
          await handleCollectingSigs(market);
          continue;
        }

        const decision = decideConsensus(market);
        // 7b — first-detection stash for refund_disagreement timing (= area-4 Gap 6 dual-track).
        // Pure-function decideConsensus signals via stashDisagreementDetected flag; the write
        // side-effect lives here so decideConsensus stays free of DB mutation. The stash is
        // once-and-readonly: if disagreement_detected_at already set, this branch is bypassed
        // (decideConsensus only emits the flag on first detection per its read of metadata).
        if (decision.stashDisagreementDetected) {
          let meta = {};
          try { meta = JSON.parse(market.metadata || '{}'); } catch {}
          const detectedAt = new Date().toISOString();
          sqlite.prepare('UPDATE pool_markets SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(JSON.stringify({ ...meta, disagreement_detected_at: detectedAt }), market.id);
          // Dual-track per Owner: also write chain_event so the protocol fact is on-chain,
          // not only in internal DB state. Synthetic txid since this isn't a chain TX.
          const syntheticTxid = `disagreement_detected:${market.id.slice(0,12)}:${Date.now()}`;
          sqlite.prepare(`
            INSERT INTO chain_events (id, txid, event_type, from_address, to_address, payload, observed_by, observed_at)
            VALUES (lower(hex(randomblob(16))), ?, 'disagreement_detected', NULL, NULL, ?, 'pool-settler', CURRENT_TIMESTAMP)
          `).run(syntheticTxid, JSON.stringify({ market_id: market.id, detected_at: detectedAt, silent_oracle_index: decision.silentOracleIndex }));
          console.log(`[pool-settler] DISAGREEMENT DETECTED market=${market.id.slice(0,12)} silentOracleIndex=${decision.silentOracleIndex} detected_at=${detectedAt}`);
          // After stash, fall through to pending++ for this tick — next tick decideConsensus
          // will use the stashed timestamp for timeout math.
        }

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
          // Phase 2a-3: skip if already dispatched
          let meta = {};
          try { meta = JSON.parse(market.metadata || '{}'); } catch {}
          if (!meta.refund_dispatched_at) {
            await dispatchRefund(market, decision);
          }
        } else if (decision.action === 'refund_disagreement') {
          refund++;
          console.log(`[pool-settler] REFUND_DISAGREEMENT market=${market.id.slice(0,12)} silentOracleIndex=${decision.silentOracleIndex} reason=${decision.reason}`);
          let meta = {};
          try { meta = JSON.parse(market.metadata || '{}'); } catch {}
          if (!meta.refund_disagreement_dispatched_at) {
            await dispatchRefundDisagreement(market, decision);
          }
        } else {
          pending++;
        }
      } catch (e) {
        errored++;
        console.error(`[pool-settler] process fail market=${market.id?.slice(0,12)}: ${e.message}`);
      }
    }
    console.log(`[pool-settler] tick: ${markets.length} verifying markets, consensus=${consensus} refund=${refund} pending=${pending} doomed=${doomed} errored=${errored}`);
    return { ok: true, processed: markets.length, consensus, refund, pending, doomed, errored };
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
    // F1 (area-3 钦定): protocol vote space is YES/NO/silent only. DISPUTE filtered out
    // (= chain_events with outcome=DISPUTE treated as no-vote / silent). pool.js vote
    // endpoint rejects DISPUTE pre-insert, but defensively filter here in case of legacy
    // chain_events with DISPUTE outcome from pre-F1 markets.
    if (payload.outcome !== 'YES' && payload.outcome !== 'NO') continue;
    votes.push({ oracleIndex: i, outcome: payload.outcome, voter_relay_id: oracleRelayId, ts: row.observed_at });
  }

  const verifyingSinceMs = parseSqliteUtc(market.updated_at);
  const ageMs = Date.now() - verifyingSinceMs;
  const pastSilentTimeout = ageMs >= ORACLE_SILENT_TIMEOUT_MS;

  // 7b helper: read disagreement_detected_at stash (= area-4 Gap 6 once-and-readonly). The
  // stash itself is written by poolSettlerTick on first detection (= side-effect kept out of
  // this pure function); decideConsensus only reads it for timeout math.
  let disagreementDetectedAtMs = null;
  try {
    const meta = JSON.parse(market.metadata || '{}');
    if (meta.disagreement_detected_at) disagreementDetectedAtMs = parseSqliteUtc(meta.disagreement_detected_at);
  } catch {}

  // Case 1: 3-of-3 outcomes (consensus or full dissent)
  if (votes.length === 3) {
    const outcomes = new Set(votes.map(v => v.outcome));
    if (outcomes.size === 1 && (outcomes.has('YES') || outcomes.has('NO'))) {
      const winner = votes[0].outcome === 'YES' ? 0 : 1;
      return { action: 'consensus', winner, unanimous: true };
    }
    // Gap 1A — 3 dissent (e.g. 2 YES + 1 NO or 1Y+1N+1other-YES/NO etc.). silentOracleIndex=-1.
    // On first detection: caller stashes disagreement_detected_at + writes chain_event. Once
    // stashed, after DISAGREEMENT_TIMEOUT we return refund_disagreement action with sIO=-1.
    if (!disagreementDetectedAtMs) {
      return { action: 'pending', reason: `disagreement (Gap 1A pending stash): ${[...outcomes].join(',')}`, stashDisagreementDetected: true, silentOracleIndex: -1 };
    }
    const disAgeMs = Date.now() - disagreementDetectedAtMs;
    if (disAgeMs >= DISAGREEMENT_TIMEOUT_MS) {
      return { action: 'refund_disagreement', silentOracleIndex: -1, reason: `Gap 1A: 3 dissent (${[...outcomes].join(',')}) past ${DISAGREEMENT_TIMEOUT_MIN}min` };
    }
    return { action: 'pending', reason: `Gap 1A: 3 dissent age ${Math.floor(disAgeMs/60000)}min < ${DISAGREEMENT_TIMEOUT_MIN}min` };
  }

  // Case 2: 2 votes + 1 silent (past silent timeout)
  if (votes.length === 2 && pastSilentTimeout) {
    const outcomes = new Set(votes.map(v => v.outcome));
    const signedIndices = new Set(votes.map(v => v.oracleIndex));
    const silentOracleIndex = [0, 1, 2].find(i => !signedIndices.has(i));
    if (outcomes.size === 1 && (outcomes.has('YES') || outcomes.has('NO'))) {
      // 2 same direction + 1 silent → forfeit_1 (existing settle path)
      const winner = votes[0].outcome === 'YES' ? 0 : 1;
      return { action: 'consensus', winner, unanimous: false, silentOracleIndex };
    }
    // Gap 1B — 2 split + 1 silent. silentOracleIndex identifies the silent oracle. On first
    // detection: stash disagreement_detected_at + chain_event. After DISAGREEMENT_TIMEOUT,
    // return refund_disagreement with silentOracleIndex = silent's index (silent bond burned).
    if (!disagreementDetectedAtMs) {
      return { action: 'pending', reason: `disagreement (Gap 1B pending stash): ${[...outcomes].join(',')} + oracle ${silentOracleIndex} silent`, stashDisagreementDetected: true, silentOracleIndex };
    }
    const disAgeMs = Date.now() - disagreementDetectedAtMs;
    if (disAgeMs >= DISAGREEMENT_TIMEOUT_MS) {
      return { action: 'refund_disagreement', silentOracleIndex, reason: `Gap 1B: 2 dissent + oracle ${silentOracleIndex} silent past ${DISAGREEMENT_TIMEOUT_MIN}min` };
    }
    return { action: 'pending', reason: `Gap 1B: mid-disagreement age ${Math.floor(disAgeMs/60000)}min < ${DISAGREEMENT_TIMEOUT_MIN}min` };
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
  // Bug 8: broker_fee floor — defaults to MIN_BROKER_FEE_SOMPI; tests may pass 0 to isolate proportional math.
  const minBrokerFee = (args.minBrokerFee === undefined) ? MIN_BROKER_FEE_SOMPI : args.minBrokerFee;
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
  // Bug 8: broker_fee floor MIN_BROKER_FEE_SOMPI (= 0.05 KAS) — a tiny broker output
  // dominates KIP-9 storage mass (Σ 1/output_value). Floored so the output isn't dust-small.
  const brokerFeeRaw = Math.floor(losingPool * brokerFeePct / 10000);
  const brokerFee = Math.max(brokerFeeRaw, minBrokerFee);
  if (losingPool < brokerFee) {
    throw new Error(`losing pool (${losingPool}) less than broker_fee floor (${brokerFee}) — pot too small to settle`);
  }
  const distributablePool = losingPool - brokerFee;

  // Forfeit_1 50/25/25 split per v0.5 spec section 4.4
  // W3 (area-5/6): the 4 floor calls (winner / maker / oracle × 2) can each shed 0-1 sompi
  // depending on oracleBond divisibility. Without explicit handling those sompi would leak
  // into minerFee (implicit). Explicitly fold the remainder into makerForfeitShare so
  // total_allocated == oracleBond (matches the W2 formula spec). area-10 outstanding may
  // revisit whether maker share belongs to maker at all (same +EV pattern as Gap 1B burn),
  // but until that decision the remainder follows the same destination as the 25% share.
  let winnerForfeitShare = 0, makerForfeitShare = 0, perOracleForfeitShare = 0;
  if (!unanimous && typeof silentOracleIndex === 'number') {
    winnerForfeitShare = Math.floor(oracleBond * 50 / 100);
    makerForfeitShare = Math.floor(oracleBond * 25 / 100);
    perOracleForfeitShare = Math.floor(oracleBond * 25 / 100 / 2);
    const totalAllocated = winnerForfeitShare + makerForfeitShare + perOracleForfeitShare * 2;
    const remainder = oracleBond - totalAllocated;
    makerForfeitShare += remainder;
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

    // 5. Build input outpoints. Spine P2SH has MULTIPLE UTXOs: 1 maker stake (spine_lock_tx) +
    //    N oracle bond deposits (= each oracle/deposit was a separate transfer → separate UTXO).
    //    Phase 3 e2e caught: settle TX missing oracle bond UTXOs → kaspad "spend > inputs".
    //    All spine-P2SH UTXOs need PoolSpine settle_unanimous scriptSig (3 sigs each).
    const depositRows = sqlite.prepare(`
      SELECT payload FROM chain_events
      WHERE event_type = 'pool_oracle_deposit' AND payload LIKE ?
    `).all(`%"market_id":"${market.id}"%`);
    const oracleDepositOutpoints = depositRows.map(r => {
      const p = JSON.parse(r.payload);
      return { outpointTxid: p.deposit_tx, outpointIndex: 0 };
    });
    // Spine inputs = maker stake UTXO + N oracle bond UTXOs (= all locked by PoolSpine redeem)
    const spineInputCount = 1 + oracleDepositOutpoints.length;
    const requiredInputOutpoints = [
      { outpointTxid: market.spine_lock_tx, outpointIndex: 0 },  // maker stake
      ...oracleDepositOutpoints,                                  // N oracle bonds
      ...sides.map(s => ({ outpointTxid: s.side_lock_tx, outpointIndex: 0 })),  // N bettor sides
    ];

    // Bug 8: pre-settle KIP-9 storage mass check. A settle TX with too-small outputs blows
    // the kaspad storage mass cap (500k) → rejected forever. Abort + mark needs_larger_pot
    // rather than retry a doomed submit every tick.
    const inputValues = [
      parseInt(market.maker_stake_amount, 10) || 0,
      ...oracleDepositOutpoints.map(() => parseInt(market.oracle_bond_amount, 10) || 0),
      ...sides.map(s => parseInt(s.stake_amount, 10) || 0),
    ];
    const outputValues = outputs.map(o => parseInt(o.amountSompi, 10) || 0);
    const estMass = estimateStorageMass(inputValues, outputValues);
    if (estMass > STORAGE_MASS_SAFE_THRESHOLD) {
      console.warn(`[pool-settler] dispatchPhase2 market=${market.id.slice(0,12)} estimated storage mass ${estMass} > ${STORAGE_MASS_SAFE_THRESHOLD} (cap ${STORAGE_MASS_CAP}) — pot too small, marking needs_larger_pot`);
      let prevM = {};
      try { prevM = JSON.parse(market.metadata || '{}'); } catch {}
      sqlite.prepare('UPDATE pool_markets SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify({ ...prevM, needs_larger_pot: true, est_storage_mass: estMass }), market.id);
      return;
    }

    // 6. Call maker_relay 'prediction_settle_build_preimage' with multi-p2sh array.
    //    Spine P2SH appears once in p2sh list (= all its UTXOs fetched by that address).
    //    Phase 3 bug 5: per-input sigOpCount — spine inputs have 3 checkSig, sides 0.
    //    Preimage sigOpCount MUST match final settle TX (= Kaspa sighash includes sig_op_counts_hash).
    const p2shAddresses = [market.spine_p2sh, ...sides.map(s => s.side_p2sh)];
    const sigOpCounts = requiredInputOutpoints.map((_, i) => (i < spineInputCount ? 3 : 0));
    const preimage = await sendCommandAsync(market.maker_relay_id, {
      type: 'prediction_settle_build_preimage',
      p2sh_address: p2shAddresses,  // array — multi-p2sh extension Phase 2a-1
      required_input_outpoints: requiredInputOutpoints,
      outputs,
      sig_op_counts: sigOpCounts,
    });
    if (!preimage?.ok || !preimage.tx_obj) {
      console.error(`[pool-settler] dispatchPhase2 build_preimage fail market=${market.id.slice(0,12)}: ${preimage?.error}`);
      return;
    }

    // 7. Stash phase2_tx_obj + winner + silent_oracle_index in pool_markets.metadata
    // CRITICAL: spread prior metadata (= preserve spine_redeem_script_hex stashed at create time).
    // Phase 3 e2e caught: without ...prevMeta the create-time spine_redeem_script_hex got wiped →
    // handleCollectingSigs "missing meta.spine_redeem_script_hex" → settle TX cannot assemble.
    let prevMeta = {};
    try { prevMeta = JSON.parse(market.metadata || '{}'); } catch {}
    const newMeta = {
      ...prevMeta,
      phase2_tx_obj: preimage.tx_obj,
      phase2_winner: decision.winner,
      phase2_unanimous: decision.unanimous,
      phase2_silent_oracle_index: decision.silentOracleIndex ?? null,
      phase2_dispatched_at: new Date().toISOString(),
      phase2_input_count: requiredInputOutpoints.length,
      phase2_spine_input_count: spineInputCount,  // Phase 3 bug 4: spine has 1 maker + N oracle bond UTXOs
      phase2_output_count: outputs.length,
      phase2_outputs: outputs,  // Phase 2c step 2c: full outputs array for collecting_sigs handler IPC assembly
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
      spine_input_count: spineInputCount,
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

/**
 * Phase 2a-3: dispatch refund_unanimous_silent — maker single-sig refund TX.
 *
 * Per PoolSpine.sil entry 2 refund_unanimous_silent:
 *   - Maker single-sig (no oracle sigs needed)
 *   - require(tx.time >= deadline)
 *   - Maker recovers stake + 3 oracle bonds (= total forfeit to maker)
 *
 * Bettor sides separately refund via PoolSide.refund_market_cancelled entry 2.
 * For Phase 2a-3 first ship: only spine refund TX broadcast (= maker recover).
 * Bettor side refunds happen async via their own claim TX.
 *
 * @param {object} market — pool_markets row
 * @param {object} decision — { action: 'refund', reason: string }
 */
export async function dispatchRefund(market, decision) {
  try {
    // 1. Compute maker output amount per PoolSpine.sil entry 2:
    //    tx.outputs[0].value == makerStakeAmount + oracleBondAmount * 3 - minerFee
    const makerStake = parseInt(market.maker_stake_amount, 10) || 0;
    const oracleBond = parseInt(market.oracle_bond_amount, 10) || 0;
    const minerFee = parseInt(market.miner_fee, 10) || 20_000;
    const makerRefundAmount = makerStake + oracleBond * 3 - minerFee;
    if (makerRefundAmount <= 0) {
      console.warn(`[pool-settler] dispatchRefund market=${market.id.slice(0,12)} makerRefundAmount=${makerRefundAmount} ≤ 0, skip`);
      return;
    }

    // 2. Look up maker address
    const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
    if (!makerRow?.address) {
      console.warn(`[pool-settler] dispatchRefund market=${market.id.slice(0,12)} no maker address`);
      return;
    }

    // 3. Build refund TX preimage — reuse 'prediction_settle_build_preimage' IPC with single-p2sh + 1 output
    //    Inputs: spine UTXO only (= maker stake + 3 bonds locked here)
    //    Output: maker_refund_amount to maker_address
    const preimage = await sendCommandAsync(market.maker_relay_id, {
      type: 'prediction_settle_build_preimage',
      p2sh_address: market.spine_p2sh,  // single string for refund (= only spine, no sides)
      required_input_outpoints: [
        { outpointTxid: market.spine_lock_tx, outpointIndex: 0 },
      ],
      outputs: [
        { address: makerRow.address, amountSompi: makerRefundAmount.toString() },
      ],
    });
    if (!preimage?.ok || !preimage.tx_obj) {
      console.error(`[pool-settler] dispatchRefund build_preimage fail market=${market.id.slice(0,12)}: ${preimage?.error}`);
      return;
    }

    // 4. Stash refund metadata + transition to refunding (single-sig path skips collecting_sigs)
    let prevMeta = {};
    try { prevMeta = JSON.parse(market.metadata || '{}'); } catch {}
    const newMeta = {
      ...prevMeta,
      refund_tx_obj: preimage.tx_obj,
      refund_reason: decision.reason,
      refund_dispatched_at: new Date().toISOString(),
      refund_amount: makerRefundAmount,
    };
    sqlite.prepare('UPDATE pool_markets SET metadata = ?, protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(newMeta), 'refunding', market.id);

    // 5. Phase 2a-3 first ship: stash only. Phase 2b collecting_sigs handler will trigger maker sign + broadcast.
    //    For maker single-sig refund, simpler: maker_relay signs locally + broadcasts immediately (no DM needed).
    //    Future iteration: route through collecting_sigs handler for state machine consistency.
    console.log(`[pool-settler] DISPATCHED Refund market=${market.id.slice(0,12)} reason=${decision.reason} maker_refund=${makerRefundAmount} → refunding`);
  } catch (e) {
    console.error(`[pool-settler] dispatchRefund fail market=${market.id?.slice(0,12)}: ${e.message}`);
  }
}

/**
 * 7b — dispatchRefundDisagreement: build settle TX preimage for the refund_disagreement SS
 * entry (area-4 + Owner Gap 1B burn). Mirrors dispatchPhase2 pattern but constructs the
 * refund_disagreement output layout:
 *   - silentOracleIndex === -1 (Gap 1A): 4 outputs = maker + 3 oracle bonds (all dissent)
 *   - silentOracleIndex === 0|1|2 (Gap 1B): 3 outputs = maker + 2 dissent oracle bonds
 *     (silent oracle's bond NOT in outputs → input/output difference burned per Owner)
 *
 * Output[0] = maker recovers (makerStakeAmount - minerFee) per area-4 Gap 9.
 * Output[1..N] = surviving oracle bond returns at oracleBondAmount each.
 *
 * Stashes refund_disagreement_tx_obj in metadata + transitions market to 'collecting_sigs'.
 * handleCollectingSigs aggregates the 2 oracle sigs (= per signingPair = 2 - silentOracleIndex
 * for Gap 1B, any pair for Gap 1A) and the relay IPC (= 7c) assembles + submits.
 *
 * @param {object} market — pool_markets row
 * @param {{ silentOracleIndex: number, reason: string }} decision
 */
export async function dispatchRefundDisagreement(market, decision) {
  try {
    const { silentOracleIndex } = decision;
    if (silentOracleIndex !== -1 && (silentOracleIndex < 0 || silentOracleIndex > 2)) {
      console.warn(`[pool-settler] dispatchRefundDisagreement market=${market.id.slice(0,12)} invalid silentOracleIndex=${silentOracleIndex}`);
      return;
    }

    const makerStake = parseInt(market.maker_stake_amount, 10) || 0;
    const oracleBond = parseInt(market.oracle_bond_amount, 10) || 0;
    const minerFee = parseInt(market.miner_fee, 10) || 20_000;

    const makerRow = sqlite.prepare('SELECT address FROM relay_nodes WHERE id = ?').get(market.maker_relay_id);
    if (!makerRow?.address) {
      console.warn(`[pool-settler] dispatchRefundDisagreement market=${market.id.slice(0,12)} no maker address`);
      return;
    }

    const oracleIds = JSON.parse(market.oracle_relay_ids || '[]');
    const oracleRows = oracleIds.map(rid => sqlite.prepare('SELECT id, address FROM relay_nodes WHERE id = ?').get(rid));
    if (oracleRows.some(r => !r?.address)) {
      console.warn(`[pool-settler] dispatchRefundDisagreement market=${market.id.slice(0,12)} missing oracle addresses`);
      return;
    }

    // Build outputs per silentOracleIndex
    const makerRefund = makerStake - minerFee;
    if (makerRefund <= 0) {
      console.warn(`[pool-settler] dispatchRefundDisagreement market=${market.id.slice(0,12)} makerRefund=${makerRefund} <= 0`);
      return;
    }
    const outputs = [{ address: makerRow.address, amountSompi: makerRefund.toString() }];
    // For Gap 1A: include all 3 oracle bonds. For Gap 1B: skip the silent oracle.
    for (let i = 0; i < 3; i++) {
      if (silentOracleIndex === i) continue;
      outputs.push({ address: oracleRows[i].address, amountSompi: oracleBond.toString() });
    }
    // Sanity: outputs.length should match SS entry's strict equality check
    const expectedOutputCount = silentOracleIndex === -1 ? 4 : 3;
    if (outputs.length !== expectedOutputCount) {
      console.warn(`[pool-settler] dispatchRefundDisagreement market=${market.id.slice(0,12)} outputs.length=${outputs.length} != expected ${expectedOutputCount}`);
      return;
    }

    // Inputs: spine (maker stake UTXO) + N oracle deposit UTXOs (= each oracle's bond UTXO)
    const depositRows = sqlite.prepare(`
      SELECT payload FROM chain_events
      WHERE event_type = 'pool_oracle_deposit' AND payload LIKE ?
    `).all(`%"market_id":"${market.id}"%`);
    const oracleDepositOutpoints = depositRows.map(r => {
      const p = JSON.parse(r.payload);
      return { outpointTxid: p.deposit_tx, outpointIndex: 0 };
    });
    const requiredInputOutpoints = [
      { outpointTxid: market.spine_lock_tx, outpointIndex: 0 },
      ...oracleDepositOutpoints,
    ];

    // signingPair: Gap 1B forced to 2 - silentOracleIndex; Gap 1A defaults to 0 (oracle1+2)
    const signingPair = silentOracleIndex === -1 ? 0 : (2 - silentOracleIndex);
    const signingOracles = silentOracleIndex === -1
      ? [0, 1]   // Gap 1A: signingPair=0 → oracle1+2 sign
      : [0, 1, 2].filter(i => i !== silentOracleIndex);

    // Build preimage via maker_relay (single-p2sh refund TX on spine inputs only)
    const preimage = await sendCommandAsync(market.maker_relay_id, {
      type: 'prediction_settle_build_preimage',
      p2sh_address: market.spine_p2sh,
      required_input_outpoints: requiredInputOutpoints,
      outputs,
    });
    if (!preimage?.ok || !preimage.tx_obj) {
      console.error(`[pool-settler] dispatchRefundDisagreement build_preimage fail market=${market.id.slice(0,12)}: ${preimage?.error}`);
      return;
    }

    let prevMeta = {};
    try { prevMeta = JSON.parse(market.metadata || '{}'); } catch {}
    const newMeta = {
      ...prevMeta,
      refund_disagreement_tx_obj: preimage.tx_obj,
      refund_disagreement_silent_oracle_index: silentOracleIndex,
      refund_disagreement_signing_pair: signingPair,
      refund_disagreement_dispatched_at: new Date().toISOString(),
      refund_disagreement_outputs: outputs,
      refund_disagreement_input_count: requiredInputOutpoints.length,
    };
    sqlite.prepare('UPDATE pool_markets SET metadata = ?, protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(newMeta), 'collecting_sigs', market.id);

    // DM the 2 signing oracles for refund_disagreement sigs (= 7c relay IPC schema handles
    // the unlock scriptSig assembly per signingPair).
    const reqPayload = JSON.stringify({
      t: 'kanet_pool_oracle_refund_disagreement_sign_req_v1',
      market_id: market.id,
      silent_oracle_index: silentOracleIndex,
      signing_pair: signingPair,
      input_count: requiredInputOutpoints.length,
    });
    Promise.allSettled(signingOracles.map(i =>
      sendCommandAsync(market.maker_relay_id, { type: 'send_message', target: oracleRows[i].address, message: reqPayload })
    )).catch(() => {});

    console.log(`[pool-settler] DISPATCHED RefundDisagreement market=${market.id.slice(0,12)} silentOracleIndex=${silentOracleIndex} signingPair=${signingPair} outputs=${outputs.length} signers=${signingOracles.join(',')} → collecting_sigs`);
  } catch (e) {
    console.error(`[pool-settler] dispatchRefundDisagreement fail market=${market.id?.slice(0,12)}: ${e.message}`);
  }
}

/**
 * Phase 2b: handleCollectingSigs — scan chain_events for oracle sigs + assemble + broadcast settle TX.
 *
 * Pool sigs schema (= mirrors 1V1 'oracle_tx_sig' chain_events):
 *   payload.t = 'kanet_pool_oracle_tx_sign_resp_v1'
 *   payload.market_id = market.id
 *   payload.voter_relay_id
 *   payload.input_index (= 0..N for spine + N sides)
 *   payload.signature
 *
 * Required sigs per input: 3 if unanimous, 2 if forfeit_1.
 * When all inputs reach required sig count, submit settle TX via maker_relay IPC.
 *
 * @param {object} market — pool_markets row in 'collecting_sigs' state
 */
async function handleCollectingSigs(market) {
  let meta;
  try { meta = JSON.parse(market.metadata || '{}'); } catch { meta = {}; }
  if (!meta.phase2_tx_obj || !meta.phase2_input_count) {
    console.warn(`[pool-settler:collecting] market=${market.id.slice(0,12)} missing phase2 metadata, skip`);
    return;
  }
  const inputCount = meta.phase2_input_count;
  // Spine P2SH has MULTIPLE UTXOs (1 maker stake + N oracle bonds) — inputs 0..spineInputCount-1.
  // Each spine input needs PoolSpine settle_unanimous scriptSig (3 sigs unanimous / 2 forfeit_1).
  // Side inputs (spineInputCount..end) auto-unlock via [selector_0 + side_redeem_push] (no sigs).
  const spineInputCount = meta.phase2_spine_input_count || 1;
  const spineRequiredSigs = meta.phase2_unanimous ? 3 : 2;
  const signingOracles = meta.phase2_unanimous
    ? [0, 1, 2]
    : [0, 1, 2].filter(i => i !== meta.phase2_silent_oracle_index);

  // Scan chain_events for sigs scoped to this market + spine input only
  const sigRows = sqlite.prepare(`
    SELECT payload FROM chain_events
    WHERE event_type = 'pool_oracle_tx_sig'
      AND payload LIKE ?
  `).all(`%"market_id":"${market.id}"%`);

  // sigsByInput[i] = [{voter_relay_id, signature}, ...] — only inputIdx=0 populated in pool
  const sigsByInput = Array.from({ length: inputCount }, () => []);
  const seenByInput = Array.from({ length: inputCount }, () => new Set());
  for (const row of sigRows) {
    try {
      const p = JSON.parse(row.payload || '{}');
      if (p.t !== 'kanet_pool_oracle_tx_sign_resp_v1') continue;
      const inputIdx = parseInt(p.input_index, 10);
      if (inputIdx < 0 || inputIdx >= inputCount) continue;
      if (!p.voter_relay_id || !p.signature) continue;
      if (seenByInput[inputIdx].has(p.voter_relay_id)) continue;
      seenByInput[inputIdx].add(p.voter_relay_id);
      sigsByInput[inputIdx].push({ voter_relay_id: p.voter_relay_id, signature: p.signature });
    } catch {}
  }

  // Gate on ALL spine inputs (0..spineInputCount-1) having required sig count.
  // Side inputs need no sigs (settled_via_spine entry).
  const spineMissing = [];
  for (let i = 0; i < spineInputCount; i++) {
    if (sigsByInput[i].length < spineRequiredSigs) {
      spineMissing.push(`input${i}=${sigsByInput[i].length}/${spineRequiredSigs}`);
    }
  }
  if (spineMissing.length > 0) {
    if (Math.random() < 0.1) {
      console.log(`[pool-settler:collecting] market=${market.id.slice(0,12)} waiting spine sigs: ${spineMissing.join(' ')}`);
    }
    return;
  }

  // Spine has required sigs. Load side data for TX assembly (= side_redeem_script_hex needed per side, v136+).
  const sides = sqlite.prepare(`
    SELECT side_p2sh, side_lock_tx, side_redeem_script_hex FROM pool_bettor_sides
    WHERE market_id = ? AND side_lock_tx IS NOT NULL
    ORDER BY merkle_index ASC
  `).all(market.id);

  if (!meta.spine_redeem_script_hex) {
    console.warn(`[pool-settler:collecting] market=${market.id.slice(0,12)} missing meta.spine_redeem_script_hex (= pre-v135 market or create-time omission), cannot assemble TX`);
    return;
  }
  if (!Array.isArray(meta.phase2_outputs) || !meta.phase2_outputs.length) {
    console.warn(`[pool-settler:collecting] market=${market.id.slice(0,12)} missing meta.phase2_outputs (= pre-2c step 2c dispatched), cannot assemble TX`);
    return;
  }
  if (sides.some(s => !s.side_redeem_script_hex)) {
    console.warn(`[pool-settler:collecting] market=${market.id.slice(0,12)} some sides missing side_redeem_script_hex (= pre-v136 registered), cannot assemble TX`);
    return;
  }

  // spineSigsByInput[i] = array of signatures for spine input i (= 3 sigs unanimous)
  const spineSigsByInput = [];
  for (let i = 0; i < spineInputCount; i++) {
    spineSigsByInput.push(sigsByInput[i].map(s => s.signature));
  }

  // Phase 2c step 2c first ship: unanimous (entry 0) only. forfeit_1 entry 1 deferred next iteration.
  if (!meta.phase2_unanimous) {
    console.warn(`[pool-settler:collecting] market=${market.id.slice(0,12)} forfeit_1 entry 1 not yet supported in unlockPoolSpineP2SH, skip until next iteration`);
    return;
  }

  // Rebuild full required_input_outpoints (= must match dispatchPhase2 ordering: spine + oracle bonds + sides)
  const depositRows = sqlite.prepare(`
    SELECT payload FROM chain_events
    WHERE event_type = 'pool_oracle_deposit' AND payload LIKE ?
  `).all(`%"market_id":"${market.id}"%`);
  const oracleDepositOutpoints = depositRows.map(r => {
    const p = JSON.parse(r.payload);
    return { outpointTxid: p.deposit_tx, outpointIndex: 0 };
  });
  const requiredInputOutpoints = [
    { outpointTxid: market.spine_lock_tx, outpointIndex: 0 },
    ...oracleDepositOutpoints,
    ...sides.map(s => ({ outpointTxid: s.side_lock_tx, outpointIndex: 0 })),
  ];

  console.log(`[pool-settler:collecting] market=${market.id.slice(0,12)} attempting settle TX submit (spine_inputs=${spineInputCount}, sides=${sides.length}, signers=${signingOracles.join(',')})`);

  try {
    const submitResult = await sendCommandAsync(market.maker_relay_id, {
      type: 'pool_settle_tx',
      spine_p2sh_address: market.spine_p2sh,
      side_p2sh_addresses: sides.map(s => s.side_p2sh),
      spine_redeem_script_hex: meta.spine_redeem_script_hex,
      side_redeem_script_hexes: sides.map(s => s.side_redeem_script_hex),
      required_input_outpoints: requiredInputOutpoints,
      outputs: meta.phase2_outputs,
      spine_input_count: spineInputCount,
      spine_sigs_by_input: spineSigsByInput,
      winner: meta.phase2_winner,
      sides_merkle_root: market.sides_merkle_root,
      unanimous: meta.phase2_unanimous,
      tx_obj_preimage: meta.phase2_tx_obj,
    });

    if (!submitResult?.ok || !submitResult.txId) {
      console.error(`[pool-settler:collecting] pool_settle_tx submit fail market=${market.id.slice(0,12)}: ${submitResult?.error}`);
      return;
    }

    sqlite.prepare('UPDATE pool_markets SET settle_txid = ?, protocol_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(submitResult.txId, 'completed', market.id);
    console.log(`[pool-settler:collecting] SETTLED market=${market.id.slice(0,12)} settle_txid=${submitResult.txId.slice(0,16)} winner=${meta.phase2_winner}`);
  } catch (e) {
    console.error(`[pool-settler:collecting] settle submit exception market=${market.id?.slice(0,12)}: ${e.message}`);
  }
}
