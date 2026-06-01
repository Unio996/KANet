// pool-p2sh-v07.mjs — Node-side ctor builder + P2SH derivation for PoolSpine_v07.sil + PoolSide_v07.sil.
//
// v0.7 differences from v0.6:
// - Spine ctor gains 3 sharding fields (shard_id / shard_count / market_id) for multi-shard markets.
//   For single-shard markets (G6 批 3 段① 最小 wire): shard_id=0, shard_count=1, market_id=raw bytes
//   of pool_markets.id (= same logical market for all shards in batch3 future).
// - Spine refund_maker_unjoined entry 2 uses fee 范围 [MIN_FEE=50_000, MAX_FEE=100M] not focused
//   ctor minerFee (G6 批 2 红线 8 root fix, qlfpv 100 KAS brick sediment).
// - Side ctor unchanged from v0.6 (6 params: bettorPk/spineP2shHash/poolMerkleRoot/marketMetadataHash/
//   direction/deadline). v0.7 just gains fee 范围 in claim_winner / refund_market_cancelled entries.
//
// Reuses pool-p2sh.mjs helpers (single source of truth, no drift).

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blake2b } from '@noble/hashes/blake2b';
import {
  bytes32Expr,
  intExpr,
  validatePubkeyHex,
  validateHashHex,
  validateInt,
  compileAndComputeP2SH,
} from './pool-p2sh.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SPINE_V07_SIL = process.env.POOL_SPINE_V07_SIL_PATH || join(__dirname, 'PoolSpine_v07.sil');
const SIDE_V07_SIL = process.env.POOL_SIDE_V07_SIL_PATH || join(__dirname, 'PoolSide_v07.sil');

/**
 * Compute PoolSpine_v07 P2SH address + redeem script.
 *
 * Ctor order MUST match PoolSpine_v07.sil L69-84 (13 params):
 *   (makerPk, brokerPk, poolMerkleRoot, deadline, minerFee, brokerFeePct, oracleFeePct,
 *    oracleBondAmount, makerStakeAmount, marketMetadataHash, shard_id, shard_count, market_id)
 *
 * Single-shard wire (G6 批3 段①): shard_id=0, shard_count=1.
 * market_id: 32-byte raw bytes of pool_markets.id (= utf-8 encode, pad/truncate to 32).
 *
 * @returns {{ p2shAddr, redeemScript, p2shHash, cacheHit }}
 */
export async function computeSpineP2SH_v07(args) {
  const makerPk = validatePubkeyHex(args.makerPk, 'makerPk');
  const brokerPk = validatePubkeyHex(args.brokerPk, 'brokerPk');
  const poolMerkleRoot = validateHashHex(args.poolMerkleRoot, 'poolMerkleRoot');
  const deadline = validateInt(args.deadline, 'deadline', 1);
  const minerFee = validateInt(args.minerFee, 'minerFee', 1, 99_999_999);  // SS L284-285 require 0<minerFee<1e8
  const brokerFeePct = validateInt(args.brokerFeePct, 'brokerFeePct', 0, 9999);
  const oracleFeePct = validateInt(args.oracleFeePct, 'oracleFeePct', 0, 9999);
  const oracleBondAmount = validateInt(args.oracleBondAmount, 'oracleBondAmount', 1);
  const makerStakeAmount = validateInt(args.makerStakeAmount, 'makerStakeAmount', 1);
  const marketMetadataHash = validateHashHex(args.marketMetadataHash, 'marketMetadataHash');
  const shard_id = validateInt(args.shard_id, 'shard_id', 0);
  const shard_count = validateInt(args.shard_count, 'shard_count', 1);
  if (shard_id >= shard_count) throw new Error(`shard_id ${shard_id} >= shard_count ${shard_count}`);
  const market_id = validateHashHex(args.market_id, 'market_id');
  if (!args.network) throw new Error('network required');

  const ctorJson = [
    bytes32Expr(makerPk),
    bytes32Expr(brokerPk),
    bytes32Expr(poolMerkleRoot),
    intExpr(deadline),
    intExpr(minerFee),
    intExpr(brokerFeePct),
    intExpr(oracleFeePct),
    intExpr(oracleBondAmount),
    intExpr(makerStakeAmount),
    bytes32Expr(marketMetadataHash),
    intExpr(shard_id),
    intExpr(shard_count),
    bytes32Expr(market_id),
  ];

  const result = await compileAndComputeP2SH(SPINE_V07_SIL, ctorJson, 'PoolSpine_v07', args.network);
  const p2shHash = Buffer.from(blake2b(result.scriptBytes, { dkLen: 32 })).toString('hex');

  return {
    p2shAddr: result.p2shAddr,
    redeemScript: result.redeemScript,
    p2shHash,
    cacheHit: result.cacheHit,
  };
}

/**
 * Compute PoolSide_v07 P2SH address + redeem script.
 *
 * Ctor identical to v0.6 (6 params per PoolSide_v07.sil L64-70):
 *   (bettorPk, spineP2shHash, poolMerkleRoot, marketMetadataHash, direction, deadline)
 *
 * v0.7 changes are in entry bodies (claim_winner / refund_market_cancelled fee 范围), not ctor.
 *
 * @returns {{ p2shAddr, redeemScript, cacheHit }}
 */
export async function computeSideP2SH_v07(args) {
  const bettorPk = validatePubkeyHex(args.bettorPk, 'bettorPk');
  const spineP2shHash = validateHashHex(args.spineP2shHash, 'spineP2shHash');
  const poolMerkleRoot = validateHashHex(args.poolMerkleRoot, 'poolMerkleRoot');
  const marketMetadataHash = validateHashHex(args.marketMetadataHash, 'marketMetadataHash');
  const direction = validateInt(args.direction, 'direction', 0, 1);
  const deadline = validateInt(args.deadline, 'deadline', 1);
  if (!args.network) throw new Error('network required');

  const ctorJson = [
    bytes32Expr(bettorPk),
    bytes32Expr(spineP2shHash),
    bytes32Expr(poolMerkleRoot),
    bytes32Expr(marketMetadataHash),
    intExpr(direction),
    intExpr(deadline),
  ];

  const result = await compileAndComputeP2SH(SIDE_V07_SIL, ctorJson, 'PoolSide_v07', args.network);

  return {
    p2shAddr: result.p2shAddr,
    redeemScript: result.redeemScript,
    cacheHit: result.cacheHit,
  };
}

/**
 * Derive 32-byte market_id from pool_markets.id string (utf-8 encode + blake2b hash).
 * Single-shard wire: market_id is just an anchor for cross-shard binding. Use blake2b(id) so:
 * - any string length input → fixed 32 bytes
 * - same id → same market_id deterministically
 *
 * For v0.7 multi-shard (G6 批 3): all shards in same logical market share market_id.
 */
export function deriveMarketIdHash(marketIdString) {
  if (typeof marketIdString !== 'string' || !marketIdString) {
    throw new Error('deriveMarketIdHash: marketIdString must be non-empty string');
  }
  return Buffer.from(blake2b(Buffer.from(marketIdString, 'utf-8'), { dkLen: 32 })).toString('hex');
}
