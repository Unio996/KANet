// pool-p2sh-v0_7_1.mjs — JS plumbing for v0.7.1 trustless settle SS trio
// (WinningsPool_v1 + PoolSpine_v0.7.1 + PoolSide_v0.7.1)
//
// Bettor 终裁 scope A + pattern B+a. 复用 pool-p2sh.mjs compileAndComputeP2SH 工厂.
// 提供 computeWinningsPoolP2SH_v1 / computeSpineP2SH_v0_7_1 / computeSideP2SH_v0_7_1
// + integration helpers (settle TX builder hooks, claim TX builder hooks).
//
// 依赖:
//   - WinningsPool_v1.sil (commit b9e724b51, redeem 204B)
//   - PoolSpine_v0_7_1.sil (commit b524e4c90, redeem 2268B)
//   - PoolSide_v0_7_1.sil (commit dccfe724b, redeem 347B)
//
// 调用 pattern:
//   1. create-v0.7.1 market: computeSpineP2SH_v0_7_1 (= maker create, ctor 含 winningsPoolSpkPrefix3)
//   2. bettor register: computeSideP2SH_v0_7_1 (= 简 ctor 5 args)
//   3. settle TX: settler 计算 WinningsPool ctor 实值 (outcome/yesPool/noPool/brokerPk/marketCovenantId),
//      调 computeWinningsPoolP2SH_v1 得 P2SH addr → 作 settle TX out[6]
//   4. claim TX: bettor 自家 PoolSide UTXO 拉 WinningsPool UTXO, silverc 自验

import {
  compileAndComputeP2SH,
  validatePubkeyHex,
  validateHashHex,
  validateInt,
  bytes32Expr,
  intExpr,
} from './pool-p2sh.mjs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { blake2b } from '@noble/hashes/blake2b';
import { Buffer } from 'buffer';

const __dirname = dirname(fileURLToPath(import.meta.url));

const WINNINGS_POOL_SIL = process.env.WINNINGS_POOL_V1_SIL_PATH || join(__dirname, 'WinningsPool_v1.sil');
const SPINE_V071_SIL = process.env.POOL_SPINE_V0_7_1_SIL_PATH || join(__dirname, 'PoolSpine_v0_7_1.sil');
const SIDE_V071_SIL = process.env.POOL_SIDE_V0_7_1_SIL_PATH || join(__dirname, 'PoolSide_v0_7_1.sil');

/**
 * Compute WinningsPool_v1 P2SH addr + redeem script.
 * ctor: (outcome, yesPool, noPool, brokerPk, marketCovenantId)
 *   outcome: 0 = YES wins, 1 = NO wins (= settle 时 committee 共识结果)
 *   yesPool / noPool: total stake per side (sompi, baked at settle time)
 *   brokerPk: 末轮 dust 归 broker
 *   marketCovenantId: KIP-20 covenant anchor (= cross-shard binding hook, single shard 用 market_id 同值)
 *
 * @returns {{ p2shAddr, redeemScript, p2shHash, cacheHit, scriptBytes }}
 */
export async function computeWinningsPoolP2SH_v1(args) {
  const outcome = validateInt(args.outcome, 'outcome', 0, 1);
  const yesPool = validateInt(args.yesPool, 'yesPool', 1);
  const noPool = validateInt(args.noPool, 'noPool', 1);
  const brokerPk = validatePubkeyHex(args.brokerPk, 'brokerPk');
  const marketCovenantId = validateHashHex(args.marketCovenantId, 'marketCovenantId');
  if (!args.network) throw new Error('network required');

  const ctorJson = [
    intExpr(outcome),
    intExpr(yesPool),
    intExpr(noPool),
    bytes32Expr(brokerPk),
    bytes32Expr(marketCovenantId),
  ];

  const result = await compileAndComputeP2SH(WINNINGS_POOL_SIL, ctorJson, 'WinningsPool_v1', args.network);
  const p2shHash = Buffer.from(blake2b(result.scriptBytes, { dkLen: 32 })).toString('hex');

  return {
    p2shAddr: result.p2shAddr,
    redeemScript: result.redeemScript,
    scriptBytes: result.scriptBytes,
    p2shHash,
    cacheHit: result.cacheHit,
  };
}

/**
 * Compute PoolSpine_v0.7.1 P2SH addr + redeem script.
 * ctor: (makerPk, brokerPk, poolMerkleRoot, deadline, brokerFeePct, oracleFeePct,
 *        oracleBondAmount, makerStakeAmount, marketMetadataHash, market_id, winningsPoolSpkPrefix3)
 *
 * winningsPoolSpkPrefix3 = first 3 bytes of expected WinningsPool P2SH scriptPubKey (= structural
 * sanity binding, full validateOutputStateWithTemplate 待 Phase 2). Caller computes via
 * computeWinningsPoolP2SH_v1 + extract first 3 bytes of scriptPubKey.
 *
 * @returns {{ p2shAddr, redeemScript, p2shHash, cacheHit }}
 */
export async function computeSpineP2SH_v0_7_1(args) {
  const makerPk = validatePubkeyHex(args.makerPk, 'makerPk');
  const brokerPk = validatePubkeyHex(args.brokerPk, 'brokerPk');
  const poolMerkleRoot = validateHashHex(args.poolMerkleRoot, 'poolMerkleRoot');
  const deadline = validateInt(args.deadline, 'deadline', 1);
  const brokerFeePct = validateInt(args.brokerFeePct, 'brokerFeePct', 0, 9999);
  const oracleFeePct = validateInt(args.oracleFeePct, 'oracleFeePct', 0, 9999);
  const oracleBondAmount = validateInt(args.oracleBondAmount, 'oracleBondAmount', 1);
  const makerStakeAmount = validateInt(args.makerStakeAmount, 'makerStakeAmount', 1);
  const marketMetadataHash = validateHashHex(args.marketMetadataHash, 'marketMetadataHash');
  const market_id = validateHashHex(args.market_id, 'market_id');
  const winningsPoolSpkPrefix3Hex = args.winningsPoolSpkPrefix3Hex;
  if (typeof winningsPoolSpkPrefix3Hex !== 'string' || winningsPoolSpkPrefix3Hex.length < 6) {
    throw new Error('winningsPoolSpkPrefix3Hex must be hex string with at least 3 bytes (6 hex chars)');
  }
  // Pad 3-byte prefix to 32-byte field (silverc ctor expects byte[32], we only check first 3 in sil body)
  const padded = (winningsPoolSpkPrefix3Hex.slice(0, 6) + '00'.repeat(29)).slice(0, 64);
  if (!args.network) throw new Error('network required');

  const ctorJson = [
    bytes32Expr(makerPk),
    bytes32Expr(brokerPk),
    bytes32Expr(poolMerkleRoot),
    intExpr(deadline),
    intExpr(brokerFeePct),
    intExpr(oracleFeePct),
    intExpr(oracleBondAmount),
    intExpr(makerStakeAmount),
    bytes32Expr(marketMetadataHash),
    bytes32Expr(market_id),
    bytes32Expr(padded),
  ];

  const result = await compileAndComputeP2SH(SPINE_V071_SIL, ctorJson, 'PoolSpine_v0_7_1', args.network);
  const p2shHash = Buffer.from(blake2b(result.scriptBytes, { dkLen: 32 })).toString('hex');

  return {
    p2shAddr: result.p2shAddr,
    redeemScript: result.redeemScript,
    p2shHash,
    cacheHit: result.cacheHit,
  };
}

/**
 * Compute PoolSide_v0.7.1 P2SH addr + redeem script.
 * ctor: (bettorPk, spineP2shHash, marketMetadataHash, direction, deadline) — 5 args, drama 简化 vs v07.
 *
 * @returns {{ p2shAddr, redeemScript, cacheHit }}
 */
export async function computeSideP2SH_v0_7_1(args) {
  const bettorPk = validatePubkeyHex(args.bettorPk, 'bettorPk');
  const spineP2shHash = validateHashHex(args.spineP2shHash, 'spineP2shHash');
  const marketMetadataHash = validateHashHex(args.marketMetadataHash, 'marketMetadataHash');
  const direction = validateInt(args.direction, 'direction', 0, 1);
  const deadline = validateInt(args.deadline, 'deadline', 1);
  if (!args.network) throw new Error('network required');

  const ctorJson = [
    bytes32Expr(bettorPk),
    bytes32Expr(spineP2shHash),
    bytes32Expr(marketMetadataHash),
    intExpr(direction),
    intExpr(deadline),
  ];

  const result = await compileAndComputeP2SH(SIDE_V071_SIL, ctorJson, 'PoolSide_v0_7_1', args.network);

  return {
    p2shAddr: result.p2shAddr,
    redeemScript: result.redeemScript,
    cacheHit: result.cacheHit,
  };
}

/**
 * Helper: derive WinningsPool scriptPubKey prefix3 for spine ctor.
 * Spine ctor needs first 3 bytes of WinningsPool P2SH scriptPubKey for structural binding.
 *
 * Caller flow:
 *   1. Settle TX builder knows outcome/yesPool/noPool/brokerPk/marketCovenantId
 *   2. Compute WinningsPool P2SH first → extract scriptPubKey prefix3
 *   3. BUT spine was created BEFORE settle (= maker create time) — circular!
 *
 * Resolution: prefix3 of P2SH scriptPubKey IS DETERMINISTIC by Kaspa P2SH opcodes:
 *   `OP_BLAKE2B (0xaa) OP_DATA32 (0x20)` then 32B hash.
 *   = first 3 bytes are ALWAYS `aa 20 <first byte of hash>`
 *   = prefix2 (`aa 20`) is fixed, prefix3 byte 2 varies.
 *   Spine can store `aa 20 00` as ctor (= matches any WinningsPool, weak sanity)
 *   OR compute future WinningsPool hash at create-time (= but settle values unknown).
 *
 * For first ship v0.7.1: use **prefix2 only** match (`aa 20`) — spine verifies scriptPubKey
 * starts with these 2 bytes (= sanity = output is P2SH, value bounded by losingPool).
 * Full P2SH binding 待 Phase 2 validateOutputStateWithTemplate.
 *
 * @returns hex string `aa2000` (24 chars, 3 bytes hex)
 */
export function getKaspaP2SHPrefix3Hex() {
  return 'aa2000';  // OP_BLAKE2B + OP_DATA32 + 0x00 placeholder (= last byte ignored if Phase 2 strengthens)
}
