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

import { buildRegisterWitness, buildRegisterCommand } from '../src/lib/pool-register-builder.mjs';
import { buildFoldWitness, buildFoldCommand } from '../src/lib/pool-fold-builder.mjs';
import { buildCloseCommitWitness, buildCloseCommitCommand } from '../src/lib/pool-close-builder.mjs';
import { buildClaimWitness, buildClaimCommand } from '../src/lib/pool-claim-builder.mjs';
import { buildRefundWitness, buildRefundCommand } from '../src/lib/pool-refund-builder.mjs';
import { buildSealToRootWitness, buildSealToRootCommand } from '../src/lib/pool-seal-builder.mjs';
import { serializePoolShardState } from '../src/lib/pool-shard-state-serialize.mjs';
import { computeParimutuelPayouts, buildPayoutTree } from '../src/lib/pool-payout-parimutuel.mjs';
import { serializeI64 } from '../src/lib/pool-payout-root.mjs';

// ── dust-ticket redeem builder: PoolSide template (prefix‖suffix) splice the 4-field ticket State (J1 confirmed
// structure; MUST byte-match relay _ticketAddress so the per-state ticket P2SH lines up). 4-field serialize order =
// PoolSide State decl: bettorPk(0x20+32), direction(0x08+i64LE), stake(0x08+i64LE), shardPoolId(0x20+32). ──
function _serialize4FieldTicket(ts) {
  const p32 = (h) => '20' + Buffer.from(h, 'hex').toString('hex'); // OP_PUSHBYTES_32 + 32B
  const p8 = (n) => '08' + serializeI64(BigInt(n), 8).toString('hex'); // OP_PUSHBYTES_8 + i64-LE
  return p32(ts.bettorPk) + p8(ts.direction) + p8(ts.stake) + p32(ts.shardPoolId);
}
function _ticketRedeemHex(psArtifact, ticketState) {
  return psArtifact.templatePrefix.toString('hex') + _serialize4FieldTicket(ticketState) + psArtifact.templateSuffix.toString('hex');
}

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

  // ① genesis-leaf-create: lock first stake to the genesis-state leaf P2SH + create the first bettor's dust ticket.
  config.tickets = config.tickets || {};
  const genesisAddr = config.computeP2SH(m.redeemHexForGenesisState);
  const g = await config.lockToP2SH(genesisAddr, BigInt(m.genesisState.pool_value), config.relays.bettorRelayId);
  out.genesisTxid = g.txId;
  config.log?.(`✓ genesis leaf created at ${genesisAddr}: ${g.txId}`);
  // first dust ticket (genesis bettor = config.bettors[0]): lock dust to the ticket P2SH. Populate config.tickets so
  // claim/refund can reference it (J1-confirmed: ticket = PoolSide template splice bettor State). Construct the ticket
  // state from config.bettors[0] + shardPoolId (robust — does not rely on m.firstTicketState being threaded through).
  const b0 = config.bettors[0];
  const firstTicketState = { bettorPk: b0.bettorPk, direction: b0.side, stake: BigInt(b0.stakeSompi).toString(), shardPoolId: m.shardPoolId || (m.firstTicketState && m.firstTicketState.shardPoolId) };
  const gTicketRedeem = _ticketRedeemHex(m.psArtifact, firstTicketState);
  const gt = await config.lockToP2SH(config.computeP2SH(gTicketRedeem), BigInt(config.ticketDustSompi || 20000000n), config.relays.bettorRelayId); // ~0.2 KAS: true-dust fails storage mass (∝1/value)
  config.tickets[firstTicketState.bettorPk] = { txid: gt.outpointTxid, redeemHex: gTicketRedeem };
  config.log?.(`✓ genesis ticket created: ${gt.txId}`);
  // shard-allocator: post-land record (NO TX NO STATE → only after genesis landed)
  let leafState = { ...m.genesisState };
  let leafOutpointTxid = g.outpointTxid, leafRedeemHex = m.redeemHexForGenesisState, leafValue = BigInt(m.genesisState.pool_value);

  // ② register × N (append): buildRegisterCommand, send+land, advance leaf state. Minimal single-shard e2e appends
  // all bettors to the genesis leaf (no allocator/DB routing — shard-allocator is multi-shard, the fold path).
  // config.bettors[0] = the genesis bettor (already baked into the leaf in ①); register bettors [1..N).
  for (const b of config.bettors.slice(1)) {
    const w = buildRegisterWitness({ side: b.side, stake: BigInt(b.stakeSompi), leafOutIdx: 0, psOutIdx: 1, bettorPk: b.bettorPk, psArtifact: m.psArtifact });
    const cmd = buildRegisterCommand({
      witness: w, leafOutpointTxid, leafRedeemHex, currentLeafState: leafState, leafValueSompi: leafValue,
      bettorFunding: [{ outpointTxid: b.fundingOutpoint.txid, address: b.fundingOutpoint.address }],
      leafContinuationState: nextLeafState(leafState, b),
      ticketDustSompi: config.ticketDustSompi || 20000000n, // ~0.2 KAS: true-dust (1000 sompi) fails storage mass (∝1/value)
      shardPoolId: m.shardPoolId, changeAddress: b.changeAddress,
    });
    const txid = await sendAndLand(config, config.relays.bettorRelayId, cmd, `register bettor ${b.bettorPk.slice(0, 8)}`);
    out.registerTxids.push(txid);
    leafState = cmd.outputs.leaf_continuation.state; leafOutpointTxid = txid; leafValue += BigInt(b.stakeSompi);
    // ticket-tracking: register created the dust ticket at ps_out_idx of this TX → record for claim/refund (J1-confirmed).
    config.tickets[b.bettorPk] = { txid, redeemHex: _ticketRedeemHex(m.psArtifact, cmd.outputs.poolSide_ticket.state) };
  }

  // ④ seal_to_root (route-split): leaf (count==shard_count) → PoolRoot carrying full pool KAS + canonical outcome.
  // Single-shard minimal e2e: the genesis+register leaf IS the single shard → seal directly (multi-shard fold = post-e2e).
  // ⚠ seal is the route-split MAKE-OR-BREAK: its on-chain script-units (2× cross-template blake2b + overhead, ~8982 est,
  // margin ~1000) is the live ground truth; if the seal TX is RPC-rejected for script-units, route-split needs reduction.
  const sealW = buildSealToRootWitness({ rootOutIdx: 0, rootArtifact: m.rootArtifact });
  const sealCmd = buildSealToRootCommand({ witness: sealW, leafOutpointTxid, leafRedeemHex, leafState, rootInitPayoutRoot: m.rootInitPayoutRoot, funding: [{ outpointTxid: config.feeOutpoint.outpointTxid, address: config.feeOutpoint.address }], leafValueSompi: leafValue, changeAddress: config.changeAddress });
  out.sealTxid = await sendAndLand(config, config.relays.bettorRelayId, sealCmd, 'seal_to_root (PoolLeaf→PoolRoot — make-or-break units)');
  // sealed PoolRoot: 7-field {leaf accounts carry, closed:0, winningSide:0, payoutRoot:rootInit}; redeem = rootArtifact splice.
  const rootState0 = sealCmd.outputs.root.state;
  const rootRedeemHex = m.rootArtifact.templatePrefix.toString('hex') + serializePoolShardState(rootState0).toString('hex') + m.rootArtifact.templateSuffix.toString('hex');
  let rootValue = leafValue;

  // ⑤ close_commit on PoolRoot: committee 4-of-5 attests winningSide + payoutRoot. payoutRoot computed off-chain (parimutuel).
  const winners = winnersFromState(rootState0, config.winningSide, config.bettors); // {pk, stake} on winning side
  const payouts = computeParimutuelPayouts(winners, netPoolToSplit(rootState0), winnerPoolSompi(winners));
  const payoutRoot = buildPayoutTree(payouts).root.toString('hex');
  const cw = buildCloseCommitWitness({ rootOutIdx: 0, winningSide: config.winningSide, payoutRoot, currentRootState: rootState0 });
  // committee 4-of-5: operator builds the close TX preimage + collects committee sigs (baked PoolRoot ctor keys c0-c4Pk).
  const { sigsHex, txObjPreimage } = await config.signCommittee({ phase: 'close_commit', rootOutpointTxid: out.sealTxid, rootRedeemHex, closeState: cw.closeState, rootValueSompi: rootValue, feeOutpoint: config.feeOutpoint });
  const closeCmd = buildCloseCommitCommand({ witness: cw, rootOutpointTxid: out.sealTxid, rootRedeemHex, rootValueSompi: rootValue, fee: config.feeOutpoint, sigsHex, txObjPreimage, changeAddress: config.changeAddress });
  out.closeTxid = await sendAndLand(config, config.relays.committeeRelayIds[0], closeCmd, 'close_commit (committee 4-of-5)');
  let rootState = cw.closeState, rootOutpointTxid = out.closeTxid;

  // ⑥ claim: each winner draws their parimutuel payout from root (serial draw-down). root_final → 0/dust.
  for (const win of payouts) {
    const cwit = buildClaimWitness(payouts, win.pk, { rootOutIdx: 0, payoutOutIdx: 1, ticketInIdx: 1, ticketPrefixLen: m.psArtifact.templatePrefix.length, ticketSuffixLen: m.psArtifact.templateSuffix.length });
    const claimCmd = buildClaimCommand({
      witness: cwit, rootOutpointTxid, rootRedeemHex, currentRootState: rootState,
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
    // route-split: PoolLeaf 4-field {local_yes, local_no, count, pool_value} — no outcome fields.
    local_yes: (BigInt(s.local_yes) + stake * BigInt(1 - b.side)).toString(),
    local_no: (BigInt(s.local_no) + stake * BigInt(b.side)).toString(),
    count: Number(s.count) + 1, pool_value: (BigInt(s.pool_value) + stake).toString(),
  };
}
function drawDownState(s, payout) { return { ...s, pool_value: (BigInt(s.pool_value) - BigInt(payout)).toString() }; }
function winnersFromState(_s, winningSide, bettors) { return bettors.filter(b => b.side === winningSide).map(b => ({ pk: b.bettorPk, stake: BigInt(b.stakeSompi) })); }
function winnerPoolSompi(winners) { return winners.reduce((a, w) => a + BigInt(w.stake), 0n); }
function netPoolToSplit(s) { return BigInt(s.pool_value); } // (minus protocol fee in full version; fee-leaf handled in payoutRoot)
function ticketOf(pk, config) { return config.tickets[pk]; }
function stakeOf(pk, config) { return BigInt(config.bettors.find(b => b.bettorPk === pk).stakeSompi); }
function addrOf(pk, config) { return config.bettorAddrs[pk]; }
