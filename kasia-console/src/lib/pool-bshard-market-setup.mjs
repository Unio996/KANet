// pool-bshard-market-setup.mjs — bshard M3 genesis market builder (J2, 2026-06-15; e2e config).
//
// Produces the complete config a bshard market needs to be created + driven (so the operator/e2e driver does NOT
// hand-guess ctor values). Chains: PoolSide template → ps_tmpl_hash → PoolShard_fold ctor (genesis first-bet baked,
// canonical zero outcome) → compile → redeem + scriptHash. Genesis = Option A (first bet baked into the leaf state;
// genesis-create locks first stake to this P2SH + creates the first PoolSide dust ticket; subsequent = register_append).
//
// PoolShard_fold ctor order (aa041d91 L15-34, verified): market_id, commit_v2, shard_count, max_fan_in, ps_tmpl_hash,
// shard_pool_id, seal_count, min_bet, c0Pk..c4Pk, deadline, init_local_yes, init_local_no, init_count, init_pool_value,
// init_closed, init_winningSide, init_payoutRoot.
// PoolSide_v08_shard ctor (a4fbec2c L13-17): init_bettorPk, init_direction, init_stake, init_shardPoolId.

import { blake2b } from '@noble/hashes/blake2b';
import { compileSil, computePoolSideArtifact, ctorBytes32, ctorInt } from './pool-bshard-artifacts.mjs';
import { serializePoolShardState } from './pool-shard-state-serialize.mjs';

const ZERO32_HEX = '00'.repeat(32);
const SILVERC = process.env.SILVERC_PATH || 'D:/silverscript/target/release/silverc.exe'; // single-source w/ pool-bshard-artifacts

/**
 * Build the genesis market config (compile-derived; canonical genesis seed baked).
 * @param {object} o {
 *   poolShardSilPath, poolSideSilPath,
 *   marketId(32B hex), shardPoolId(32B hex), committeePks(5 × 32B hex), deadline, minBet, shardCount, sealCount,
 *   maxFanIn=16, firstBet: { bettorPk(32B hex), side(0|1), stakeSompi(bigint) }, silvercPath? }
 * @returns {{ poolCtor, redeemHexForGenesisState, scriptHashHex, genesisState, psArtifact, firstTicketState }}
 */
export function computeMarketGenesis(o) {
  const { poolShardSilPath, poolSideSilPath, marketId, shardPoolId, committeePks, deadline, minBet, shardCount, sealCount, maxFanIn = 16, firstBet, silvercPath = SILVERC } = o;
  if (!Array.isArray(committeePks) || committeePks.length !== 5) throw new Error('committeePks must be 5 × 32B hex');
  if (!firstBet || (firstBet.side !== 0 && firstBet.side !== 1)) throw new Error('firstBet {bettorPk, side(0|1), stakeSompi} required');
  const stake = BigInt(firstBet.stakeSompi);
  if (stake < BigInt(minBet)) throw new Error(`firstBet stake ${stake} < min_bet ${minBet}`);

  // 1. PoolSide template (State-excluded) → ps_tmpl_hash + prefix/suffix (ctor-independent; dummy ticket ctor).
  const psDummyCtor = [ctorBytes32(firstBet.bettorPk), ctorInt(firstBet.side), ctorInt(Number(stake)), ctorBytes32(shardPoolId)];
  const psArtifact = computePoolSideArtifact(poolSideSilPath, psDummyCtor, silvercPath); // {templateHashHex, templatePrefix, templateSuffix, prefixLen, suffixLen}

  // 2. genesis leaf State = first bet baked (canonical zero outcome — committee-bypass + genesis-seed canonical).
  const genesisState = {
    local_yes: (stake * BigInt(1 - firstBet.side)).toString(),
    local_no: (stake * BigInt(firstBet.side)).toString(),
    count: 1, pool_value: stake.toString(),
    closed: 0, winningSide: 0, payoutRoot: ZERO32_HEX,
  };

  // 3. PoolShard_fold ctor (21 params). commit_v2: minimal single-shard e2e skips fold → not exercised; set ZERO
  //    placeholder. (Multi-shard fold sets commit_v2 = blake2b(expectedΣyes‖Σno‖market_id‖shard_count); separate path.)
  const poolCtor = [
    ctorBytes32(marketId), ctorBytes32(ZERO32_HEX), ctorInt(shardCount), ctorInt(maxFanIn),
    ctorBytes32(psArtifact.templateHashHex), ctorBytes32(shardPoolId), ctorInt(sealCount), ctorInt(Number(minBet)),
    ...committeePks.map(ctorBytes32),
    ctorInt(Number(deadline)),
    ctorInt(Number(genesisState.local_yes)), ctorInt(Number(genesisState.local_no)), ctorInt(genesisState.count), ctorInt(Number(genesisState.pool_value)),
    ctorInt(0), ctorInt(0), ctorBytes32(ZERO32_HEX), // init_closed, init_winningSide, init_payoutRoot — canonical genesis seed
  ];
  if (poolCtor.length !== 21) throw new Error(`poolCtor must be 21 params, got ${poolCtor.length}`);

  // 4. compile → genesis redeem + scriptHash (P2SH = operator computeP2SH(redeemHex)). Sanity: baked state region
  //    must byte-match serializePoolShardState(genesisState) (so register/close per-state derivation lines up).
  const compiled = compileSil(poolShardSilPath, poolCtor, silvercPath);
  const redeem = Buffer.from(compiled.script);
  const sl = compiled.state_layout;
  const bakedState = redeem.slice(sl.start, sl.start + sl.len);
  const expectState = serializePoolShardState(genesisState);
  if (!bakedState.equals(expectState)) throw new Error(`genesis baked state != serializePoolShardState(genesisState) — ctor/state mismatch (baked ${bakedState.toString('hex').slice(0, 24)} vs ${expectState.toString('hex').slice(0, 24)})`);

  return {
    poolCtor,
    redeemHexForGenesisState: redeem.toString('hex'),
    scriptHashHex: Buffer.from(blake2b(redeem, { dkLen: 32 })).toString('hex'), // → operator addressFromScriptPublicKey(P2SH(scriptHash))
    genesisState,
    psArtifact, // {templateHashHex, templatePrefix, templateSuffix} for register/claim/refund builders' ps_prefix/ps_suffix
    firstTicketState: { bettorPk: firstBet.bettorPk, direction: firstBet.side, stake: stake.toString(), shardPoolId }, // genesis-create also creates this dust ticket
  };
}
