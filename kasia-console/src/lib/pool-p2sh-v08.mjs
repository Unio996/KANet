// pool-p2sh-v08.mjs — Node-side ctor builder + P2SH derivation for PoolSpine_v08_chunk.sil (#31 找零核弹).
//
// v08 = v07 + chunked settle (settle_chunk entry0) + ported settle_aggregate/dispute/refund (entry1-3).
// New ctor (16 params, DIFFERS from v07): drops v07's brokerFeePct/oracleFeePct; reorders; adds
//   maxWinnersPerChunk/init_hwm/init_plan_commit/init_total_winners/maxChunkFee; keeps makerStakeAmount/minerFee
//   (v07-anchor, J1 ported settle_aggregate/refund need them — ctor14→16 drift, b367753b).
//
// Reuses pool-p2sh.mjs helpers (single source, no drift). Same compile→P2SH path as v07.
//
// ⚠ NWT byte-match gate (a) (THE stuck-funds 命门): this off-chain P2SH MUST byte-match silverc-compiled
//   SS P2SH (= blake2b(redeem)). Since compileAndComputeP2SH invokes silverc.exe on the SAME .sil with the
//   SAME ctor16, it matches by construction; the gate re-verifies independently.

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

const SPINE_V08_SIL = process.env.POOL_SPINE_V08_SIL_PATH || join(__dirname, 'PoolSpine_v08_chunk.sil.draft');

// Deployment constants (single-source / determinism — both nodes MUST agree):
//   maxWinnersPerChunk = settle_chunk for-loop compile bound (1KAS headline = 47; storage-derived).
//   maxChunkFee = V07_MAX_FEE = 1e8 (anti-grief ceiling; REUSE pool-market-settler.js L2291 const when wired).
//   init_* = genesis placeholders (chunk_0 uses committee-signed plan_commit_arg witness, NOT readInputState;
//     pool-lock has no state — see SS L122. init_* only affect P2SH determinism, never require-checked).
export const V08_MAX_WINNERS_PER_CHUNK = 47;
export const V08_MAX_CHUNK_FEE = 100_000_000;       // = V07_MAX_FEE
const ZERO32_HEX = '00'.repeat(32);

/**
 * Compute PoolSpine_v08_chunk P2SH address + redeem script.
 *
 * Ctor order MUST match PoolSpine_v08_chunk.sil.draft (16 params, verified e79f00a9 L34-49):
 *   (makerPk, brokerPk, poolMerkleRoot, deadline, marketMetadataHash, market_id, shard_id, shard_count,
 *    oracleBondAmount, maxWinnersPerChunk, init_hwm, init_plan_commit, init_total_winners, maxChunkFee,
 *    makerStakeAmount, minerFee)
 *
 * @returns {{ p2shAddr, redeemScript, p2shHash, cacheHit }}
 */
export async function computeSpineP2SH_v08(args) {
  const makerPk = validatePubkeyHex(args.makerPk, 'makerPk');
  const brokerPk = validatePubkeyHex(args.brokerPk, 'brokerPk');
  const poolMerkleRoot = validateHashHex(args.poolMerkleRoot, 'poolMerkleRoot');
  const deadline = validateInt(args.deadline, 'deadline', 1);
  const marketMetadataHash = validateHashHex(args.marketMetadataHash, 'marketMetadataHash');
  const market_id = validateHashHex(args.market_id, 'market_id');
  const shard_id = validateInt(args.shard_id, 'shard_id', 0);
  const shard_count = validateInt(args.shard_count, 'shard_count', 1);
  if (shard_id >= shard_count) throw new Error(`shard_id ${shard_id} >= shard_count ${shard_count}`);
  const oracleBondAmount = validateInt(args.oracleBondAmount, 'oracleBondAmount', 1);
  // v08-new (genesis/deploy constants — default to canonical values; both nodes MUST match):
  const maxWinnersPerChunk = validateInt(args.maxWinnersPerChunk ?? V08_MAX_WINNERS_PER_CHUNK, 'maxWinnersPerChunk', 1);
  const init_hwm = validateInt(args.init_hwm ?? 0, 'init_hwm', 0);
  const init_plan_commit = validateHashHex(args.init_plan_commit ?? ZERO32_HEX, 'init_plan_commit');
  const init_total_winners = validateInt(args.init_total_winners ?? 0, 'init_total_winners', 0);
  const maxChunkFee = validateInt(args.maxChunkFee ?? V08_MAX_CHUNK_FEE, 'maxChunkFee', 1);
  // v07-anchor (settle_aggregate/refund need these):
  const minerFee = validateInt(args.minerFee, 'minerFee', 1, 99_999_999);  // SS L284-285 require 0<minerFee<1e8
  const makerStakeAmount = validateInt(args.makerStakeAmount, 'makerStakeAmount', 1);
  if (!args.network) throw new Error('network required');

  const ctorJson = [
    bytes32Expr(makerPk),              // 0
    bytes32Expr(brokerPk),             // 1
    bytes32Expr(poolMerkleRoot),       // 2
    intExpr(deadline),                 // 3
    bytes32Expr(marketMetadataHash),   // 4
    bytes32Expr(market_id),            // 5
    intExpr(shard_id),                 // 6
    intExpr(shard_count),              // 7
    intExpr(oracleBondAmount),         // 8
    intExpr(maxWinnersPerChunk),       // 9
    intExpr(init_hwm),                 // 10
    bytes32Expr(init_plan_commit),     // 11
    intExpr(init_total_winners),       // 12
    intExpr(maxChunkFee),              // 13
    intExpr(makerStakeAmount),         // 14
    intExpr(minerFee),                 // 15
  ];

  const result = await compileAndComputeP2SH(SPINE_V08_SIL, ctorJson, 'PoolSpine_v08_chunk', args.network);
  const p2shHash = Buffer.from(blake2b(result.scriptBytes, { dkLen: 32 })).toString('hex');

  return {
    p2shAddr: result.p2shAddr,
    redeemScript: result.redeemScript,
    p2shHash,
    cacheHit: result.cacheHit,
  };
}
