// v0.6 path A pool market settler (Bettor r42 spec + J1 r142 v0.5 fee model carryover).
//
// J2 r113/r114 → r115 c974028 (J2.2+J2.3 sampler) → THIS module:
//   - F-S1 fix: endBlockHash canonical rule (Bettor r44 close gate ①)
//   - sample & persist committee (= 5 oracles selected at market END, not at create)
//   - compute v0.6 payouts (= 5 committee instead of v0.5 3 oracle, fee model carried)
//   - build settle_aggregate args (= match PoolSpine_v06.sil ctor + entry signature)
//
// What this module owns (= Console-side pure logic):
//   - deterministic chain interpretation (canonical rules)
//   - committee sampling orchestration (uses pool-committee-sampler)
//   - fee math (= v0.5 computePoolPayouts adapted)
//   - TX argument assembly
//
// What this module does NOT own (= relay-side IPC follow-up):
//   - actual RPC chain queries (= relay get_block_at_daa cmd)
//   - committee signature collection (= relay get_oracle_sigs IPC)
//   - actual TX submission (= relay submitTransaction)
//
// Bettor r44 F-S1 (close gate ①): endBlockHash MUST be derived by canonical chain rule —
// 不是 maker 自由给 (= maker grinding → 选拔被攻击). Rule defined here, fetcher signature
// guarantees it's never maker-controlled.

import { blake2b } from '@noble/hashes/blake2b';
import { sqlite } from '../db/client.js';
import { buildPoolMerkleTree, deriveCommitteePkHash } from './pool-merkle-v06.mjs';
import {
  deriveCommitteeSeed,
  selectCommittee,
  COMMITTEE_SIZE,
} from './pool-committee-sampler.mjs';

const THRESHOLD = 4; // 4-of-5 (Bettor r19 + J2 r104 lock)
const MIN_BROKER_FEE_SOMPI = 5_000_000; // 0.05 KAS (mirrors v0.5 MIN_BROKER_FEE_SOMPI in pool-market-settler.js:42)

/**
 * F-S1 canonical rule (Bettor r44 close gate ①):
 *
 *   endBlockHash = hash of the FIRST block on the selected-parent chain whose daaScore
 *                  is >= market.deadline_daa_score.
 *
 * Why this is anti-grinding:
 *   - market.deadline is set at create time (= maker-controlled value).
 *   - At create time, the future block at daaScore >= deadline is UNKNOWN (= depends on
 *     future block production, miner choices, network propagation).
 *   - maker cannot influence which block has the first-crossing daaScore short of
 *     controlling >50% mining hash power AND timing precisely (= testnet-implausible,
 *     mainnet-expensive). Even then, attacker cannot pick a SPECIFIC hash; must rely on
 *     random output of the canonical selection function.
 *   - Anyone can re-derive: given the deadline DAA score and chain state, the first
 *     block crossing the threshold is deterministic.
 *
 * Implementer constraint:
 *   - This module MUST receive endBlockHash from an authorized chain reader, never from
 *     a settable market field. Relay-side IPC fetcher signs that the value came from
 *     RpcClient.getBlock/getBlocks query, not user input.
 *
 * @param {number} deadlineDaaScore - market.deadline (DAA score integer)
 * @returns {{ rule: string, deadline_daa: number }}
 */
export function describeEndBlockRule(deadlineDaaScore) {
  if (!Number.isFinite(deadlineDaaScore) || deadlineDaaScore <= 0) {
    throw new Error(`deadlineDaaScore must be positive integer, got ${deadlineDaaScore}`);
  }
  return {
    rule: 'first_block_with_daa_score_ge_deadline',
    deadline_daa: deadlineDaaScore,
    description: 'endBlockHash = hash of first block on selected-parent chain with daaScore >= deadline_daa. Anti-grinding: future block unknowable at market create time.',
  };
}

/**
 * Fetch endBlockHash from chain via injected reader (= relay IPC).
 *
 * @param {object} chainReader - { getBlocksFromDaaScore: (minDaa) => Promise<[{ hash, daaScore }]> }
 * @param {number} deadlineDaaScore
 * @returns {Promise<{ hash: string, block_daa: number }>}
 */
export async function fetchEndBlockHashCanonical(chainReader, deadlineDaaScore) {
  describeEndBlockRule(deadlineDaaScore); // validates input
  if (!chainReader || typeof chainReader.getBlocksFromDaaScore !== 'function') {
    throw new Error('chainReader.getBlocksFromDaaScore(minDaa) → Promise<[{hash,daaScore}]> required');
  }
  const blocks = await chainReader.getBlocksFromDaaScore(deadlineDaaScore);
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error(`no blocks at daaScore >= ${deadlineDaaScore} (= deadline not reached on chain)`);
  }
  // Take first block crossing the threshold (= canonical "earliest selection").
  // chain reader is expected to return blocks sorted by daaScore ascending.
  const first = blocks.find(b => b.daaScore >= deadlineDaaScore);
  if (!first) {
    throw new Error(`chainReader returned blocks but none crossed daaScore ${deadlineDaaScore}`);
  }
  if (!first.hash || typeof first.hash !== 'string' || first.hash.length !== 64) {
    throw new Error(`endBlock hash must be 64-char hex, got: ${first.hash}`);
  }
  return { hash: first.hash, block_daa: first.daaScore };
}

/**
 * Load pool snapshot for a market (= what pool was at market create time).
 * Returns { pool_merkle_root, pool_size, pool_pks } where pool_pks is sorted.
 */
export function loadPoolSnapshot(marketId) {
  const row = sqlite.prepare(
    'SELECT pool_merkle_root, pool_size, pool_pks_json FROM pool_snapshots WHERE market_id = ?'
  ).get(marketId);
  if (!row) throw new Error(`no pool_snapshot for market ${marketId}`);
  const pks = JSON.parse(row.pool_pks_json);
  if (!Array.isArray(pks) || pks.length !== row.pool_size) {
    throw new Error(`pool_snapshot ${marketId} corrupt: size=${row.pool_size} pks=${pks?.length}`);
  }
  return { pool_merkle_root: row.pool_merkle_root, pool_size: row.pool_size, pool_pks: pks };
}

/**
 * Sample committee at market end + persist to pool_committee.
 *
 * Caller must:
 *   - Have called fetchEndBlockHashCanonical() to get endBlockHash (NOT from market metadata).
 *   - Have pool_snapshots row already inserted at market create time.
 *
 * @param {string} marketId
 * @param {string} endBlockHash - 64-char hex (from canonical fetch)
 * @returns {object} - { selected, proof, committee_pk_hash, threshold } persisted row shape
 */
export function sampleAndStoreCommittee(marketId, endBlockHash) {
  const snapshot = loadPoolSnapshot(marketId);
  // Snapshot stored only PKs; need stake info from oracle_pool_membership at sample time.
  // Note: stake AT SAMPLE TIME determines weight (= current stake state, not create-time).
  // Bettor r42 1/4 reads "freeze pool snapshot" applies to MEMBERSHIP (= who's eligible) only;
  // stake-weighting can use current stake. This avoids snapshotting stake which could be
  // gamed by maker (= snapshot stake at create when known maker had min stake, gain stake
  // before sample). Discuss with Bettor if pure pool snapshot incl stake is required.
  const members = sqlite.prepare(`
    SELECT relay_id, oracle_pk, stake_locked_kas
    FROM oracle_pool_membership
    WHERE active = 1 AND oracle_pk IN (${snapshot.pool_pks.map(() => '?').join(',')})
  `).all(...snapshot.pool_pks);
  if (members.length < COMMITTEE_SIZE) {
    throw new Error(`pool active members ${members.length} < ${COMMITTEE_SIZE} (snapshot pool_size=${snapshot.pool_size})`);
  }
  const seed = deriveCommitteeSeed(marketId, endBlockHash, snapshot.pool_merkle_root);
  const sampling = selectCommittee(
    members.map(m => ({ pk_hex: m.oracle_pk, stake_sompi: BigInt(Math.round(Number(m.stake_locked_kas) * 1e8)) })),
    seed
  );
  // Resolve relay_ids in same order as sampled.selected
  const pkToRelay = new Map(members.map(m => [m.oracle_pk.toLowerCase(), m.relay_id]));
  const committeeRelayIds = sampling.selected.map(s => pkToRelay.get(s.pk_hex));
  if (committeeRelayIds.some(r => !r)) throw new Error('sampling produced PK not in membership snapshot');
  const committeePks = sampling.selected.map(s => s.pk_hex);
  const committeePkHash = deriveCommitteePkHash(committeePks).toString('hex');
  // Persist (idempotent: replace if same market re-sampled)
  sqlite.prepare(`
    INSERT OR REPLACE INTO pool_committee
      (market_id, committee_relay_ids, committee_pks, committee_pk_hash, vrf_seed, vrf_proof, threshold, sampled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    marketId,
    JSON.stringify(committeeRelayIds),
    JSON.stringify(committeePks),
    committeePkHash,
    seed.toString('hex'),
    JSON.stringify(sampling.proof),
    THRESHOLD,
  );
  return {
    market_id: marketId,
    committee_relay_ids: committeeRelayIds,
    committee_pks: committeePks,
    committee_pk_hash: committeePkHash,
    vrf_seed: seed.toString('hex'),
    vrf_proof: sampling.proof,
    threshold: THRESHOLD,
  };
}

/**
 * Load committee for a market from pool_committee.
 */
export function loadCommittee(marketId) {
  const row = sqlite.prepare('SELECT * FROM pool_committee WHERE market_id = ?').get(marketId);
  if (!row) return null;
  return {
    market_id: row.market_id,
    committee_relay_ids: JSON.parse(row.committee_relay_ids),
    committee_pks: JSON.parse(row.committee_pks),
    committee_pk_hash: row.committee_pk_hash,
    vrf_seed: row.vrf_seed,
    vrf_proof: JSON.parse(row.vrf_proof),
    threshold: row.threshold,
  };
}

/**
 * v0.6 payout computation (= 5 committee adapted from v0.5 computePoolPayouts).
 *
 * Inputs:
 *   - makerStakeSompi, brokerFeePct (bps), oracleFeePct (bps), oracleBondSompi, minerFeeSompi
 *   - winner: 0 (YES) or 1 (NO)
 *   - bettors: [{ pk, direction (0|1), stake_sompi }]
 *
 * Algorithm (= follows v0.5 J1 r141 verified, with N=5 oracle):
 *   - losersStake = sum bettors WHERE direction != winner (+ maker_stake if maker on losing side)
 *   - winnersStake = sum bettors WHERE direction == winner (+ maker_stake if maker on winning side)
 *   - Note v0.5 assumes maker is on losing side (= maker is the OPPOSING party); for v0.6 unify
 *     by treating maker as a virtual bettor on opposite of winner (Bettor r42 3/4 model).
 *   - losingPool = losersStake_total
 *   - distributable = losingPool - minerFeeSompi - brokerFeeSompi - oracleFeeTotal
 *   - winners get: own_stake + (distributable × own_stake / winnersStake) (pro-rata)
 *
 * Returns { brokerFee, oracleFeeTotal, oracleFeePerCommittee, winnerPayouts, minerFee, totalIn, totalOut }
 */
export function computeV06Payouts(args) {
  const {
    makerStakeSompi,
    makerDirection, // 0 or 1 (= maker takes opposite of winner ≡ losing side)
    brokerFeePct,
    oracleFeePct,
    oracleBondSompi,
    minerFeeSompi,
    winner,
    bettors,
  } = args;

  if (winner !== 0 && winner !== 1) throw new Error('winner must be 0 (YES) or 1 (NO)');
  if (makerDirection !== 0 && makerDirection !== 1) throw new Error('makerDirection must be 0 or 1');
  if (!Array.isArray(bettors)) throw new Error('bettors must be array');

  // Compose maker as a virtual bettor on its direction.
  const allBettors = [{ pk: '__maker__', direction: makerDirection, stake_sompi: BigInt(makerStakeSompi) }];
  for (const b of bettors) {
    allBettors.push({ pk: b.pk, direction: b.direction, stake_sompi: BigInt(b.stake_sompi) });
  }

  let losersStake = 0n;
  let winnersStake = 0n;
  for (const b of allBettors) {
    if (b.direction === winner) winnersStake += b.stake_sompi;
    else losersStake += b.stake_sompi;
  }
  if (winnersStake === 0n) throw new Error('no winning side participants — pool not settleable');
  if (losersStake === 0n) throw new Error('no losing side — distributable would be 0, market degenerate');

  const losingPool = losersStake;
  const minerFee = BigInt(minerFeeSompi);
  // Broker fee: max(losingPool × pct / 10000, MIN_BROKER_FEE)
  const calcBrokerFee = (losingPool * BigInt(brokerFeePct)) / 10000n;
  const brokerFee = calcBrokerFee > BigInt(MIN_BROKER_FEE_SOMPI) ? calcBrokerFee : BigInt(MIN_BROKER_FEE_SOMPI);
  // Oracle fee: losingPool × oracleFeePct / 10000, split into N=5 (committee size)
  const oracleFeeTotal = (losingPool * BigInt(oracleFeePct)) / 10000n;
  const oracleFeePerCommittee = oracleFeeTotal / BigInt(COMMITTEE_SIZE);

  if (losingPool < brokerFee + minerFee + oracleFeeTotal) {
    throw new Error(`losingPool ${losingPool} < fees (broker=${brokerFee} + miner=${minerFee} + oracle=${oracleFeeTotal}) — market unsettlable`);
  }
  const distributable = losingPool - minerFee - brokerFee - oracleFeeTotal;

  // Winner payouts: each winner gets own_stake + pro-rata share of distributable
  const winnerPayouts = [];
  for (const w of allBettors) {
    if (w.direction !== winner) continue;
    const share = (distributable * w.stake_sompi) / winnersStake;
    winnerPayouts.push({
      pk: w.pk,
      stake_sompi: w.stake_sompi.toString(),
      payout_sompi: (w.stake_sompi + share).toString(),
    });
  }
  // Balance invariant (= J1 r142 sanity): outputs + minerFee == inputs
  const totalIn = makerStakeSompi + bettors.reduce((s, b) => s + Number(b.stake_sompi), 0)
    + COMMITTEE_SIZE * Number(oracleBondSompi);
  const totalWinnerOut = winnerPayouts.reduce((s, w) => s + BigInt(w.payout_sompi), 0n);
  const totalCommitteeOut = BigInt(COMMITTEE_SIZE) * (BigInt(oracleBondSompi) + oracleFeePerCommittee);
  const totalOut = totalWinnerOut + totalCommitteeOut + brokerFee + minerFee;
  if (BigInt(totalIn) !== totalOut) {
    // Rounding from division; tolerate residue <= COMMITTEE_SIZE (= oracleFee rounding remainder)
    const diff = BigInt(totalIn) - totalOut;
    if (diff < -BigInt(COMMITTEE_SIZE) || diff > BigInt(COMMITTEE_SIZE)) {
      throw new Error(`balance invariant fail: in=${totalIn} out=${totalOut} diff=${diff}`);
    }
  }

  return {
    brokerFee: brokerFee.toString(),
    oracleFeeTotal: oracleFeeTotal.toString(),
    oracleFeePerCommittee: oracleFeePerCommittee.toString(),
    winnerPayouts,
    minerFee: minerFee.toString(),
    distributable: distributable.toString(),
    losingPool: losingPool.toString(),
    winnersStake: winnersStake.toString(),
  };
}

export { THRESHOLD, COMMITTEE_SIZE, MIN_BROKER_FEE_SOMPI };
