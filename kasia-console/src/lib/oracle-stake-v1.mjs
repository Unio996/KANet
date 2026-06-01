// oracle-stake-v1.mjs — Node-side ctor builder + P2SH derivation for OracleStake_v1.sil.
//
// Decision: docs/2026-06-01-onchain-stake-oracle-pool-DECISION.md §2.2 J2 step [2].
// 5-agent 共识乙路线: 链上 stake UTXO 集合 = oracle pool (跨节点扫链派生).
//
// Each oracle's stake UTXO is locked to a unique P2SH derived from (stakerPkX, lockUntilDaa).
// Two oracles can't share P2SH unless ctor identical. lockUntilDaa is the time-lock anchor
// for self-unstake (e0 timeout_unlock requires tx.time >= lockUntilDaa).
//
// Use:
//   - oracle-pool-chain-scanner: derive each known enrollment's P2SH → RPC getUtxos → verify stake
//   - enrollment API: derive P2SH for fresh enroll request → return addr to oracle for transfer
//
// MIN_STAKE / fee range comes from OracleStake_v1.sil L55-58 (NOT from this builder):
//   - output value >= input - MAX_FEE (1e8)
//   - output value <= input - MIN_FEE (1000)
//   - output value >= 1000 dust

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blake2b } from '@noble/hashes/blake2b';
import {
  bytes32Expr,
  intExpr,
  validatePubkeyHex,
  validateInt,
  compileAndComputeP2SH,
} from './pool-p2sh.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const STAKE_V1_SIL = process.env.ORACLE_STAKE_V1_SIL_PATH || join(__dirname, 'OracleStake_v1.sil');

/**
 * Compute OracleStake_v1 P2SH address + redeem script for given ctor.
 *
 * Ctor order MUST match OracleStake_v1.sil L35-38 (2 params, J1 r258 v2 minerFee dropped):
 *   (stakerPkX, lockUntilDaa)
 *
 * @returns {{ p2shAddr, redeemScript, p2shHash, cacheHit }}
 */
export async function computeStakeP2SH_v1(args) {
  const stakerPkX = validatePubkeyHex(args.stakerPkX, 'stakerPkX');
  const lockUntilDaa = validateInt(args.lockUntilDaa, 'lockUntilDaa', 1);
  if (!args.network) throw new Error('network required (testnet-12 or mainnet)');

  const ctorJson = [
    bytes32Expr(stakerPkX),
    intExpr(lockUntilDaa),
  ];

  const result = await compileAndComputeP2SH(STAKE_V1_SIL, ctorJson, 'OracleStake_v1', args.network);

  const p2shHash = Buffer.from(blake2b(result.scriptBytes, { dkLen: 32 })).toString('hex');

  return {
    p2shAddr: result.p2shAddr,
    redeemScript: result.redeemScript,
    p2shHash,
    cacheHit: result.cacheHit,
  };
}

// Pool participation constants (= matches OracleStake_v1.sil + spec).
export const ORACLE_STAKE_MIN_SOMPI = 100_000_000;  // 1 KAS minimum stake to count in pool
export const ORACLE_STAKE_FEE_MIN = 1000;            // SS L56 require output <= input - 1000
export const ORACLE_STAKE_FEE_MAX = 100_000_000;     // SS L57 require output >= input - 1e8 (1 KAS)
