// bshard-probe-B-register.mjs — J1 line② SIZE-vs-COUNT live probe runner (2026-06-19).
//
// PURPOSE: broadcast ONE register against PoolLeaf_nofold_probe.sil (493B redeem) and read the result.
//   register×probe-B(493B) outcome decides bshard solvability direction (vs full-leaf 2088B→13738u anchor):
//     • register LANDS                 → SIZE-bound  (smaller redeem ⟹ fewer units ⟹ passes; ~2964u). convert-split solves register.
//     • register REJECTED ~13738u >9999 → COUNT-bound (units ∝ #validate-calls not size; byte-cut useless). must cut register's 2 validate-calls.
//
// J1 .102 has NO tn12 node → KANet-UI runs this on :3200 (tn12 + relay custody). Reuses TESTED builders
// (computeMarketGenesis + buildRegisterWitness/Command) — only genesis-leaf + ONE register, NO seal/fold
// (probe-B has no seal/fold entry, so DON'T run the full happy path; this stops after register).
//
// VALIDATED LOCALLY (J1): computeMarketGenesis(poolLeafSilPath=PoolLeaf_nofold_probe.sil) → 493B genesis redeem
//   (vs PoolLeaf.sil → 2088B). Same 14-ctor / 4-field state / register_append 2-output. drop-in confirmed.
//
// ── OPERATOR CONFIG (KANet-UI fills from :3200 — same values your working bshard-e2e-run.mjs uses) ──
//   op.computeP2SH(redeemHex) -> kaspa addr (payToScriptHash)
//   op.lockToP2SH(addr, sompi, fromRelayId) -> { txId, outpointTxid }   // genesis-leaf lock + bettor funding lock
//   op.sendCommand(relayId, cmd) -> { txId } | throws         // relay broadcasts bshard_register_bet; on kaspad
//                                                              // reject MUST surface the error (script-units msg)
//   op.checkLanded(txId, cmd) -> bool
//   op.bettorRelayId, op.committeePks(5×32B hex), op.feeOrFundingOutpoint {txid,address}, op.changeAddress
//   op.bettorPk(32B hex)  (register bettor; any test pk)
//
import { computeMarketGenesis } from '../src/lib/pool-bshard-market-setup.mjs';
import { buildRegisterWitness, buildRegisterCommand } from '../src/lib/pool-register-builder.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib');
const PROBE_B_LEAF = join(LIB, 'PoolLeaf_nofold_probe.sil');  // ← the probe (493B, no fold/seal)
const POOL_ROOT    = join(LIB, 'PoolRoot.sil');
const POOL_SIDE    = join(LIB, 'PoolSide_v08_shard.sil');
const ZERO32 = '00'.repeat(32);

export async function runProbeBRegister(op) {
  const log = op.log || console.log;
  // 1. genesis market with leaf = probe-B (493B). dummy market_id/shardPoolId/deadline ok — we measure units, not run a market.
  const gen = computeMarketGenesis({
    poolLeafSilPath: PROBE_B_LEAF, poolRootSilPath: POOL_ROOT, poolSideSilPath: POOL_SIDE,
    marketId: op.marketId || '11'.repeat(32), shardPoolId: op.shardPoolId || '22'.repeat(32),
    committeePks: op.committeePks, deadline: op.deadline || 1_000_000, minBet: op.minBet || 1000,
    shardCount: 2, sealCount: 2, maxFanIn: 4,
    firstBet: { bettorPk: op.bettorPk, side: 0, stakeSompi: BigInt(op.stakeSompi || 1_000_000_000n) },
  });
  log(`[probe-B] genesis redeem = ${gen.redeemHexForGenesisState.length / 2}B (expect 493)`);

  // 2. genesis-leaf-create: lock first stake to the probe-B genesis P2SH.
  const genesisAddr = op.computeP2SH(gen.redeemHexForGenesisState);
  const g = await op.lockToP2SH(genesisAddr, BigInt(gen.genesisState.pool_value), op.bettorRelayId);
  log(`[probe-B] genesis leaf locked at ${genesisAddr}: ${g.txId}`);
  if (!(await op.checkLanded(g.txId, { outpointTxid: g.outpointTxid, address: genesisAddr }))) {
    throw new Error('[probe-B] genesis leaf did NOT land — cannot register');
  }

  // 3. THE register×probe-B (this is the measurement). leaf = probe-B genesis (493B redeem).
  const w = buildRegisterWitness({
    side: 1, stake: BigInt(op.stakeSompi || 1_000_000_000n), leafOutIdx: 0, psOutIdx: 1,
    bettorPk: op.registerBettorPk || op.bettorPk, psArtifact: gen.psArtifact,
  });
  const nextLeaf = {
    local_yes: gen.genesisState.local_yes,
    local_no: (BigInt(gen.genesisState.local_no) + BigInt(op.stakeSompi || 1_000_000_000n)).toString(),
    count: Number(gen.genesisState.count) + 1,
    pool_value: (BigInt(gen.genesisState.pool_value) + BigInt(op.stakeSompi || 1_000_000_000n)).toString(),
    shardPoolId: gen.shardPoolId,
  };
  const cmd = buildRegisterCommand({
    witness: w, leafOutpointTxid: g.outpointTxid, leafRedeemHex: gen.redeemHexForGenesisState,
    currentLeafState: gen.genesisState, leafValueSompi: BigInt(gen.genesisState.pool_value),
    bettorFunding: [{ outpointTxid: op.feeOrFundingOutpoint.txid, address: op.feeOrFundingOutpoint.address }],
    leafContinuationState: nextLeaf, ticketDustSompi: op.ticketDustSompi || 20_000_000n,
    shardPoolId: gen.shardPoolId, changeAddress: op.changeAddress,
  });

  log('[probe-B] broadcasting register×probe-B (493B redeem) — THIS is the SIZE-vs-COUNT measurement...');
  try {
    const { txId } = await op.sendCommand(op.bettorRelayId, cmd);
    if (!txId) return verdict(log, { landed: false, error: 'relay returned no txId (broadcast rejected)' });
    const landed = await op.checkLanded(txId, cmd);
    return verdict(log, { landed, txId, error: landed ? null : 'broadcast ok but did NOT land' });
  } catch (e) {
    // kaspad reject for script-units surfaces here — capture the message (contains "script units N > 9999")
    return verdict(log, { landed: false, error: String(e && e.message || e) });
  }
}

function verdict(log, r) {
  log('\n========== probe-B register VERDICT ==========');
  if (r.landed) {
    log(`✅ register×probe-B(493B) LANDED (txId=${r.txId})`);
    log('→ SIZE-bound: 493B redeem passed where 2088B→13738u failed. Byte reduction works. convert-split solves register.');
  } else {
    log(`❌ register×probe-B(493B) REJECTED: ${r.error}`);
    log('→ if error shows "script units ~13738 > 9999" = COUNT-bound: cost ∝ #validate-calls not size; byte-cut useless;');
    log('  must reduce register_append\'s 2 validate-calls (ps WithTemplate + leaf self) to 1.');
    log('→ (if error is unrelated — funding/relay — fix that & re-run; the units msg is the signal.)');
  }
  log('👉 paste the exact kaspad units/error to J1 (@J1tn) → I build the真解 model accordingly.');
  log('==============================================');
  return r;
}
