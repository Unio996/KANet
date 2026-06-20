// pool-seal-builder.mjs — bshard M3 route-split seal_to_root witness/command assembler (J2, 2026-06-15).
//
// Console-side assembly for the seal_to_root TX (PoolLeaf → PoolRoot cross-contract migration). When a leaf is
// fully folded (count==shard_count), seal_to_root produces the genesis PoolRoot carrying the full pool KAS, with
// canonical-open outcome (closed:0/winningSide:0 LITERAL, payoutRoot:root_init_payoutRoot CTOR-CONST → committee-
// bypass cannot move here). Models PoolLeaf seal_to_root (140a7317 entry OP_3). The relay (unlockBshardSeal) reveals
// the leaf, computes the PoolRoot foreign-template address, and creates the root output carrying the pool.
//
// seal_to_root witness order (PoolLeaf.sil): rootOutIdx, root_prefix, root_suffix (no sig — output constrained to
// canonical root; foreign-template verified blake2b(root_prefix‖root_suffix)==root_tmpl_hash baked in leaf ctor).
// On-chain welds (co-verified 140a7317): require(count==shard_count) + outcome canonical literal/ctor-const +
// validateOutputStateWithTemplate(rootOutIdx, {accounts carry, closed:0, winningSide:0, payoutRoot:root_init}, ...) +
// weld3 require(tx.outputs[rootOutIdx].value == pool_value) [cross-contract value conserve, full pool → root].

/**
 * Assemble the seal_to_root witness, self-verified against root_tmpl_hash.
 * @param {object} o { rootOutIdx, rootArtifact: { templatePrefix:Buffer, templateSuffix:Buffer, templateHashHex } }
 *                   rootArtifact = PoolRoot template (compile PoolRoot → extractTemplateArtifact; baked in leaf ctor as root_tmpl_hash)
 * @returns {object} witness { rootOutIdx, root_prefix(Buffer), root_suffix(Buffer), root_tmpl_hash }
 */
export function buildSealToRootWitness(o) {
  const { rootOutIdx, rootArtifact } = o;
  if (typeof rootOutIdx !== 'number' || rootOutIdx < 0) throw new Error(`rootOutIdx must be a non-negative int, got ${rootOutIdx}`);
  if (!rootArtifact || !Buffer.isBuffer(rootArtifact.templatePrefix) || !Buffer.isBuffer(rootArtifact.templateSuffix)) {
    throw new Error('rootArtifact {templatePrefix, templateSuffix, templateHashHex} required (compute from PoolRoot compile)');
  }
  return {
    rootOutIdx,
    root_prefix: rootArtifact.templatePrefix, root_suffix: rootArtifact.templateSuffix,
    root_tmpl_hash: rootArtifact.templateHashHex, // = root_tmpl_hash baked in PoolLeaf ctor (relay/on-chain verify blake2b(prefix‖suffix)==this)
  };
}

/**
 * Relay command for the seal_to_root TX. The relay (unlockBshardSeal) reveals the leaf (OP_3), computes the PoolRoot
 * foreign-template address (_foreignTemplateAddress(root_prefix, serializeRoot(sealedState), root_suffix)), and creates
 * the root output carrying the full pool KAS (weld3: root.value==leaf.pool_value). funding covers the miner fee.
 * sealedRootState = 7-field {leaf accounts carry, closed:0, winningSide:0, payoutRoot:root_init_payoutRoot} (canonical).
 * @returns {object} relay command (type='bshard_seal_to_root')
 */
export function buildSealToRootCommand({ witness, leafOutpointTxid, leafRedeemHex, leafState, rootInitPayoutRoot, funding, leafValueSompi, changeAddress, sealSelector = '53', carryFullState = null }) {
  // carryFullState (convert 用): 全 7-field {local_yes,local_no,count,pool_value,closed,winningSide,payoutRoot} 从 RootClose self carry。
  //   供则目标 state=carry(convert_to_claim/refundclaim, R2c outcome-from-self); 不供则 canonical seal state(closed:0)。
  // sealSelector: which seal_to_root entry to dispatch. PoolLeaf seal_to_root = entry OP_3 ('53', default = back-compat);
  // FoldNode (convert-split, abi 0:__leader_fold 1:__delegate_fold 2:seal_to_root) seal_to_root = entry OP_2 ('52').
  // leafRedeemHex/leafState accept the FoldNode redeem/state for the convert-split cascade — seal_to_root witness
  // {rootOutIdx, root_prefix, root_suffix} + 4-field state carry are byte-identical to PoolLeaf's (only selector differs).
  if (!leafOutpointTxid || !leafRedeemHex) throw new Error('leafOutpointTxid + leafRedeemHex (the sealed leaf/foldnode, count==shard_count) required');
  if (!leafState) throw new Error('leafState (4-field {local_yes,local_no,count,pool_value}) required for sealed root accounts');
  if (!carryFullState && !rootInitPayoutRoot) throw new Error('rootInitPayoutRoot (= seal canonical ZERO) required when carryFullState not provided');
  if (leafValueSompi == null) throw new Error('leafValueSompi (= leaf pool_value; weld3 root.value==pool_value) required');
  const poolValue = BigInt(leafValueSompi);
  if (poolValue.toString() !== BigInt(leafState.pool_value).toString()) {
    throw new Error(`seal value-conserve self-check FAILED: leafValueSompi ${poolValue} != leafState.pool_value ${leafState.pool_value} (weld3)`);
  }
  // target genesis state. SEAL (FoldNode→RootClose): outcome CANONICAL (closed:0/winningSide:0 literal, payoutRoot
  //   ctor-const) — committee-bypass cannot move to seal. CONVERT (RootClose→RootClaim/RefundClaim, carryFullState 供):
  //   全 7-field 从 RootClose 已委员盖章 self state CARRY(closed:1/2, real winningSide/payoutRoot) — R2c outcome-from-self。
  //   relay 用此 state 算 foreign-template 目标地址; 合约 validateOutputStateWithTemplate 验输出匹配(state 由 self fields 算)。
  const sealedRootState = carryFullState ? {
    local_yes: carryFullState.local_yes.toString(), local_no: carryFullState.local_no.toString(),
    count: Number(carryFullState.count), pool_value: poolValue.toString(),
    closed: Number(carryFullState.closed), winningSide: Number(carryFullState.winningSide), payoutRoot: carryFullState.payoutRoot,
  } : {
    local_yes: leafState.local_yes.toString(), local_no: leafState.local_no.toString(),
    count: Number(leafState.count), pool_value: poolValue.toString(),
    closed: 0, winningSide: 0, payoutRoot: rootInitPayoutRoot,
  };
  return {
    action: 'bshard_seal_to_root', type: 'bshard_seal_to_root', // relay dispatches on cmd.type
    witness: {
      root_out_idx: witness.rootOutIdx,
      root_prefix_hex: witness.root_prefix.toString('hex'), root_suffix_hex: witness.root_suffix.toString('hex'),
    },
    inputs: {
      // seal_selector_hex 放在 leaf(canonical unlockBshardSeal 读 cmd.inputs.leaf.seal_selector_hex, UI 集成 catch 对齐):
      //   PoolLeaf seal_to_root=OP_3('53') / FoldNode seal_to_root=OP_2('52') / RootClose convert_to_claim=OP_2('52') /
      //   convert_to_refundclaim=OP_3('53')。relay 默认 '53' 若缺。
      leaf: { outpointTxid: leafOutpointTxid, redeem_hex: leafRedeemHex, seal_selector_hex: sealSelector }, // relay _addressFromRedeem
      funding, // [{ address, outpointTxid }] P2PK (miner fee; leaf full pool → root)
    },
    // outputs: root — relay computes foreign-template addr (root_prefix‖serializeRoot(state)‖root_suffix); value == full pool (weld3)
    outputs: {
      root: { amountSompi: poolValue.toString(), state: sealedRootState },
      change_address: changeAddress,
    },
  };
}

// —— convert_to_claim / convert_to_refundclaim 薄 wrapper (RootClose→RootClaim/RefundClaim; J1 2026-06-20) ——
// 复用 buildSealToRootCommand(同 foreign-template 桥): leaf=RootClose, target=RootClaim/RefundClaim, carryFullState=RootClose
// 全 7-field settled/cancelled state(R2c outcome-from-self), selector RootClose abi convert_to_claim=OP_2('52')/convert_to_refundclaim=OP_3('53')。

/** RootClose.convert_to_claim (closed==1) → RootClaim. o: {rootCloseOutpointTxid, rootCloseRedeemHex, rootCloseState(7-field),
 *  claimWitness(buildSealToRootWitness{rootOutIdx:claimOutIdx, rootArtifact:RootClaim}), funding, valueSompi, changeAddress} */
export function buildConvertToClaimCommand(o) {
  return buildSealToRootCommand({
    witness: o.claimWitness, leafOutpointTxid: o.rootCloseOutpointTxid, leafRedeemHex: o.rootCloseRedeemHex,
    leafState: o.rootCloseState, funding: o.funding, leafValueSompi: o.valueSompi, changeAddress: o.changeAddress,
    sealSelector: '52', carryFullState: o.rootCloseState,
  });
}

/** RootClose.convert_to_refundclaim (closed==2) → RefundClaim. 同 buildConvertToClaimCommand, selector OP_3, target RefundClaim. */
export function buildConvertToRefundClaimCommand(o) {
  return buildSealToRootCommand({
    witness: o.rcWitness, leafOutpointTxid: o.rootCloseOutpointTxid, leafRedeemHex: o.rootCloseRedeemHex,
    leafState: o.rootCloseState, funding: o.funding, leafValueSompi: o.valueSompi, changeAddress: o.changeAddress,
    sealSelector: '53', carryFullState: o.rootCloseState,
  });
}
