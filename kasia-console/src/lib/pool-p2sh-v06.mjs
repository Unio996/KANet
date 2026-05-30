// pool-p2sh-v06.mjs — Node-side ctor builder + P2SH derivation for PoolSpine_v06.sil (depth-8).
//
// Mirrors pool-p2sh.mjs's computeSpineP2SH but for the v0.6 anonymous-pool spine:
// - v0.5 baked 3 individual oracle PKs in the ctor; v0.6 bakes ONE poolMerkleRoot (depth-8 ≤256 oracles).
// - Committee data (aggregate PK / committee hash / individual committee PKs + merkle proofs) is per-event
//   and lives in the settle TX args, NOT the ctor (J1 r99 catch + Bettor r7 confirm).
//
// Reuses pool-p2sh.mjs's generic compile + Kaspa P2SH derivation; all helpers (bytes32Expr / intExpr /
// validatePubkeyHex / validateHashHex / validateInt / compileAndComputeP2SH) are imported (kept as a
// single source of truth so a future helper fix doesn't drift between v0.5 and v0.6).
//
// v0.5 pool-p2sh.mjs is otherwise untouched (Bettor r3 + spec §7 ADDITIVE rule).

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

const SPINE_V06_SIL = process.env.POOL_SPINE_V06_SIL_PATH || join(__dirname, 'PoolSpine_v06.sil');

/**
 * Compute PoolSpine_v06 P2SH address + redeem script.
 *
 * Ctor order MUST match PoolSpine_v06.sil:
 *   (makerPk, brokerPk, poolMerkleRoot, deadline, minerFee, brokerFeePct, oracleFeePct,
 *    oracleBondAmount, makerStakeAmount, marketMetadataHash)
 *
 * The poolMerkleRoot is the depth-8 blake2b merkle root over the pool members (sorted PK ascending,
 * leaves = blake2b(pk), internal nodes = blake2b(left||right), pad odd levels by repeating the last
 * leaf) — derived by the off-chain pool snapshot module (J2 J2.1 owns the derivation; this builder
 * just bakes whatever root is passed in).
 *
 * @returns {{ p2shAddr, redeemScript, p2shHash, cacheHit }}
 */
export async function computeSpineP2SH_v06(args) {
  const makerPk = validatePubkeyHex(args.makerPk, 'makerPk');
  const brokerPk = validatePubkeyHex(args.brokerPk, 'brokerPk');
  const poolMerkleRoot = validateHashHex(args.poolMerkleRoot, 'poolMerkleRoot');
  const deadline = validateInt(args.deadline, 'deadline', 1);
  const minerFee = validateInt(args.minerFee, 'minerFee', 1, 10_000_000);
  const brokerFeePct = validateInt(args.brokerFeePct, 'brokerFeePct', 0, 9999);
  const oracleFeePct = validateInt(args.oracleFeePct, 'oracleFeePct', 0, 9999);
  const oracleBondAmount = validateInt(args.oracleBondAmount, 'oracleBondAmount', 1);
  const makerStakeAmount = validateInt(args.makerStakeAmount, 'makerStakeAmount', 1);
  const marketMetadataHash = validateHashHex(args.marketMetadataHash, 'marketMetadataHash');
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
  ];

  const result = await compileAndComputeP2SH(SPINE_V06_SIL, ctorJson, 'PoolSpine_v06', args.network);

  // Kaspa P2SH: OP_BLAKE2B [32-byte hash] OP_EQUAL — hash = blake2b-256(redeemScript). Same as v0.5.
  const p2shHash = Buffer.from(blake2b(result.scriptBytes, { dkLen: 32 })).toString('hex');

  return {
    p2shAddr: result.p2shAddr,
    redeemScript: result.redeemScript,
    p2shHash,
    cacheHit: result.cacheHit,
  };
}
