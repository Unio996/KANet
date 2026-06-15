// pool-claim-builder.mjs — bshard claim_draw witness/command assembler (J2, 2026-06-15; M3-aligned 2026-06-15).
//
// Console-side assembly for a winner's claim_draw TX (M3 fold-carries-KAS: winner draws their parimutuel payout
// directly from the ROOT market-pool, serial draw-down). Models PoolShard_fold claim_draw (aa041d91 entry 3,
// L154-205). The relay builds/signs/broadcasts:
//   - reveals the ROOT pool UTXO (claim_draw selector) + the winner's PoolSide dust-ticket (spent-once),
//   - merkle-proves payout ∈ payoutRoot (committee-attested at close_commit), pays the winner P2PK(bettorPk)=payout,
//   - recreates the root continuation: SAME address (template P2SH, state-excluded) + value = pool_value - payout,
//     state closed:1 preserved (claim does NOT change outcome; only draws down pool_value).
//
// claim_draw witness order (aa041d91 L155-166): rootOutIdx, payoutOutIdx, payout, merkle_index, tree_depth,
// siblings[], ticketInIdx, ticket_prefix_len, ticket_suffix_len. payout/index/siblings come from the
// committee-attested payoutRoot (my pool-payout-parimutuel). The dust-ticket gives eligibility on-chain
// (tk.shardPoolId == shard_pool_id ∧ tk.direction == winningSide). NO spine (pre-M3 spine-passthrough removed).
//
// On-chain welds (aa041d91): closed==1 gate / payout∈[1000, pool_value] / merkle climb == payoutRoot /
// payout output == P2PK(tk.bettorPk) exact / weld4 require(out[rootOutIdx].value == pool_value - payout).

import { payoutMerkleProof, climbPayoutProof, buildPayoutTree } from './pool-payout-parimutuel.mjs';

/**
 * Assemble the claim_draw witness for one winner, self-verified against the payoutRoot.
 * @param {Array<{pk:string, payout:bigint}>} payouts  canonical (pk-ASC) payouts from computeParimutuelPayouts
 * @param {string} winnerPkHex  this winner's pk (must be in payouts)
 * @param {object} pos  { rootOutIdx, payoutOutIdx, ticketInIdx, ticketPrefixLen, ticketSuffixLen }
 *                      root continuation + payout output positions + dust-ticket input position & template lens
 * @returns {{ bettorPk, payout:bigint, merkle_index, tree_depth, siblings:Buffer[], rootOutIdx, payoutOutIdx,
 *            ticketInIdx, ticket_prefix_len, ticket_suffix_len, payoutRootHex }}
 */
export function buildClaimWitness(payouts, winnerPkHex, pos) {
  const merkleIndex = payouts.findIndex(p => p.pk === winnerPkHex);
  if (merkleIndex < 0) throw new Error(`winner ${winnerPkHex} not in payouts (loser/unknown → no claim)`);
  const payout = payouts[merkleIndex].payout;
  const siblings = payoutMerkleProof(payouts, merkleIndex);
  const treeDepth = siblings.length;
  // self-verify: the assembled witness MUST climb to the payoutRoot (else the relay would build a rejected TX)
  const root = buildPayoutTree(payouts).root;
  const climbed = climbPayoutProof(winnerPkHex, payout, merkleIndex, siblings);
  if (!climbed.equals(root)) throw new Error(`claim witness self-verify FAILED: climb != payoutRoot for ${winnerPkHex}`);
  if (treeDepth > 8) throw new Error(`tree_depth ${treeDepth} > 8 (route-split PoolRoot claim merkleMAX 8 = 256-winner/market cap; depth-16 exceeded seal script-units)`);
  for (const [k, v] of [['rootOutIdx', pos?.rootOutIdx], ['payoutOutIdx', pos?.payoutOutIdx], ['ticketInIdx', pos?.ticketInIdx],
    ['ticketPrefixLen', pos?.ticketPrefixLen], ['ticketSuffixLen', pos?.ticketSuffixLen]]) {
    if (typeof v !== 'number' || v < 0) throw new Error(`pos.${k} must be a non-negative int, got ${v}`);
  }
  return {
    bettorPk: winnerPkHex,
    payout,
    merkle_index: merkleIndex,
    tree_depth: treeDepth,
    siblings,
    rootOutIdx: pos.rootOutIdx,
    payoutOutIdx: pos.payoutOutIdx,
    ticketInIdx: pos.ticketInIdx,
    ticket_prefix_len: pos.ticketPrefixLen,
    ticket_suffix_len: pos.ticketSuffixLen,
    payoutRootHex: root.toString('hex'),
  };
}

/**
 * Assemble the relay claim command (I/O spec for the relay TX builder). The relay reveals ROOT + dust-ticket,
 * pays the winner P2PK(bettorPk)=payout, and recreates the root continuation (SAME address, value pool_value-payout,
 * state closed:1 preserved + pool_value-=payout). The new root State region is given by `rootContinuationState`
 * for the relay to serialize. value-conserve weld (on-chain weld4) self-checked: payout + root_out == pool_value.
 * @returns {object} relay command (action='bshard_claim_winner')
 */
export function buildClaimCommand({ witness, rootOutpointTxid, rootRedeemHex, currentRootState, ticketOutpointTxid, ticketRedeemHex, ticketState, psPrefixHex, psSuffixHex, rootValueSompi, rootContinuationState, bettorAddress, fee, changeAddress }) {
  if (!rootOutpointTxid || !ticketOutpointTxid) throw new Error('rootOutpointTxid + ticketOutpointTxid required');
  if (!currentRootState) throw new Error('currentRootState (current root 7-field state; relay computes current per-state root address) required');
  if (!ticketState) throw new Error('ticketState {bettorPk, direction, stake, shardPoolId} (relay computes ticket address) required');
  if (!psPrefixHex || !psSuffixHex) throw new Error('psPrefixHex + psSuffixHex (PoolSide template; relay computes ticket address) required');
  if (!bettorAddress) throw new Error('bettorAddress (P2PK(bettorPk); payout recipient) required');
  if (rootValueSompi == null) throw new Error('rootValueSompi (current root UTXO value) required');
  const rootValue = BigInt(rootValueSompi);
  const payout = BigInt(witness.payout);
  const rootOut = rootValue - payout;
  if (rootOut < 0n) throw new Error(`claim value-conserve FAILED: payout ${payout} > root pool_value ${rootValue}`);
  // value-conserve self-check (mirrors on-chain weld4 + payout bind): payout + root_out == pool_value.
  if (payout + rootOut !== rootValue) throw new Error('claim value-conserve self-check FAILED: payout + root_out != pool_value');
  if (rootContinuationState && rootContinuationState.closed !== 1) {
    throw new Error(`claim root continuation must keep closed=1 (settled; claim does not change outcome), got ${rootContinuationState.closed}`);
  }
  // relay handler (unlockBshardClaim) consumes: inputs.root.{redeem_hex, current_state, outpointTxid},
  // inputs.ticket.{redeem_hex, state, outpointTxid}, witness.{ps_prefix_hex, ps_suffix_hex} (ticket addr metadata,
  // NOT pushed on-chain), inputs.fee.{address, outpointTxid}; computes per-state root/ticket addr + change itself.
  return {
    action: 'bshard_claim_winner', type: 'bshard_claim_winner', // relay dispatches on cmd.type (relay.mjs switch(cmd.type))
    witness: {
      root_out_idx: witness.rootOutIdx, payout_out_idx: witness.payoutOutIdx,
      payout: payout.toString(), merkle_index: witness.merkle_index, tree_depth: witness.tree_depth,
      siblings_hex: witness.siblings.map(s => s.toString('hex')),
      ticket_in_idx: witness.ticketInIdx, ticket_prefix_len: witness.ticket_prefix_len, ticket_suffix_len: witness.ticket_suffix_len,
      bettor_pk: witness.bettorPk,
      ps_prefix_hex: psPrefixHex, ps_suffix_hex: psSuffixHex, // ticket-address metadata (relay-only; NOT in on-chain push)
    },
    inputs: {
      root: { outpointTxid: rootOutpointTxid, redeem_hex: rootRedeemHex, current_state: currentRootState },
      ticket: { outpointTxid: ticketOutpointTxid, redeem_hex: ticketRedeemHex, state: ticketState },
      fee: fee ? { outpointTxid: fee.outpointTxid, address: fee.address } : null,
    },
    // outputs: payout → bettor P2PK; root_continuation (relay computes per-state addr; value-=payout, closed=1); change (relay computes amount)
    outputs: {
      payout: { address: bettorAddress, amountSompi: payout.toString() },
      root_continuation: { amountSompi: rootOut.toString(), state: rootContinuationState || null },
      change_address: changeAddress,
    },
  };
}
