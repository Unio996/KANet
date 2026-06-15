// pool-register-builder.mjs — bshard register_append witness/command assembler (J2, 2026-06-15; M3-aligned 2026-06-15).
//
// Console-side assembly for a bettor's register_append (M3 fold-carries-KAS: the bettor's stake is deposited INTO
// the shard-leaf pool [leaf.pool_value += stake, leaf UTXO value += stake], and a DUST PoolSide ticket is created
// as the spent-once claim/refund marker). Models PoolShard_fold register_append (aa041d91 entry 0, L53-86).
// Routing to the open shard = shard-allocator.allocateForRegister. The relay builds/signs/broadcasts.
//
// register_append witness order (aa041d91 L54-60): side, stake, leafOutIdx, psOutIdx, bettorPk, ps_prefix, ps_suffix.
//   - stake is a witness output-bind-welded to leaf value (weld1: out[leafOutIdx].value == pool_value + stake) = 真存.
//   - the dust-ticket carries 4 State fields: {bettorPk, direction:side, stake, shardPoolId} (validateOutputStateWithTemplate).
//   - ps_prefix/ps_suffix from my per-market PoolSide artifact (computePoolSideArtifact); the leaf ctor bakes
//     ps_tmpl_hash (= blake2b(ps_prefix‖ps_suffix)) + shard_pool_id.
// M3 drops the pre-M3 fix-a witness fields (spineP2shHash/poolMerkleRoot/marketMetadataHash/ps_deadline): the M3
// PoolSide State is the 4-field dust-ticket, and the stake lives in the leaf (not the PoolSide).

import { blake2b } from '@noble/hashes/blake2b';

/**
 * Assemble the register_append witness, self-verified against the leaf's baked ps_tmpl_hash.
 * @param {object} o { side, stake(bigint), leafOutIdx, psOutIdx, bettorPk(hex),
 *                     psArtifact: { templatePrefix:Buffer, templateSuffix:Buffer, templateHashHex } }
 * @returns {object} witness (ps_prefix/ps_suffix as Buffers) + ps_tmpl_hash (for the leaf ctor)
 */
export function buildRegisterWitness(o) {
  const { side, stake, leafOutIdx, psOutIdx, bettorPk, psArtifact } = o;
  if (side !== 0 && side !== 1) throw new Error(`side must be 0|1, got ${side}`);
  if (!(BigInt(stake) > 0n)) throw new Error(`stake must be > 0, got ${stake}`);
  for (const [k, v] of [['leafOutIdx', leafOutIdx], ['psOutIdx', psOutIdx]]) {
    if (typeof v !== 'number' || v < 0) throw new Error(`${k} must be a non-negative int, got ${v}`);
  }
  if (!bettorPk || typeof bettorPk !== 'string') throw new Error('bettorPk (hex) required');
  if (!psArtifact || !Buffer.isBuffer(psArtifact.templatePrefix) || !Buffer.isBuffer(psArtifact.templateSuffix)) {
    throw new Error('psArtifact {templatePrefix, templateSuffix, templateHashHex} required (pool-bshard-artifacts.computePoolSideArtifact)');
  }
  // self-verify: blake2b(prefix‖suffix) == ps_tmpl_hash (= the SS validateOutputStateWithTemplate(...,ps_tmpl_hash)
  // template check; a mismatch → the relay would build a register TX that the leaf covenant rejects).
  const tmplHash = Buffer.from(blake2b(Buffer.concat([psArtifact.templatePrefix, psArtifact.templateSuffix]), { dkLen: 32 })).toString('hex');
  if (tmplHash !== psArtifact.templateHashHex) {
    throw new Error(`register witness self-verify FAILED: blake2b(prefix‖suffix) ${tmplHash.slice(0, 12)} != ps_tmpl_hash ${psArtifact.templateHashHex.slice(0, 12)}`);
  }
  return {
    side, stake: BigInt(stake), leafOutIdx, psOutIdx, bettorPk,
    ps_prefix: psArtifact.templatePrefix, ps_suffix: psArtifact.templateSuffix,
    ps_tmpl_hash: psArtifact.templateHashHex, // for the leaf ctor (baked) — must match the deployed leaf
  };
}

/**
 * Relay command for the register_append TX. The relay reveals the current leaf (register_append selector), funds
 * the stake INTO the new leaf (leaf value += stake) + a DUST PoolSide ticket, and creates both continuations:
 *   - [leafOutIdx] new leaf: SAME address (template P2SH, state-excluded), value = leaf_value + stake, State
 *     {local_yes/no bumped, count+1, pool_value+stake, closed:0, winningSide, payoutRoot} (= leafContinuationState).
 *   - [psOutIdx]  dust PoolSide ticket: value = ticketDustSompi, State {bettorPk, direction:side, stake, shardPoolId}.
 * value-conserve self-check (mirrors weld1): leaf_out == leaf_value + stake (stake deposited into leaf, NOT the ticket).
 * @returns {object} relay command (action='bshard_register_bet')
 */
export function buildRegisterCommand({ witness, leafOutpointTxid, leafRedeemHex, currentLeafState, bettorFunding, leafValueSompi, leafContinuationState, ticketDustSompi, shardPoolId, changeAddress }) {
  if (!leafOutpointTxid) throw new Error('leafOutpointTxid (current shard leaf UTXO txid) required');
  if (!currentLeafState) throw new Error('currentLeafState (current leaf 7-field state; relay computes current per-state leaf address from redeem+current_state) required');
  if (leafValueSompi == null) throw new Error('leafValueSompi (current leaf UTXO value) required');
  const stake = BigInt(witness.stake);
  const leafValue = BigInt(leafValueSompi);
  const newLeafValue = leafValue + stake; // weld1: stake deposited into the leaf
  if (leafContinuationState && leafContinuationState.closed !== 0) {
    throw new Error(`register leaf continuation must keep closed=0 (open pool), got ${leafContinuationState.closed}`);
  }
  // relay handler (unlockBshardRegister) consumes: inputs.leaf.{redeem_hex, current_state, outpointTxid},
  // inputs.funding[].{address, outpointTxid}; computes per-state leaf addr + ticket addr + change itself.
  return {
    action: 'bshard_register_bet', type: 'bshard_register_bet', // relay dispatches on cmd.type (relay.mjs switch(cmd.type))
    witness: {
      side: witness.side, stake: stake.toString(), leaf_out_idx: witness.leafOutIdx, ps_out_idx: witness.psOutIdx,
      bettor_pk: witness.bettorPk,
      ps_prefix_hex: witness.ps_prefix.toString('hex'), ps_suffix_hex: witness.ps_suffix.toString('hex'),
    },
    inputs: {
      leaf: { outpointTxid: leafOutpointTxid, redeem_hex: leafRedeemHex, current_state: currentLeafState },
      funding: bettorFunding, // [{ outpointTxid, address }] P2PK wallet UTXOs (relay finds + wallet-signs)
    },
    // outputs: leaf_continuation (relay computes per-state addr; value+=stake, closed=0) + dust ticket
    // {bettorPk,direction,stake,shardPoolId} (relay computes ticket addr) + change (relay computes amount).
    outputs: {
      leaf_continuation: { amountSompi: newLeafValue.toString(), state: leafContinuationState || null },
      poolSide_ticket: { amountSompi: ticketDustSompi != null ? String(ticketDustSompi) : null, state: { bettorPk: witness.bettorPk, direction: witness.side, stake: stake.toString(), shardPoolId: shardPoolId || (leafContinuationState && leafContinuationState.shardPoolId) || null } },
      change_address: changeAddress,
    },
  };
}
