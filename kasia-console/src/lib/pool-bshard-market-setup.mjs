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

/**
 * Convert-split genesis builder (J1, 2026-06-19) — produces the 3 COHERENT artifacts for the convert-split
 * cascade (seal-SIZE probe): ShardLeaf (register-side concrete genesis) + FoldNode (fold/seal-side template,
 * baked with the REAL PoolRoot root_tmpl_hash) + PoolRoot (seal_to_root target template).
 *
 * Coherence chain (each bakes the next's template hash — the fix vs the probe's computeShardLeafGenesis which
 * baked a ZERO32 placeholder for FoldNode's root_tmpl_hash, breaking seal_to_root foreign-template verify):
 *   PoolRoot compile → root_tmpl_hash → FoldNode compile (bakes root_tmpl_hash) → fn_tmpl_hash
 *   → ShardLeaf compile (bakes fn_tmpl_hash) → genesis redeem.
 * Cascade: ShardLeaf register (proven LANDS) → convert_to_foldnode → FoldNode → seal_to_root → PoolRoot.
 *
 * fn_tmpl_hash / root_tmpl_hash are State-EXCLUDED (blake2b(prefix‖suffix)); init State (param7-10) does not
 * affect them, but commit_v2/shard_count/max_fan_in/root_tmpl_hash/root_init (prefix) DO — so the deployed
 * FoldNode MUST use the returned foldNode.ctor for the chain to stay coherent.
 *
 * @param {object} o {
 *   shardLeafSilPath, foldNodeSilPath, poolRootSilPath, poolSideSilPath,
 *   marketId(32B hex), shardPoolId(32B hex), committeePks(5×32B hex), deadline,
 *   minBet, shardCount, sealCount, maxFanIn=2, firstBet:{bettorPk,side(0|1),stakeSompi}, silvercPath? }
 * @returns {{ shardLeaf, foldNode, poolRoot, genesisState, psArtifact, shardPoolId, fnTmplHash, rootTmplHash }}
 */
export function computeConvertSplitGenesis(o) {
  const { shardLeafSilPath, foldNodeSilPath, rootCloseSilPath, rootClaimSilPath, rootRefundClaimSilPath, poolSideSilPath, marketId, shardPoolId,
    committeePks, deadline, minBet, shardCount, sealCount, maxFanIn = 2, firstBet, silvercPath = SILVERC } = o;
  if (!Array.isArray(committeePks) || committeePks.length !== 5) throw new Error('committeePks must be 5 × 32B hex');
  if (!firstBet || (firstBet.side !== 0 && firstBet.side !== 1)) throw new Error('firstBet {bettorPk, side(0|1), stakeSompi} required');
  const stake = BigInt(firstBet.stakeSompi);
  if (stake < BigInt(minBet)) throw new Error(`firstBet stake ${stake} < min_bet ${minBet}`);

  // template artifact: compile → state_layout split → tmplHash = blake2b(prefix‖suffix) (State-excluded, same as
  // computeMarketGenesis step 2 rootArtifact). Returns the concrete redeem too (for size-probe reporting).
  const templateArtifact = (silPath, ctor) => {
    const compiled = compileSil(silPath, ctor, silvercPath);
    const redeem = Buffer.from(compiled.script);
    const sl = compiled.state_layout;
    const prefix = redeem.slice(0, sl.start), suffix = redeem.slice(sl.start + sl.len);
    const templateHashHex = Buffer.from(blake2b(Buffer.concat([prefix, suffix]), { dkLen: 32 })).toString('hex');
    // stateStart = state_layout.start: 多-entry(selector byte0)=1 / 单-entry(without_selector, state byte0)=0。
    //   relay _continuationAddress self-recreation splice offset 必用此(硬编 1 对单-entry RootClaim/RefundClaim 错偏 1=地址错)。
    return { templatePrefix: prefix, templateSuffix: suffix, templateHashHex, redeemBytes: redeem.length, stateStart: sl.start, stateLen: sl.len };
  };

  // 1. PoolSide template → ps_tmpl_hash (register mints the dust ticket).
  const psDummyCtor = [ctorBytes32(firstBet.bettorPk), ctorInt(firstBet.side), ctorInt(Number(stake)), ctorBytes32(shardPoolId)];
  const psArtifact = computePoolSideArtifact(poolSideSilPath, psDummyCtor, silvercPath);

  // cascade recursive-split (2026-06-20): PoolRoot → RootClose(seal target, committee_hash 4-entry) + RootClaim(convert_to_claim
  //   merkle target) + RefundClaim(convert_to_refundclaim target)。RootClose 烤 claim+refundclaim tmpl_hash; FoldNode 烤 rootclose。
  const rootInitPayoutRoot = ZERO32_HEX;
  // 2a. RootClaim template → rootclaim_tmpl_hash (convert_to_claim target; ctor 9: ps_tmpl_hash, shard_pool_id, init 7-field).
  const rcCtor9 = [
    ctorBytes32(psArtifact.templateHashHex), ctorBytes32(shardPoolId),
    ctorInt(0), ctorInt(0), ctorInt(0), ctorInt(0), ctorInt(0), ctorInt(0), ctorBytes32(rootInitPayoutRoot),
  ];
  const claimCtor10 = [...rcCtor9, ctorInt(0)]; // RootClaim 10-param: + init_claimed_bitmap=0 (R7 re-mint fix bitmap genesis 空)
  const rootClaim = templateArtifact(rootClaimSilPath, claimCtor10);
  const rootClaimTmplHash = rootClaim.templateHashHex;

  // 2b. RefundClaim template → refundclaim_tmpl_hash (convert_to_refundclaim target; ctor 9, 7-field 无 bitmap; refund DoD gate-off).
  const refundClaim = templateArtifact(rootRefundClaimSilPath, rcCtor9);
  const refundClaimTmplHash = refundClaim.templateHashHex;

  // 2c. RootClose template → rootclose_tmpl_hash (FoldNode.seal_to_root target; 烤 claim+refundclaim tmpl_hash for 双 convert 桥)。
  //     committee_hash lever (R8 锚, 省 ~128B vs 5 baked pubkey): blake2b(c0Pk‖c1Pk‖c2Pk‖c3Pk‖c4Pk)。
  //     ctor 11: committee_hash, deadline_ms(=deadline×1000), claim_tmpl_hash, refundclaim_tmpl_hash, init 7-field.
  const committeeHash = Buffer.from(blake2b(Buffer.concat(committeePks.map(pk => Buffer.from(pk, 'hex'))), { dkLen: 32 })).toString('hex');
  const closeCtor = [
    ctorBytes32(committeeHash), ctorInt(Number(deadline) * 1000), ctorBytes32(rootClaimTmplHash), ctorBytes32(refundClaimTmplHash),
    ctorInt(0), ctorInt(0), ctorInt(0), ctorInt(0), ctorInt(0), ctorInt(0), ctorBytes32(rootInitPayoutRoot),
  ];
  const rootClose = templateArtifact(rootCloseSilPath, closeCtor);
  const rootCloseTmplHash = rootClose.templateHashHex;

  // 4. genesis leaf State = first bet baked (4-field, no outcome).
  const genesisState = {
    local_yes: (stake * BigInt(1 - firstBet.side)).toString(),
    local_no: (stake * BigInt(firstBet.side)).toString(),
    count: 1, pool_value: stake.toString(),
  };

  // 3+5. ShardLeaf + (optional) FoldNode. directSeal (shardCount==1 DoD skip-fold; 2026-06-20 STEP1 convert SIZE 墙解):
  //   ShardLeaf_direct converts DIRECTLY to RootClose (convert WithTemplate target=RootClose 851B<预算, 跳 FoldNode 1242B
  //   BUST)。register_append byte-identical; convert new_state 4→7-field canonical(closed:0/winningSide:0/payoutRoot:init)。
  //   FoldNode omitted。multi-shard(directSeal=false)= 原 ShardLeaf→FoldNode→seal 路(post-DoD)。★register 侧长大 = 必 probe。
  const directSeal = o.directSeal != null ? o.directSeal : (Number(shardCount) === 1);
  let foldNode = null, fnTmplHash = null, shardLeafResolvedPath, slCtor;
  if (directSeal) {
    // ShardLeaf_direct ctor (11): market_id, ps_tmpl_hash, shard_pool_id, seal_count, min_bet, rootclose_tmpl_hash,
    //   rootclose_init_payoutRoot, init 4-field. Bakes rootCloseTmplHash (convert_to_rootclose foreign-template target)。
    shardLeafResolvedPath = o.shardLeafDirectSilPath || shardLeafSilPath;
    slCtor = [
      ctorBytes32(marketId), ctorBytes32(psArtifact.templateHashHex), ctorBytes32(shardPoolId),
      ctorInt(sealCount), ctorInt(Number(minBet)), ctorBytes32(rootCloseTmplHash), ctorBytes32(rootInitPayoutRoot),
      ctorInt(Number(genesisState.local_yes)), ctorInt(Number(genesisState.local_no)), ctorInt(genesisState.count), ctorInt(Number(genesisState.pool_value)),
    ];
  } else {
    // 3. FoldNode template → fn_tmpl_hash (multi-shard). bake REAL rootclose_tmpl_hash (FoldNode.seal_to_root target,
    //    ctor param5)。FoldNode ctor (10): market_id, commit_v2, shard_count, max_fan_in, root_tmpl_hash, root_init_payoutRoot, init 4-field.
    const fnCtor = [
      ctorBytes32(marketId), ctorBytes32(ZERO32_HEX), ctorInt(shardCount), ctorInt(maxFanIn),
      ctorBytes32(rootCloseTmplHash), ctorBytes32(rootInitPayoutRoot),
      ctorInt(0), ctorInt(0), ctorInt(0), ctorInt(0),
    ];
    foldNode = templateArtifact(foldNodeSilPath, fnCtor);
    foldNode.ctor = fnCtor;
    fnTmplHash = foldNode.templateHashHex;
    // 5. ShardLeaf ctor (10) bake fn_tmpl_hash (param6). ctor: market_id, ps_tmpl_hash, shard_pool_id, seal_count, min_bet, fn_tmpl_hash, init 4-field.
    shardLeafResolvedPath = shardLeafSilPath;
    slCtor = [
      ctorBytes32(marketId), ctorBytes32(psArtifact.templateHashHex), ctorBytes32(shardPoolId),
      ctorInt(sealCount), ctorInt(Number(minBet)), ctorBytes32(fnTmplHash),
      ctorInt(Number(genesisState.local_yes)), ctorInt(Number(genesisState.local_no)), ctorInt(genesisState.count), ctorInt(Number(genesisState.pool_value)),
    ];
  }
  const slCompiled = compileSil(shardLeafResolvedPath, slCtor, silvercPath);
  const slRedeem = Buffer.from(slCompiled.script);
  const slSl = slCompiled.state_layout;
  const bakedState = slRedeem.slice(slSl.start, slSl.start + slSl.len);
  const expectState = serializeLeafState(genesisState);
  if (!bakedState.equals(expectState)) throw new Error(`ShardLeaf genesis baked state != serializeLeafState (baked ${bakedState.toString('hex').slice(0, 24)} vs ${expectState.toString('hex').slice(0, 24)})`);

  return {
    directSeal,                         // true = ShardLeaf_direct→RootClose skip-fold (DoD shardCount=1); false = ShardLeaf→FoldNode (multi-shard)
    shardLeaf: {                        // register-side: operator computeP2SH → genesis leaf addr; lock first stake here
      ctor: slCtor,
      redeemHexForGenesisState: slRedeem.toString('hex'),
      scriptHashHex: Buffer.from(blake2b(slRedeem, { dkLen: 32 })).toString('hex'),
      redeemBytes: slRedeem.length, stateStart: slSl.start, stateLen: slSl.len,
    },
    foldNode: foldNode ? {              // convert_to_foldnode output target + fold/seal-side redeem (multi-shard only; null when directSeal)
      ctor: foldNode.ctor, tmplHash: fnTmplHash,
      templatePrefix: foldNode.templatePrefix, templateSuffix: foldNode.templateSuffix,
      redeemBytes: foldNode.redeemBytes,
    } : null,
    rootClose: {                        // FoldNode.seal_to_root target (foreign-template; root_prefix/root_suffix for seal builder, sealSelector=52)
      ctor: closeCtor, tmplHash: rootCloseTmplHash,
      templatePrefix: rootClose.templatePrefix, templateSuffix: rootClose.templateSuffix,
      redeemBytes: rootClose.redeemBytes, stateStart: rootClose.stateStart, stateLen: rootClose.stateLen, // 多-entry: stateStart=1
    },
    rootClaim: {                        // RootClose.convert_to_claim target (foreign-template; claim_prefix/claim_suffix for convert builder; 8-field w/ claimed_bitmap)
      ctor: claimCtor10, tmplHash: rootClaimTmplHash,
      templatePrefix: rootClaim.templatePrefix, templateSuffix: rootClaim.templateSuffix,
      redeemBytes: rootClaim.redeemBytes, stateStart: rootClaim.stateStart, stateLen: rootClaim.stateLen, // 单-entry: stateStart=0(claim _continuationAddress 用)
    },
    refundClaim: {                      // RootClose.convert_to_refundclaim target (foreign-template; rc_prefix/rc_suffix for convert builder)
      ctor: rcCtor9, tmplHash: refundClaimTmplHash,
      templatePrefix: refundClaim.templatePrefix, templateSuffix: refundClaim.templateSuffix,
      redeemBytes: refundClaim.redeemBytes, stateStart: refundClaim.stateStart, stateLen: refundClaim.stateLen, // 单-entry: stateStart=0
    },
    genesisState, psArtifact, shardPoolId, fnTmplHash, rootCloseTmplHash, rootClaimTmplHash, refundClaimTmplHash, rootInitPayoutRoot, committeePks, deadline,
  };
}
