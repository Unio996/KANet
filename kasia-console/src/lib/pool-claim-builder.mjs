// pool-claim-builder.mjs — bshard self-claim witness assembler (J2, 2026-06-15, integration builder 2/3).
//
// Console-side assembly for a winner's claim_winner TX. The relay builds/signs/broadcasts the actual TX (model:
// bettor-refund-claim-auto.mjs → relay command). This produces the deterministic witness + I/O spec; the relay
// handler reveals the PoolSide + spine, recreates the spine (claim_passthrough), and pays the winner.
//
// claim_winner witness order (J1 PoolSide_v08_shard L45-53): bettorSig(relay signs), payout, merkle_index,
// tree_depth, siblings[], spine_in_idx, spine_prefix_len, spine_suffix_len. payout/index/siblings come from the
// committee-attested payoutRoot (my pool-payout-parimutuel). spine_prefix/suffix_len from the spine artifact.

import { payoutMerkleProof, climbPayoutProof, buildPayoutTree } from './pool-payout-parimutuel.mjs';

/**
 * Assemble the claim_winner witness for one winner, self-verified against the payoutRoot.
 * @param {Array<{pk:string, payout:bigint}>} payouts  canonical (pk-ASC) payouts from computeParimutuelPayouts
 * @param {string} winnerPkHex  this winner's pk (must be in payouts)
 * @param {object} spine  { inIdx, prefixLen, suffixLen }  spine close-commit input position + template lens (artifact)
 * @returns {{ bettorPk:string, payout:bigint, merkle_index:number, tree_depth:number, siblings:Buffer[],
 *            spine_in_idx:number, spine_prefix_len:number, spine_suffix_len:number, payoutRootHex:string }}
 */
export function buildClaimWitness(payouts, winnerPkHex, spine) {
  const merkleIndex = payouts.findIndex(p => p.pk === winnerPkHex);
  if (merkleIndex < 0) throw new Error(`winner ${winnerPkHex} not in payouts (loser/unknown → no claim)`);
  const payout = payouts[merkleIndex].payout;
  const siblings = payoutMerkleProof(payouts, merkleIndex);
  const treeDepth = siblings.length;
  // self-verify: the assembled witness MUST climb to the payoutRoot (else the relay would build a rejected TX)
  const root = buildPayoutTree(payouts).root;
  const climbed = climbPayoutProof(winnerPkHex, payout, merkleIndex, siblings);
  if (!climbed.equals(root)) throw new Error(`claim witness self-verify FAILED: climb != payoutRoot for ${winnerPkHex}`);
  if (!spine || typeof spine.inIdx !== 'number' || typeof spine.prefixLen !== 'number' || typeof spine.suffixLen !== 'number') {
    throw new Error('spine {inIdx, prefixLen, suffixLen} required');
  }
  return {
    bettorPk: winnerPkHex,
    payout,
    merkle_index: merkleIndex,
    tree_depth: treeDepth,
    siblings,
    spine_in_idx: spine.inIdx,
    spine_prefix_len: spine.prefixLen,
    spine_suffix_len: spine.suffixLen,
    payoutRootHex: root.toString('hex'),
  };
}

/**
 * Assemble the relay claim command (I/O spec for the relay TX builder). The relay reveals PoolSide + spine,
 * recreates the spine (passthrough, identical closeCommit state), pays the winner, and signs/broadcasts.
 * spineCloseCommitStateHex = the 93B serialized close-commit (pool-close-commit serializeCloseCommitState) — the
 * relay re-emits it byte-identical on the recreated spine output (passthrough recreate-identical).
 * @returns {object} relay command (action='bshard_claim_winner')
 */
export function buildClaimCommand({ witness, poolSideOutpoint, poolSideRedeemHex, spineOutpoint, spineRedeemHex, spineCloseCommitStateHex, feeOutpoint, bettorAddress, changeAddress }) {
  if (!poolSideOutpoint || !spineOutpoint) throw new Error('poolSideOutpoint + spineOutpoint required');
  return {
    action: 'bshard_claim_winner',
    witness: {
      payout: witness.payout.toString(),
      merkle_index: witness.merkle_index,
      tree_depth: witness.tree_depth,
      siblings_hex: witness.siblings.map(s => s.toString('hex')),
      spine_in_idx: witness.spine_in_idx,
      spine_prefix_len: witness.spine_prefix_len,
      spine_suffix_len: witness.spine_suffix_len,
      bettor_pk: witness.bettorPk,
    },
    inputs: { poolSide: { ...poolSideOutpoint, redeem_hex: poolSideRedeemHex }, spine: { ...spineOutpoint, redeem_hex: spineRedeemHex }, fee: feeOutpoint },
    // outputs: [0] payout → bettor P2PK; [1] recreated spine (passthrough, identical close-commit state); [2] change
    outputs: { payout: { address: bettorAddress, amountSompi: witness.payout.toString() }, recreated_spine_state_hex: spineCloseCommitStateHex, change_address: changeAddress },
  };
}
