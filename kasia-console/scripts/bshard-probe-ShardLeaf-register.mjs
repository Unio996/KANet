// bshard-probe-ShardLeaf-register.mjs — J1 convert-split REAL register verify (2026-06-19).
//
// PURPOSE (Bettor spend-units 禁估铁律): my ShardLeaf 441B→~2902u is CALCULATED (6.58u/byte). This runs the
//   REAL register×ShardLeaf(441B) on :3200 tn12 → must observe LANDS (<9999 on-chain) = the convert-split
//   register-SOLVED on-chain milestone (vs original PoolLeaf register 2088B→13738u REJECTED).
//
// ShardLeaf is the convert-split register-side leaf (register_append + convert_to_foldnode; bakes FoldNode
//   tmpl_hash, NOT PoolRoot). So computeMarketGenesis (PoolLeaf-specific, bakes root_tmpl_hash) doesn't fit →
//   this file has computeShardLeafGenesis (compile FoldNode → fn_tmpl_hash → compile ShardLeaf → 441B genesis).
//   The register itself reuses the TESTED buildRegisterWitness/Command (register_append is byte-identical semantics).
//
// KANet-UI runs on :3200 with the SAME operator config as bshard-e2e-run.mjs (computeP2SH, lockToP2SH, sendCommand,
//   checkLanded, bettorRelayId, funding outpoint). See OPERATOR CONFIG in bshard-probe-B-register.mjs (same shape).
//
import { compileSil, computePoolSideArtifact, ctorBytes32, ctorInt } from '../src/lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from '../src/lib/pool-template-artifact.mjs';
import { buildRegisterWitness, buildRegisterCommand } from '../src/lib/pool-register-builder.mjs';
import { blake2b } from '@noble/hashes/blake2b';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib');
const SHARDLEAF = join(LIB, 'ShardLeaf.sil');
const FOLDNODE = join(LIB, 'FoldNode.sil');
const POOL_SIDE = join(LIB, 'PoolSide_v08_shard.sil');
const ZERO32 = '00'.repeat(32);

/** Compile FoldNode → fn_tmpl_hash → compile ShardLeaf (baked) → genesis redeem (441B) + artifacts. */
export function computeShardLeafGenesis({ marketId, shardPoolId, sealCount = 2, minBet = 1000, maxFanIn = 2, firstBet, silvercPath }) {
  const stake = BigInt(firstBet.stakeSompi);
  // 1. PoolSide ps artifact (register mints the dust ticket)
  const psDummyCtor = [ctorBytes32(firstBet.bettorPk), ctorInt(firstBet.side), ctorInt(Number(stake)), ctorBytes32(shardPoolId)];
  const psArtifact = computePoolSideArtifact(POOL_SIDE, psDummyCtor, silvercPath);
  // 2. FoldNode template → fn_tmpl_hash (ShardLeaf.convert_to_foldnode foreign-template anchor; max_fan_in must match deploy)
  const fnCtor = [ctorBytes32(marketId), ctorBytes32(ZERO32), ctorInt(2), ctorInt(maxFanIn), ctorBytes32(ZERO32), ctorBytes32(ZERO32), ctorInt(0), ctorInt(0), ctorInt(0), ctorInt(0)];
  const fnArt = extractTemplateArtifact(compileSil(FOLDNODE, fnCtor, silvercPath));
  const fnTmplHash = fnArt.expectedTemplateHashHex;
  // 3. genesis leaf state = first bet baked (4-field, no outcome)
  const genesisState = { local_yes: (stake * BigInt(1 - firstBet.side)).toString(), local_no: (stake * BigInt(firstBet.side)).toString(), count: 1, pool_value: stake.toString() };
  // 4. ShardLeaf ctor (10): market_id, ps_tmpl_hash, shard_pool_id, seal_count, min_bet, fn_tmpl_hash, init 4-field
  const slCtor = [ctorBytes32(marketId), ctorBytes32(psArtifact.templateHashHex), ctorBytes32(shardPoolId), ctorInt(sealCount), ctorInt(minBet), ctorBytes32(fnTmplHash), ctorInt(Number(genesisState.local_yes)), ctorInt(Number(genesisState.local_no)), ctorInt(genesisState.count), ctorInt(Number(genesisState.pool_value))];
  const compiled = compileSil(SHARDLEAF, slCtor, silvercPath);
  const redeem = Buffer.from(compiled.script);
  return {
    redeemHexForGenesisState: redeem.toString('hex'),  // 441B ShardLeaf genesis redeem
    scriptHashHex: Buffer.from(blake2b(redeem, { dkLen: 32 })).toString('hex'),
    genesisState, shardPoolId, psArtifact, fnTmplHash,
    redeemBytes: redeem.length,
  };
}

export async function runShardLeafRegisterVerify(op) {
  const log = op.log || console.log;
  const gen = computeShardLeafGenesis({ marketId: op.marketId || '11'.repeat(32), shardPoolId: op.shardPoolId || '22'.repeat(32), firstBet: { bettorPk: op.bettorPk, side: 0, stakeSompi: BigInt(op.stakeSompi || 1_000_000_000n) }, silvercPath: op.silvercPath });
  log(`[ShardLeaf] genesis redeem = ${gen.redeemBytes}B (expect 441 — the convert-split register-side leaf, vs PoolLeaf 2088B)`);

  const genesisAddr = op.computeP2SH(gen.redeemHexForGenesisState);
  const g = await op.lockToP2SH(genesisAddr, BigInt(gen.genesisState.pool_value), op.bettorRelayId);
  log(`[ShardLeaf] genesis leaf locked at ${genesisAddr}: ${g.txId}`);
  if (!(await op.checkLanded(g.txId, { outpointTxid: g.outpointTxid, address: genesisAddr }))) throw new Error('[ShardLeaf] genesis did NOT land');

  const w = buildRegisterWitness({ side: 1, stake: BigInt(op.stakeSompi || 1_000_000_000n), leafOutIdx: 0, psOutIdx: 1, bettorPk: op.registerBettorPk || op.bettorPk, psArtifact: gen.psArtifact });
  const nextLeaf = { local_yes: gen.genesisState.local_yes, local_no: (BigInt(gen.genesisState.local_no) + BigInt(op.stakeSompi || 1_000_000_000n)).toString(), count: 2, pool_value: (BigInt(gen.genesisState.pool_value) + BigInt(op.stakeSompi || 1_000_000_000n)).toString(), shardPoolId: gen.shardPoolId };
  const cmd = buildRegisterCommand({ witness: w, leafOutpointTxid: g.outpointTxid, leafRedeemHex: gen.redeemHexForGenesisState, currentLeafState: gen.genesisState, leafValueSompi: BigInt(gen.genesisState.pool_value), bettorFunding: [{ outpointTxid: op.feeOrFundingOutpoint.txid, address: op.feeOrFundingOutpoint.address }], leafContinuationState: nextLeaf, ticketDustSompi: op.ticketDustSompi || 20_000_000n, shardPoolId: gen.shardPoolId, changeAddress: op.changeAddress });

  log('[ShardLeaf] broadcasting register×ShardLeaf(441B) — THE convert-split register-SOLVED on-chain verify...');
  try {
    const { txId } = await op.sendCommand(op.bettorRelayId, cmd);
    if (!txId) return verdict(log, { landed: false, error: 'relay no txId' });
    const landed = await op.checkLanded(txId, cmd);
    return verdict(log, { landed, txId });
  } catch (e) { return verdict(log, { landed: false, error: String(e && e.message || e) }); }
}

function verdict(log, r) {
  log('\n========== register×ShardLeaf VERDICT ==========');
  if (r.landed) {
    log(`✅✅ register×ShardLeaf(441B) LANDED on-chain (txId=${r.txId}) — convert-split register SOLVED, ON-CHAIN VERIFIED.`);
    log('   (vs original PoolLeaf register 2088B→13738u>9999 REJECTED. Calculated 2902u confirmed under 9999 by real broadcast.)');
  } else {
    log(`❌ register×ShardLeaf REJECTED: ${r.error}`);
    log('   if "script units N>9999" → my 2902u estimate was wrong, paste N to J1. if false-stack/funding → fix & rerun.');
  }
  log('👉 paste result to @J1tn + @NWT (co-verify landed).');
  log('================================================');
  return r;
}
