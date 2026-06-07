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
import * as poolSource from '../lib/oracle-pool-source.mjs';  // J2-tn r349 (Owner 钦定 oracle pool 单一源访问器).
import {
  deriveCommitteeSeed,
  selectCommittee,
  COMMITTEE_SIZE,
} from './pool-committee-sampler.mjs';

const THRESHOLD = 4; // 4-of-5 (Bettor r19 + J2 r104 lock)
// J1tn r303 P0-#1 fix (Bettor r299+r300 钦定 不焊死 动态): 此 const 仅 v06 unit test 用 (= production
// runtime fee 走 pool-market-settler.js dispatchPhase2 KIP-9 storage-mass-aware 动态版). 保留 5M
// absolute floor 同 pool-market-settler.js, 不焊死高值.
const MIN_BROKER_FEE_SOMPI = 5_000_000; // 0.05 KAS (mirrors v0.5 MIN_BROKER_FEE_SOMPI in pool-market-settler.js:42)

// Bettor r48 F-S1 residual: chain tip blocks can be reorged. Require finality_depth
// confirmation (= picked block at least N blocks deep from current tip) so that two
// verifiers querying at different times converge to the same hash. testnet: 50 default.
const DEFAULT_FINALITY_DEPTH = 50;

/**
 * F-S1 canonical rule (Bettor r44 + r48 close gate ①):
 *
 *   endBlockHash = hash of the FIRST block on the selected-parent chain whose daaScore
 *                  is >= market.deadline_daa_score AND has reached finality depth.
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
 * Bettor r48 F-S1 residual fix: require finality_depth so the picked block is reorg-safe.
 *
 * @param {object} chainReader - {
 *     getBlocksFromDaaScore: (minDaa) => Promise<[{ hash, daaScore }]>,
 *     getCurrentDaaScore: () => Promise<number>
 *   }
 * @param {number} deadlineDaaScore
 * @param {number} [finalityDepth=DEFAULT_FINALITY_DEPTH]
 * @returns {Promise<{ hash: string, block_daa: number, finality_depth_actual: number }>}
 */
export async function fetchEndBlockHashCanonical(chainReader, deadlineDaaScore, finalityDepth = DEFAULT_FINALITY_DEPTH) {
  describeEndBlockRule(deadlineDaaScore); // validates input
  if (typeof chainReader.getCurrentDaaScore !== 'function') {
    throw new Error('chainReader.getCurrentDaaScore() → Promise<number> required (F-S1 finality depth check)');
  }
  if (!Number.isInteger(finalityDepth) || finalityDepth < 0) {
    throw new Error(`finalityDepth must be non-negative integer, got ${finalityDepth}`);
  }
  // J2-tn r332 (Bettor r... 正解): SPC-only fail-closed. 无 ring buffer fallback.
  // committee endBlock 唯一实相 = SPC (共识). ring buffer = 本地态, 任何 fallback 到它 = 重新
  // 引入分歧 (= J1 r306 + Bettor 抓 :3200 mismatch 真因). fail-closed 等同步, 不 fallback.
  if (typeof chainReader.getBlockAtDaa !== 'function') {
    throw new Error('chainReader.getBlockAtDaa(minDaa) → Promise<{hash,daaScore}> required (SPC-only, no fallback)');
  }
  const first = await chainReader.getBlockAtDaa(deadlineDaaScore);
  if (!first || !first.hash) {
    throw new Error(`getBlockAtDaa returned no block at daaScore=${deadlineDaaScore} — SPC walk未达 deadlineDaa (chain not progressed OR walk cap). retry next tick.`);
  }
  if (!first.hash || typeof first.hash !== 'string' || first.hash.length !== 64) {
    throw new Error(`endBlock hash must be 64-char hex, got: ${first.hash}`);
  }
  const currentDaa = await chainReader.getCurrentDaaScore();
  if (!Number.isFinite(currentDaa) || currentDaa < first.daaScore) {
    throw new Error(`current chain daaScore ${currentDaa} < picked block daaScore ${first.daaScore} (chain rewinded?)`);
  }
  const actualDepth = currentDaa - first.daaScore;
  if (actualDepth < finalityDepth) {
    throw new Error(`F-S1 finality: picked block depth ${actualDepth} < required ${finalityDepth} (anti-reorg gate). Retry after chain advances ${finalityDepth - actualDepth} more blocks.`);
  }
  return { hash: first.hash, block_daa: first.daaScore, finality_depth_actual: actualDepth };
}

/**
 * ensurePoolSnapshot — create market entry-point helper (J1 r147 + Bettor r52 contract).
 *
 * Called by pool.js create-v06 endpoint at market create time. Owns:
 *   - SELECT active oracle_pool_membership ORDER BY oracle_pk ASC (= canonical match sampler)
 *   - Derive poolMerkleRoot via buildPoolMerkleTree
 *   - Verify derived root == expected (caller provides root that's baked into spine ctor)
 *   - INSERT into pool_snapshots (= freeze membership + stake @ create time, F-S3 anti-grinding)
 *
 * Bettor r52 2-nail format trace:
 *   (A) pool_stakes_json sompi integer strings, same order as pool_pks (NOT KAS float)
 *   (B) loadPoolSnapshot asserts pool_stakes.length == pool_size
 *
 * J1 r147 contract: throws on root mismatch (= caller drift / TOCTOU defense).
 *
 * @returns {{ pool_size: number, pool_merkle_root: string, members: [{pk, stake_sompi}] }}
 */
/**
 * G6 批 3 段① T2 sediment (Owner DoD #1.1): derive pool_merkle_root from current DB state
 * without comparing to expected. KANet-UI / caller uses this to fetch the "right now" root
 * before create-v06/v07. Decouples derive (= read current pool) from verify (= TOCTOU defense
 * in ensurePoolSnapshot). For mainnet caller passes the pinned root; for testnet caller can
 * read this fresh + pass through (= no TOCTOU since solo-tester is the only writer).
 *
 * @returns {{ pool_merkle_root: string, pool_size: number, members: [{pk, stake_sompi}] }}
 */
export function derivePoolMerkleRoot(snapshotDaa = null) {
  // DoD §2.2 J2 step [2] dual-read (5-agent 共识 KANet-UI r484/3): chain_view 单一读源 +
  // 7-day grace fallback to oracle_pool_membership. Priority: chain_view > legacy DB.
  //
  // Bettor r277 catch: 跨节点确定性必 take EXPLICIT snapshotDaa, 不能 latest (= 节点A scanner
  // @ daaX, 节点B @ daaY, latest 不同 root). Caller (= create-v07) 先 fetch currentDaa 算
  // snapshotDaa=currentDaa−FINALITY_N, 然后 call derivePoolMerkleRoot(snapshotDaa) → 各节点
  // 同 daa 必同 root 满足协议不变量 ctor root == derive(snapshotDaa).
  //
  // snapshotDaa=null (= legacy/grace period) → fallback 旧 oracle_pool_membership 路径,
  // 不查 chain_view (= 避免 latest 跨节点漂移).
  if (snapshotDaa !== null) {
    try {
      const row = sqlite.prepare(
        'SELECT snapshot_daa, leaves_json, merkle_root, pool_size FROM oracle_pool_chain_view WHERE snapshot_daa = ?'
      ).get(snapshotDaa);
      if (row && row.pool_size > 0) {
        const leaves = JSON.parse(row.leaves_json);
        return {
          pool_merkle_root: row.merkle_root,
          pool_size: row.pool_size,
          members: leaves.map(l => ({ pk: l.pk_x, stake_sompi: l.stake_sompi })),
          source: 'chain_view',
          snapshot_daa: row.snapshot_daa,
        };
      }
      throw new Error(`no chain_view cached at snapshot_daa=${snapshotDaa} (= caller must call scanAndDerivePool first OR adjust snapshotDaa to N=600 below currentDaa)`);
    } catch (e) {
      if (e.message.includes('no chain_view cached')) throw e;
      // Table may not exist on pre-v162 DB; fall through to legacy ONLY if grace mode (= no snapshotDaa).
      console.warn(`[derivePoolMerkleRoot] chain_view read fail at daa=${snapshotDaa}: ${e.message}`);
      throw e;
    }
  }

  // J2-tn r390 (#21 B Bettor ③ APPROVE 04:33): 删 LEGACY FALLBACK 到 oracle_pool_membership.
  // NWT canonical decision r315: chain_view (= scanner cache 派生自 enrollments) 是 canonical
  // pool source. membership 是死表 v164 已清. 7-day grace period 早已过, 无 active rows.
  // fail-fast 替代 silent return (= Bettor 03:09 别 silent 假绿 spirit). 若 chain_view 缺
  // → 主路径已 throw 'no chain_view cached', 不需此 fallback.
  throw new Error('chain_view empty + LEGACY FALLBACK removed (#21 B r390): canonical oracle pool source is oracle_pool_chain_view (derived from oracle_stake_enrollments). 若 chain_view 空 = scanner 异常 OR 链上无 enrollments, 需修主因 (= 重启 scanner OR 查 oracle_stake_enrollments).');
}

export function ensurePoolSnapshot(marketId, expectedPoolMerkleRoot, snapshotDaa = null) {
  if (!marketId || typeof marketId !== 'string') throw new Error('marketId required (string)');
  const cleanExpected = (expectedPoolMerkleRoot || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleanExpected)) {
    throw new Error(`expectedPoolMerkleRoot must be 64-char hex (got ${cleanExpected.length} chars)`);
  }
  // Bettor r449 派工 (b): chain_view branch — settle 必同 daa 重派生守跨节点不变量.
  // 若 caller 传 snapshotDaa, 从 oracle_pool_chain_view 读 leaves/root 比 expected, 落
  // pool_snapshots 加 snapshot_daa 列持久化 (v163 migrate). 跳过 legacy oracle_pool_membership.
  if (snapshotDaa !== null) {
    const row = sqlite.prepare(
      'SELECT snapshot_daa, leaves_json, merkle_root, pool_size FROM oracle_pool_chain_view WHERE snapshot_daa = ?'
    ).get(snapshotDaa);
    if (!row) throw new Error(`no chain_view cached at snapshot_daa=${snapshotDaa}; caller must call scanAndDerivePool first`);
    if (row.merkle_root.toLowerCase() !== cleanExpected) {
      throw new Error(`chain_view root mismatch at snapshot_daa=${snapshotDaa}: derived=${row.merkle_root} expected=${cleanExpected}`);
    }
    const leaves = JSON.parse(row.leaves_json);
    const chainPks = leaves.map(l => String(l.pk_x).toLowerCase());
    const chainStakes = leaves.map(l => String(l.stake_sompi));
    sqlite.prepare(`
      INSERT OR REPLACE INTO pool_snapshots
        (market_id, pool_merkle_root, pool_size, pool_pks_json, pool_stakes_json, snapshot_at, protocol_version, snapshot_daa)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'v0.7', ?)
    `).run(
      marketId, row.merkle_root, row.pool_size,
      JSON.stringify(chainPks), JSON.stringify(chainStakes),
      snapshotDaa
    );
    return {
      pool_size: row.pool_size,
      pool_merkle_root: row.merkle_root,
      members: leaves.map(l => ({ pk: l.pk_x, stake_sompi: l.stake_sompi })),
      source: 'chain_view',
      snapshot_daa: snapshotDaa,
    };
  }
  // J2-tn r390 (#21 B Bettor ③ APPROVE 04:33): 删 ensurePoolSnapshot legacy fallback path.
  // 主路径 chain_view 已 canonical. snapshotDaa=null 路径 (= legacy) 只该走 chain_view, 不
  // 再 fallback 读废弃表. 同 derivePoolMerkleRoot fail-fast pattern.
  throw new Error('chain_view path required (#21 B r390): ensurePoolSnapshot legacy oracle_pool_membership fallback removed. Use snapshotDaa-based path via chain_view (= canonical pool source).');
  // unreachable below — left for context if 7-day grace branch resurrected
  const rawMembers = [];
  // Bettor r55 F-A1 fix: pair (pk,stake) BEFORE sorting, so stake stays attached to its pk
  // regardless of DB storage case (= alignment robust against mixed-case oracle_pk inserts).
  // KAS float → sompi integer string (Bettor r52 (A) sompi-unit format) computed per-pair.
  const paired = rawMembers.map(m => ({
    pk: m.oracle_pk.toLowerCase(),
    stake_sompi: BigInt(Math.round(Number(m.stake_locked_kas) * 1e8)).toString(),
  })).sort((a, b) => a.pk < b.pk ? -1 : (a.pk > b.pk ? 1 : 0));
  const pks = paired.map(p => p.pk);
  const stakesSompi = paired.map(p => p.stake_sompi);
  // Derive merkle root (= buildPoolMerkleTree re-sorts internally; result.sortedPks must equal pks here)
  const tree = buildPoolMerkleTree(pks);
  // Sanity (= regression guard against Bettor F-A1): tree.sortedPks must equal our pre-sorted pks
  for (let i = 0; i < pks.length; i++) {
    if (tree.sortedPks[i] !== pks[i]) {
      throw new Error(`F-A1 alignment regression: position ${i} pks=${pks[i].slice(0,12)}.. tree.sortedPks=${tree.sortedPks[i].slice(0,12)}..`);
    }
  }
  const derivedRoot = tree.root.toString('hex');
  if (derivedRoot !== cleanExpected) {
    throw new Error(`pool_merkle_root mismatch: derived=${derivedRoot} expected=${cleanExpected} (= caller drifted from current pool state; rebuild ctor from current pool)`);
  }
  // INSERT OR REPLACE (idempotent re-snapshot OK, same content)
  sqlite.prepare(`
    INSERT OR REPLACE INTO pool_snapshots
      (market_id, pool_merkle_root, pool_size, pool_pks_json, pool_stakes_json, snapshot_at, protocol_version)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'v0.6')
  `).run(
    marketId,
    derivedRoot,
    pks.length,
    JSON.stringify(pks),
    JSON.stringify(stakesSompi),
  );
  return {
    pool_size: pks.length,
    pool_merkle_root: derivedRoot,
    members: paired.map(p => ({ pk: p.pk, stake_sompi: p.stake_sompi })),
  };
}

/**
 * Load pool snapshot for a market (= what pool was at market create time).
 * Bettor r48 F-S3 fix: returns pool_stakes too (= stake snapshot @ create, anti-grinding).
 * Bettor r52 (B) fail-fast: assert pool_stakes.length == pool_size.
 * Returns { pool_merkle_root, pool_size, pool_pks, pool_stakes } sorted by pk_hex ascending.
 */
export function loadPoolSnapshot(marketId) {
  const row = sqlite.prepare(
    'SELECT pool_merkle_root, pool_size, pool_pks_json, pool_stakes_json FROM pool_snapshots WHERE market_id = ?'
  ).get(marketId);
  if (!row) throw new Error(`no pool_snapshot for market ${marketId}`);
  const pks = JSON.parse(row.pool_pks_json);
  if (!Array.isArray(pks) || pks.length !== row.pool_size) {
    throw new Error(`pool_snapshot ${marketId} corrupt: size=${row.pool_size} pks=${pks?.length}`);
  }
  const stakes = row.pool_stakes_json ? JSON.parse(row.pool_stakes_json) : null;
  if (!stakes || !Array.isArray(stakes)) {
    throw new Error(`pool_snapshot ${marketId} missing pool_stakes_json (= v161 migration applied? snapshot built post-fix?)`);
  }
  // Bettor r52 (B) fail-fast: pool_stakes must have same length as pool_size + pool_pks
  if (stakes.length !== row.pool_size || stakes.length !== pks.length) {
    throw new Error(`pool_snapshot ${marketId} length mismatch: pool_size=${row.pool_size} pks=${pks.length} stakes=${stakes.length}`);
  }
  return { pool_merkle_root: row.pool_merkle_root, pool_size: row.pool_size, pool_pks: pks, pool_stakes: stakes };
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
  // Bettor r48 F-S3 fix: weight by stake SNAPSHOTTED @ create (= seed unknown then), NOT
  // current stake @ sample (= seed-aware grinding window opens after endBlockHash visible).
  // pool_pks + pool_stakes are aligned arrays in sortedPks order.
  const seed = deriveCommitteeSeed(marketId, endBlockHash, snapshot.pool_merkle_root);
  const sampling = selectCommittee(
    snapshot.pool_pks.map((pk, i) => ({ pk_hex: pk, stake_sompi: BigInt(snapshot.pool_stakes[i]) })),
    seed
  );
  // J2-tn r349 (Owner 6/5 钦定 oracle-pool-source 焊死): pkToAddress 走访问器
  // (= canonical 单一源 oracle_stake_enrollments, fallback membership 防 stopgap).
  // 任何 settler/pool/UI reader 必经访问器, 防 r348 同根因散落.
  // 同步 import 因 sampleAndStoreCommittee 不是 async function (不能 await).
  const { resolveOracleAddresses } = poolSource;
  const pkToAddress = resolveOracleAddresses(snapshot.pool_pks);
  const committeeAddresses = sampling.selected.map(s => pkToAddress.get(s.pk_hex) || null);
  if (committeeAddresses.some(a => !a)) throw new Error('sampling produced PK without relay_address (= enrollments 缺, 需 re-enroll OR envelope v2 backfill)');
  const committeePks = sampling.selected.map(s => s.pk_hex);
  const committeePkHash = deriveCommitteePkHash(committeePks).toString('hex');
  // committee_relay_ids field 复用存 addresses (= dispatchPhase2 L697 适配读 addr).
  const committeeRelayIds = committeeAddresses;
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
  // Balance invariant (= J1 r142 sanity, Bettor r48 F-P1 fix: all BigInt to avoid Number > 2^53 precision loss):
  let totalIn = BigInt(makerStakeSompi);
  for (const b of bettors) totalIn += BigInt(b.stake_sompi);
  totalIn += BigInt(COMMITTEE_SIZE) * BigInt(oracleBondSompi);
  const totalWinnerOut = winnerPayouts.reduce((s, w) => s + BigInt(w.payout_sompi), 0n);
  const totalCommitteeOut = BigInt(COMMITTEE_SIZE) * (BigInt(oracleBondSompi) + oracleFeePerCommittee);
  const totalOut = totalWinnerOut + totalCommitteeOut + brokerFee + minerFee;
  // Bettor r48 F-P3 fix: dust from BOTH winner pro-rata (< numWinners) + oracleFee/N (< COMMITTEE_SIZE).
  // tolerance = numWinners + COMMITTEE_SIZE covers both rounding residues.
  const diff = totalIn - totalOut;
  const tolerance = BigInt(winnerPayouts.length + COMMITTEE_SIZE);
  if (diff < -tolerance || diff > tolerance) {
    throw new Error(`balance invariant fail: in=${totalIn} out=${totalOut} diff=${diff} (tolerance ${tolerance})`);
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
