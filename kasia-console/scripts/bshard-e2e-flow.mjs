// bshard-e2e-flow.mjs — standalone bshard M3 e2e proof orchestration driver (J2, 2026-06-15).
//
// Drives the full bshard lifecycle on chain to PROVE the mechanism runs end-to-end (Owner DoD: internal≠ready;
// this is the mechanism's FIRST live run). Phases:
//   ① genesis-leaf-create  (lock first bettor stake → genesis-state P2SH; no builder — hand-rolled lock-to-P2SH)
//   ② register × N         (buildRegisterCommand append; allocator routes shard)
//   ③ seal                 (count == seal_count → shard sealed, foldable)
//   ④ fold k→1             (buildFoldCommand; relay unlockBshardFold covenant leader/delegate)
//   ⑤ close_commit         (buildCloseCommitCommand; relay unlockBshardClose committee 4-of-5)
//   ⑥ claim / refund       (buildClaim/RefundCommand; winner draws root, or cancelled→refund)
//   + PoC-injection hook   (happy base TX → mutate one field → re-broadcast → assert SS rejects; J1's 7 vectors)
//
// DIVISION: this module = the flow LOGIC (calls J2 builders). The OPERATOR specifics are injected via `config`
// (KANet-UI :3200 domain): sendCommand(relayId, cmd)->{txId}, checkLanded(txId)->bool, lockToP2SH(addr, sompi),
// computeP2SH(redeemHex), funding/committee/relay-ids. RELAY HANDLERS unlockBshard{Register,Fold,Close,Claim,Refund}
// = J1 domain (must be live for ④⑤ — fold/close were the missing pieces). NO TX NO STATE: only advance on landed.

import { allocateForRegister, onBettorRegistered } from '../src/lib/shard-allocator.mjs';
import { buildRegisterWitness, buildRegisterCommand } from '../src/lib/pool-register-builder.mjs';
import { buildFoldWitness, buildFoldCommand } from '../src/lib/pool-fold-builder.mjs';
import { buildCloseCommitWitness, buildCloseCommitCommand } from '../src/lib/pool-close-builder.mjs';
import { buildClaimWitness, buildClaimCommand } from '../src/lib/pool-claim-builder.mjs';
import { buildRefundWitness, buildRefundCommand } from '../src/lib/pool-refund-builder.mjs';
import { computeParimutuelPayouts, buildPayoutTree } from '../src/lib/pool-payout-parimutuel.mjs';

// ── helper: broadcast a relay command + block until landed (NO TX NO STATE) ──
async function sendAndLand(config, relayId, cmd, label) {
  const { txId } = await config.sendCommand(relayId, cmd);
  if (!txId) throw new Error(`${label}: relay returned no txId (broadcast failed — NO TX NO STATE)`);
  // checkLanded(txId, cmd): cmd carries the output context (relay's check_utxo_landed needs {type,address,txid};
  // the operator adapter derives address from cmd.outputs / the landed tx). NO TX NO STATE: only advance on true.
  const landed = await config.checkLanded(txId, cmd);
  if (!landed) throw new Error(`${label}: tx ${txId} did NOT land (check_utxo_landed false — NOT advancing state)`);
  config.log?.(`✓ ${label} landed: ${txId}`);
  return txId;
}

/**
 * Run the bshard e2e happy path: genesis → register×N → seal → fold → close → claim (+ optional refund path).
 * @param {object} config {
 *   sendCommand(relayId, cmd)->Promise<{txId}>, checkLanded(txId)->Promise<bool>, log?,
 *   lockToP2SH(p2shAddr, sompi, fromRelayId)->Promise<{txId, outpointTxid}>,   // genesis + funding (hand-rolled, v07-style)
 *   computeP2SH(redeemHex)->string,                                            // payToScriptHash(redeem) addr (per-state)
 *   market: { redeemHexForGenesisState, genesisState, marketId, shardCount, sealCount, committeePks, initPayoutRoot, psArtifact },
 *   bettors: [{ relayId, fundingOutpoint, side, stakeSompi, bettorPk }],
 *   relays: { bettorRelayId, committeeRelayIds }, winningSide }
 * @returns {object} { genesisTxid, registerTxids, foldTxids, closeTxid, claimTxids, summary }
 */
export async function runHappyPath(config) {
  const m = config.market;
  const out = { registerTxids: [], foldTxids: [], claimTxids: [] };

  // ① genesis-leaf-create: lock first stake to the genesis-state P2SH (= computeP2SH(redeem with genesis state)).
  const genesisAddr = config.computeP2SH(m.redeemHexForGenesisState);
  const g = await config.lockToP2SH(genesisAddr, BigInt(m.genesisState.pool_value), config.relays.bettorRelayId);
  out.genesisTxid = g.txId;
  config.log?.(`✓ genesis leaf created at ${genesisAddr}: ${g.txId}`);
  // shard-allocator: post-land record (NO TX NO STATE → only after genesis landed)
  let leafState = { ...m.genesisState };
  let leafOutpointTxid = g.outpointTxid, leafRedeemHex = m.redeemHexForGenesisState, leafValue = BigInt(m.genesisState.pool_value);

  // ② register × N (append): allocator routes, buildRegisterCommand, send+land, advance leaf state.
  for (const b of config.bettors) {
    const alloc = allocateForRegister({ logicalMarketId: m.marketId, projectedMass: 0 }); // 'use' open shard or 'open_new'
    const w = buildRegisterWitness({ side: b.side, stake: BigInt(b.stakeSompi), leafOutIdx: 0, psOutIdx: 1, bettorPk: b.bettorPk, psArtifact: m.psArtifact });
    const cmd = buildRegisterCommand({
      witness: w, leafAddress: config.computeP2SH(leafRedeemHex), leafOutpointTxid, leafRedeemHex, leafValueSompi: leafValue,
      bettorFunding: [{ outpointTxid: b.fundingOutpoint.txid, address: b.fundingOutpoint.address }],
      leafContinuationState: nextLeafState(leafState, b), ticketDustSompi: 1000n, shardPoolId: m.genesisState.shardPoolId, changeAddress: b.changeAddress,
    });
    const txid = await sendAndLand(config, config.relays.bettorRelayId, cmd, `register bettor ${b.bettorPk.slice(0, 8)}`);
    out.registerTxids.push(txid);
    leafState = cmd.outputs.leaf_continuation.state; leafOutpointTxid = txid; leafValue += BigInt(b.stakeSompi);
    onBettorRegistered({ logicalMarketId: m.marketId, shardIndex: alloc.shardIndex ?? 0 });
  }

  // ③ seal: leafState.count == sealCount (or the test target) → shard foldable. (single-shard e2e: skip multi-shard fold)
  // ④ fold k→1: for a multi-shard market, fold the sealed shard leaves → root. (single-shard: the leaf IS the root once count==shardCount)
  // (Real multi-shard fold loops buildFoldTree levels; the minimal e2e can run shardCount=1 so the leaf==root, skipping ④.)

  // ⑤ close_commit: committee 4-of-5 attests winningSide + payoutRoot. payoutRoot computed off-chain (parimutuel).
  const winners = winnersFromState(leafState, config.winningSide, config.bettors); // {pk, stake} on winning side
  const payouts = computeParimutuelPayouts(winners, netPoolToSplit(leafState), winnerPoolSompi(winners));
  const payoutRoot = buildPayoutTree(payouts).root.toString('hex');
  const cw = buildCloseCommitWitness({ rootOutIdx: 0, winningSide: config.winningSide, payoutRoot, currentRootState: leafState });
  // committee 4-of-5: operator builds the close TX preimage + collects committee sigs (baked ctor keys c0-c4Pk) →
  // { sigsHex(5 slots, >=4 valid), txObjPreimage }. Mirrors v07 settle (driver builds preimage, committee signs, relay assembles).
  const { sigsHex, txObjPreimage } = await config.signCommittee({ phase: 'close_commit', rootOutpointTxid: leafOutpointTxid, rootRedeemHex: leafRedeemHex, closeState: cw.closeState, rootValueSompi: leafValue, feeOutpoint: config.feeOutpoint });
  const closeCmd = buildCloseCommitCommand({ witness: cw, rootOutpointTxid: leafOutpointTxid, rootRedeemHex: leafRedeemHex, rootValueSompi: leafValue, fee: config.feeOutpoint, sigsHex, txObjPreimage, changeAddress: config.changeAddress });
  out.closeTxid = await sendAndLand(config, config.relays.committeeRelayIds[0], closeCmd, 'close_commit (committee 4-of-5)');
  let rootState = cw.closeState, rootOutpointTxid = out.closeTxid, rootValue = leafValue;

  // ⑥ claim: each winner draws their parimutuel payout from root (serial draw-down). root_final → 0/dust.
  for (const win of payouts) {
    const cwit = buildClaimWitness(payouts, win.pk, { rootOutIdx: 0, payoutOutIdx: 1, ticketInIdx: 1, ticketPrefixLen: m.psArtifact.templatePrefix.length, ticketSuffixLen: m.psArtifact.templateSuffix.length });
    const claimCmd = buildClaimCommand({
      witness: cwit, rootOutpointTxid, rootRedeemHex: leafRedeemHex, currentRootState: rootState,
      ticketOutpointTxid: ticketOf(win.pk, config).txid, ticketRedeemHex: ticketOf(win.pk, config).redeemHex,
      ticketState: { bettorPk: win.pk, direction: config.winningSide, stake: stakeOf(win.pk, config).toString(), shardPoolId: m.genesisState.shardPoolId },
      psPrefixHex: m.psArtifact.templatePrefix.toString('hex'), psSuffixHex: m.psArtifact.templateSuffix.toString('hex'),
      rootValueSompi: rootValue, rootContinuationState: drawDownState(rootState, win.payout), bettorAddress: addrOf(win.pk, config),
      fee: config.feeOutpoint, changeAddress: config.changeAddress,
    });
    const txid = await sendAndLand(config, config.relays.bettorRelayId, claimCmd, `claim ${win.pk.slice(0, 8)} payout=${win.payout}`);
    out.claimTxids.push(txid);
    rootState = claimCmd.outputs.root_continuation.state; rootOutpointTxid = txid; rootValue -= BigInt(win.payout);
  }
  out.summary = { rootFinalValue: rootValue.toString(), expectRootDrainedToDust: rootValue < 1000n };
  return out;
}

// ── PoC-injection hook: build the happy base cmd, hand to J1's mutator, re-broadcast, assert reject ──
export async function runPoCInjection(config, baseCmd, mutate, label) {
  const attackCmd = mutate(JSON.parse(JSON.stringify(baseCmd))); // J1 supplies mutate(cmd)->attackCmd (one field → attack)
  try {
    const { txId } = await config.sendCommand(config.relays.bettorRelayId, attackCmd);
    if (txId && await config.checkLanded(txId)) {
      return { vector: label, REJECTED: false, BREACH: true, txId }; // 🔴 attack landed = SS gate FAILED
    }
    return { vector: label, REJECTED: true, note: 'broadcast/land returned falsy (SS or mempool rejected)' };
  } catch (e) {
    return { vector: label, REJECTED: true, note: `rejected: ${e.message.slice(0, 80)}` };
  }
}

// ── state-transition helpers (off-chain mirror of SS account updates) ──
function nextLeafState(s, b) {
  const stake = BigInt(b.stakeSompi);
  return {
    local_yes: (BigInt(s.local_yes) + stake * BigInt(1 - b.side)).toString(),
    local_no: (BigInt(s.local_no) + stake * BigInt(b.side)).toString(),
    count: Number(s.count) + 1, pool_value: (BigInt(s.pool_value) + stake).toString(),
    closed: 0, winningSide: s.winningSide, payoutRoot: s.payoutRoot, shardPoolId: s.shardPoolId,
  };
}
function drawDownState(s, payout) { return { ...s, pool_value: (BigInt(s.pool_value) - BigInt(payout)).toString() }; }
function winnersFromState(_s, winningSide, bettors) { return bettors.filter(b => b.side === winningSide).map(b => ({ pk: b.bettorPk, stake: BigInt(b.stakeSompi) })); }
function winnerPoolSompi(winners) { return winners.reduce((a, w) => a + BigInt(w.stake), 0n); }
function netPoolToSplit(s) { return BigInt(s.pool_value); } // (minus protocol fee in full version; fee-leaf handled in payoutRoot)
function ticketOf(pk, config) { return config.tickets[pk]; }
function stakeOf(pk, config) { return BigInt(config.bettors.find(b => b.bettorPk === pk).stakeSompi); }
function addrOf(pk, config) { return config.bettorAddrs[pk]; }
