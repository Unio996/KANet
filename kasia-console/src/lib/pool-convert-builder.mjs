// pool-convert-builder.mjs — Console-side assembly for the convert_to_foldnode TX (ShardLeaf → FoldNode
// cross-contract migration; convert-split J1 2026-06-19). When a sealed ShardLeaf (count==seal_count) converts,
// the relay (unlockBshardConvert) reveals the ShardLeaf, computes the FoldNode foreign-template address, and
// creates the FoldNode output carrying the 4-field pool state (NO outcome — FoldNode folds k→1 before seal_to_root).
//
// convert_to_foldnode witness order (ShardLeaf.sil): fnOutIdx, fn_prefix, fn_suffix (no sig — output constrained to
// canonical FoldNode; foreign-template verified blake2b(fn_prefix‖fn_suffix)==fn_tmpl_hash baked in ShardLeaf ctor).
// ShardLeaf.convert_to_foldnode = abi entry 1 = selector OP_1. On-chain:
//   require(count == seal_count) +
//   validateOutputStateWithTemplate(fnOutIdx, {local_yes, local_no, count, pool_value}, fn_prefix, fn_suffix, fn_tmpl_hash) +
//   weld require(tx.outputs[fnOutIdx].value == pool_value)  [cross-contract value conserve, full pool → FoldNode].
//
// Mirrors pool-seal-builder.mjs (foreign-template conversion); differs: FoldNode output is 4-field (no outcome),
// selector OP_1 (relay default '51' for this cmd.type vs seal '53'/'52').

/**
 * @param {object} o { fnOutIdx, fnArtifact: { templatePrefix:Buffer, templateSuffix:Buffer, templateHashHex } }
 *                   fnArtifact = FoldNode template (computeConvertSplitGenesis().foldNode; baked in ShardLeaf ctor as fn_tmpl_hash)
 * @returns {object} witness { fnOutIdx, fn_prefix(Buffer), fn_suffix(Buffer), fn_tmpl_hash }
 */
export function buildConvertWitness(o) {
  const { fnOutIdx, fnArtifact } = o;
  if (typeof fnOutIdx !== 'number' || fnOutIdx < 0) throw new Error(`fnOutIdx must be a non-negative int, got ${fnOutIdx}`);
  if (!fnArtifact || !Buffer.isBuffer(fnArtifact.templatePrefix) || !Buffer.isBuffer(fnArtifact.templateSuffix)) {
    throw new Error('fnArtifact {templatePrefix, templateSuffix, templateHashHex} required (computeConvertSplitGenesis().foldNode)');
  }
  return {
    fnOutIdx,
    fn_prefix: fnArtifact.templatePrefix, fn_suffix: fnArtifact.templateSuffix,
    fn_tmpl_hash: fnArtifact.templateHashHex, // = fn_tmpl_hash baked in ShardLeaf ctor (relay/on-chain verify blake2b(prefix‖suffix)==this)
  };
}

/**
 * Build the relay command for convert_to_foldnode. The relay (unlockBshardConvert) reveals the ShardLeaf, computes
 * the FoldNode foreign-template address (fn_prefix‖serializeLeaf(fnState)‖fn_suffix), and creates the FoldNode output.
 * FoldNode genesis state = 4-field carry from the sealed leaf (NO outcome). value weld: FoldNode value == leaf pool_value.
 * @param {object} o { witness(buildConvertWitness), leafOutpointTxid, leafRedeemHex(sealed ShardLeaf), leafState(4-field),
 *                     funding[{address,outpointTxid}], leafValueSompi(=leaf pool_value), changeAddress }
 * @returns {object} relay command (type='bshard_convert_to_foldnode')
 */
export function buildConvertCommand({ witness, leafOutpointTxid, leafRedeemHex, leafState, funding, leafValueSompi, changeAddress }) {
  if (!leafOutpointTxid || !leafRedeemHex) throw new Error('leafOutpointTxid + leafRedeemHex (the sealed ShardLeaf, count==seal_count) required');
  if (!leafState) throw new Error('leafState (4-field {local_yes,local_no,count,pool_value}) required for FoldNode carry');
  if (leafValueSompi == null) throw new Error('leafValueSompi (= leaf pool_value; weld FoldNode.value==pool_value) required');
  const poolValue = BigInt(leafValueSompi);
  if (poolValue.toString() !== BigInt(leafState.pool_value).toString()) {
    throw new Error(`convert value-conserve self-check FAILED: leafValueSompi ${poolValue} != leafState.pool_value ${leafState.pool_value} (weld)`);
  }
  // FoldNode genesis state = 4-field carry (NO outcome; FoldNode folds k→1, outcome lives in PoolRoot post-seal).
  const foldNodeState = {
    local_yes: leafState.local_yes.toString(), local_no: leafState.local_no.toString(),
    count: Number(leafState.count), pool_value: poolValue.toString(),
  };
  return {
    action: 'bshard_convert_to_foldnode', type: 'bshard_convert_to_foldnode', // relay dispatches on cmd.type
    witness: {
      fn_out_idx: witness.fnOutIdx,
      fn_prefix_hex: witness.fn_prefix.toString('hex'), fn_suffix_hex: witness.fn_suffix.toString('hex'),
    },
    inputs: {
      leaf: { outpointTxid: leafOutpointTxid, redeem_hex: leafRedeemHex }, // relay _addressFromRedeem
      funding, // [{ address, outpointTxid }] P2PK (miner fee; leaf full pool → FoldNode)
    },
    // outputs: foldnode — relay computes foreign-template addr (fn_prefix‖serializeLeaf(state)‖fn_suffix); value == full pool (weld)
    outputs: {
      foldnode: { amountSompi: poolValue.toString(), state: foldNodeState },
      change_address: changeAddress,
    },
  };
}
