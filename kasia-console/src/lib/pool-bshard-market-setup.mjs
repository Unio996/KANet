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
import { serializeLeafState } from './pool-shard-state-serialize.mjs';

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
  const { poolLeafSilPath, poolRootSilPath, poolSideSilPath, marketId, shardPoolId, committeePks, deadline, minBet, shardCount, sealCount, maxFanIn = 4, firstBet, silvercPath = SILVERC } = o;
  if (!Array.isArray(committeePks) || committeePks.length !== 5) throw new Error('committeePks must be 5 × 32B hex');
  if (!firstBet || (firstBet.side !== 0 && firstBet.side !== 1)) throw new Error('firstBet {bettorPk, side(0|1), stakeSompi} required');
  const stake = BigInt(firstBet.stakeSompi);
  if (stake < BigInt(minBet)) throw new Error(`firstBet stake ${stake} < min_bet ${minBet}`);

  // 1. PoolSide template (State-excluded) → ps_tmpl_hash + prefix/suffix (ctor-independent; dummy ticket ctor).
  const psDummyCtor = [ctorBytes32(firstBet.bettorPk), ctorInt(firstBet.side), ctorInt(Number(stake)), ctorBytes32(shardPoolId)];
  const psArtifact = computePoolSideArtifact(poolSideSilPath, psDummyCtor, silvercPath); // {templateHashHex, templatePrefix, templateSuffix, prefixLen, suffixLen}

  // 2. PoolRoot template (State-excluded) → root_tmpl_hash + rootArtifact (baked into PoolLeaf ctor as the seal_to_root
  //    foreign-template anchor; the seal builder's root_prefix/suffix). PoolRoot ctor (16): ps_tmpl_hash, shard_pool_id,
  //    shard_count, c0-c4Pk, deadline, init_local_yes/no/count/pool_value/closed/winningSide/payoutRoot (state arbitrary,
  //    template excludes State region). committee + deadline + shard_pool_id baked → per-market root template.
  const rootInitPayoutRoot = ZERO32_HEX;
  const rootCtor = [
    ctorBytes32(psArtifact.templateHashHex), ctorBytes32(shardPoolId), ctorInt(shardCount),
    ...committeePks.map(ctorBytes32), ctorInt(Number(deadline)),
    ctorInt(0), ctorInt(0), ctorInt(0), ctorInt(0), ctorInt(0), ctorInt(0), ctorBytes32(rootInitPayoutRoot), // init State (arbitrary; template excludes State)
  ];
  const rootCompiled = compileSil(poolRootSilPath, rootCtor, silvercPath);
  const rootRedeem = Buffer.from(rootCompiled.script);
  const rsl = rootCompiled.state_layout;
  const rootPrefix = rootRedeem.slice(0, rsl.start), rootSuffix = rootRedeem.slice(rsl.start + rsl.len);
  const rootTmplHash = Buffer.from(blake2b(Buffer.concat([rootPrefix, rootSuffix]), { dkLen: 32 })).toString('hex');
  const rootArtifact = { templatePrefix: rootPrefix, templateSuffix: rootSuffix, templateHashHex: rootTmplHash };

  // 3. genesis leaf State = first bet baked (4-field PoolLeaf — NO outcome fields; outcome lives in PoolRoot).
  const genesisState = {
    local_yes: (stake * BigInt(1 - firstBet.side)).toString(),
    local_no: (stake * BigInt(firstBet.side)).toString(),
    count: 1, pool_value: stake.toString(),
  };

  // 4. PoolLeaf ctor (14): market_id, commit_v2(ZERO — minimal single-shard skips fold), shard_count, max_fan_in,
  //    ps_tmpl_hash, shard_pool_id, seal_count, min_bet, root_tmpl_hash, root_init_payoutRoot, init_local_yes/no/count/pool_value.
  const leafCtor = [
    ctorBytes32(marketId), ctorBytes32(ZERO32_HEX), ctorInt(shardCount), ctorInt(maxFanIn),
    ctorBytes32(psArtifact.templateHashHex), ctorBytes32(shardPoolId), ctorInt(sealCount), ctorInt(Number(minBet)),
    ctorBytes32(rootTmplHash), ctorBytes32(rootInitPayoutRoot),
    ctorInt(Number(genesisState.local_yes)), ctorInt(Number(genesisState.local_no)), ctorInt(genesisState.count), ctorInt(Number(genesisState.pool_value)),
  ];
  if (leafCtor.length !== 14) throw new Error(`leafCtor must be 14 params, got ${leafCtor.length}`);

  // 5. compile PoolLeaf → genesis redeem + scriptHash. Sanity: baked 4-field state == serializeLeafState(genesisState).
  const compiled = compileSil(poolLeafSilPath, leafCtor, silvercPath);
  const redeem = Buffer.from(compiled.script);
  const sl = compiled.state_layout;
  const bakedState = redeem.slice(sl.start, sl.start + sl.len);
  const expectState = serializeLeafState(genesisState);
  if (!bakedState.equals(expectState)) throw new Error(`genesis baked leaf state != serializeLeafState(genesisState) (baked ${bakedState.toString('hex').slice(0, 24)} vs ${expectState.toString('hex').slice(0, 24)})`);

  return {
    leafCtor, rootCtor,
    redeemHexForGenesisState: redeem.toString('hex'), // PoolLeaf genesis redeem (operator computeP2SH → genesis leaf addr)
    scriptHashHex: Buffer.from(blake2b(redeem, { dkLen: 32 })).toString('hex'),
    genesisState,   // 4-field {local_yes, local_no, count, pool_value}
    shardPoolId,
    psArtifact,     // {templateHashHex, templatePrefix, templateSuffix} for register/claim/refund ps_prefix/ps_suffix
    rootArtifact,   // {templatePrefix, templateSuffix, templateHashHex} for seal_to_root root_prefix/root_suffix (foreign-template)
    rootTmplHash, rootInitPayoutRoot, committeePks, deadline, // PoolRoot deploy inputs (root_tmpl_hash baked in leaf)
    firstTicketState: { bettorPk: firstBet.bettorPk, direction: firstBet.side, stake: stake.toString(), shardPoolId },
  };
}
