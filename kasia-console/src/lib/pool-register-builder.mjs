// pool-register-builder.mjs — bshard register_bet witness/command assembler (J2, 2026-06-15, integration builder 3/3 Console).
//
// Console-side assembly for a bettor's register_bet (= the shard-leaf covenant that covenant-accumulates
// local_yes/no by the bettor's PoolSide deposit). Routing to the open shard = shard-allocator.allocateForRegister.
// The relay builds/signs/broadcasts the register_bet TX (leaf spend + PoolSide create + new leaf continuation).
//
// register_bet witness order (J1 PoolShard_fold fix-a L50-61): side, psOutIdx, leafOutIdx, bettorPk, spineP2shHash,
// poolMerkleRoot, marketMetadataHash, ps_deadline, ps_prefix, ps_suffix. ps_prefix/ps_suffix come from my
// per-market PoolSide artifact (pool-bshard-artifacts.computePoolSideArtifact); the leaf ctor bakes ps_tmpl_hash
// (= blake2b(ps_prefix‖ps_suffix)) + spine_p2sh_hash — both per-market, from the pipeline.

import { blake2b } from '@noble/hashes/blake2b';

/**
 * Assemble the register_bet witness, self-verified against the leaf's baked ps_tmpl_hash.
 * @param {object} o {
 *   side, psOutIdx, leafOutIdx, bettorPk(hex), spineP2shHash(hex), poolMerkleRoot(hex), marketMetadataHash(hex),
 *   psDeadline, psArtifact: { templatePrefix:Buffer, templateSuffix:Buffer, templateHashHex } }
 * @returns {object} witness (ps_prefix/ps_suffix as Buffers) + ps_tmpl_hash (for the leaf ctor)
 */
export function buildRegisterWitness(o) {
  const { side, psOutIdx, leafOutIdx, bettorPk, spineP2shHash, poolMerkleRoot, marketMetadataHash, psDeadline, psArtifact } = o;
  if (side !== 0 && side !== 1) throw new Error(`side must be 0|1, got ${side}`);
  if (!psArtifact || !Buffer.isBuffer(psArtifact.templatePrefix) || !Buffer.isBuffer(psArtifact.templateSuffix)) {
    throw new Error('psArtifact {templatePrefix, templateSuffix, templateHashHex} required (pool-bshard-artifacts.computePoolSideArtifact)');
  }
  // self-verify: blake2b(prefix‖suffix) == ps_tmpl_hash (= the SS require(blake2b(ps_prefix‖ps_suffix)==ps_tmpl_hash);
  // a mismatch → the relay would build a register TX that the leaf covenant rejects).
  const tmplHash = Buffer.from(blake2b(Buffer.concat([psArtifact.templatePrefix, psArtifact.templateSuffix]), { dkLen: 32 })).toString('hex');
  if (tmplHash !== psArtifact.templateHashHex) {
    throw new Error(`register witness self-verify FAILED: blake2b(prefix‖suffix) ${tmplHash.slice(0, 12)} != ps_tmpl_hash ${psArtifact.templateHashHex.slice(0, 12)}`);
  }
  return {
    side, psOutIdx, leafOutIdx,
    bettorPk, spineP2shHash, poolMerkleRoot, marketMetadataHash, ps_deadline: psDeadline,
    ps_prefix: psArtifact.templatePrefix, ps_suffix: psArtifact.templateSuffix,
    ps_tmpl_hash: psArtifact.templateHashHex, // for the leaf ctor (baked) — must match the deployed leaf
  };
}

/**
 * Relay command for the register_bet TX. The relay reveals the current leaf (register_bet selector), creates the
 * bettor's PoolSide deposit output (value = stake), and the new leaf continuation (local_yes/no bumped).
 * @returns {object} relay command (action='bshard_register_bet')
 */
export function buildRegisterCommand({ witness, leafOutpoint, leafRedeemHex, bettorFundingOutpoints, stakeSompi, poolSideAddress, newLeafStateHint, changeAddress }) {
  if (!leafOutpoint) throw new Error('leafOutpoint (current shard leaf UTXO) required');
  if (!(BigInt(stakeSompi) > 0n)) throw new Error('stakeSompi must be > 0');
  return {
    action: 'bshard_register_bet',
    witness: {
      side: witness.side, ps_out_idx: witness.psOutIdx, leaf_out_idx: witness.leafOutIdx,
      bettor_pk: witness.bettorPk, spine_p2sh_hash: witness.spineP2shHash, pool_merkle_root: witness.poolMerkleRoot,
      market_metadata_hash: witness.marketMetadataHash, ps_deadline: witness.ps_deadline,
      ps_prefix_hex: witness.ps_prefix.toString('hex'), ps_suffix_hex: witness.ps_suffix.toString('hex'),
    },
    inputs: { leaf: { ...leafOutpoint, redeem_hex: leafRedeemHex }, funding: bettorFundingOutpoints },
    outputs: { poolSide: { address: poolSideAddress, amountSompi: BigInt(stakeSompi).toString() }, new_leaf_state_hint: newLeafStateHint, change_address: changeAddress },
  };
}
