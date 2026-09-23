// pool-register-builder.mjs — bshard register_append witness/command assembler (J2, 2026-06-15; M3-aligned 2026-06-15).
//
// Console-side assembly for a bettor's register_append.
// 🔴 D-020 移植(2026-09-23·Owner批·NWT审)：module 头原来写的是"M3 fold-carries-KAS: the bettor's stake is
// deposited INTO the shard-leaf pool [leaf.pool_value += stake, leaf UTXO value += stake]"——这段描述已经
// 陈旧，跟当前 ShardLeaf.sil 对不上了（该文件"v0.3: KAS 侧只剩 dust"，真实价值载体是 KanetTestToken 代币，
// 不再是 leaf 自己的 KAS 面值）。当前模型：leaf 自己的 KAS 输出面值全程不变（只要求 >= DUST_MIN，relay
// 原样把当前 leaf UTXO 的真实面值搬到续约输出，不做任何加算），下注真正的价值转移体现在
// tok_out（新铸/续的代币输出，amount = pool_value + stake，owner = leaf 自身 covenant id）。
// Routing to the open shard = shard-allocator.allocateForRegister. The relay builds/signs/broadcasts.
//
// register_append witness order（ShardLeaf.sil 当前 9 参数，D-020 移植后与 ShardLeaf_direct.sil 对齐）：
//   side, stake, leafOutIdx, psOutIdx, bettorPk, ps_prefix, ps_suffix, tok_out, tok_prefix, tok_suffix。
//   - stake 现在只是纯 witness（不再锚定任何 stake 筹码输入，D-020 判定"一枚筹码证明不了任何东西"）。
//   - 合并代币输出 tok_out 用 validateOutputStateWithTemplate 纯 witness/模板匹配断言
//     amount=pool_value+stake、owner=leaf 自身 covenant id（不锚定任何代币输入——但 register_append 内部
//     的 scanOwnedTokenInputs 仍然要求"归己既有持仓 == pool_value"，即第二笔起必须真实消费上一笔续约产出
//     的代币 UTXO 才能通过，见下方 tokenInput）。
//   - the dust-ticket carries 4 State fields: {bettorPk, direction:side, stake, shardPoolId}（不变）。
//   - ps_prefix/ps_suffix from my per-market PoolSide artifact（不变）；tok_prefix/tok_suffix from the global
//     KanetTestToken template artifact（pool-bshard-artifacts.computeKttTokenArtifact，跨 amount/owner 不变，
//     已实测确认）。

import { blake2b } from '@noble/hashes/blake2b';
import { blake3 } from '@noble/hashes/blake3';

/**
 * Assemble the register_append witness, self-verified against the leaf's baked ps_tmpl_hash / token_tmpl_hash.
 * @param {object} o { side, stake(bigint), leafOutIdx, psOutIdx, bettorPk(hex), tokOutIdx,
 *                     psArtifact: { templatePrefix:Buffer, templateSuffix:Buffer, templateHashHex },
 *                     tokArtifact: { templatePrefix:Buffer, templateSuffix:Buffer, templateHashHex } }
 * @returns {object} witness (ps_prefix/ps_suffix/tok_prefix/tok_suffix as Buffers) + ps_tmpl_hash/token_tmpl_hash
 */
export function buildRegisterWitness(o) {
  const { side, stake, leafOutIdx, psOutIdx, bettorPk, psArtifact, tokOutIdx, tokArtifact, dispatchTagHex } = o;
  if (!dispatchTagHex || typeof dispatchTagHex !== 'string') {
    throw new Error('dispatchTagHex (compileSilV100(...)._raw.contracts.ShardLeaf.entries.register_append.dispatch_tag, hex) required — v1.0.0 codegen 用 4 字节 dispatch_tag 当 PUSH-DATA 推, 不是裸 opcode 选择器');
  }
  if (side !== 0 && side !== 1) throw new Error(`side must be 0|1, got ${side}`);
  if (!(BigInt(stake) > 0n)) throw new Error(`stake must be > 0, got ${stake}`);
  for (const [k, v] of [['leafOutIdx', leafOutIdx], ['psOutIdx', psOutIdx], ['tokOutIdx', tokOutIdx]]) {
    if (typeof v !== 'number' || v < 0) throw new Error(`${k} must be a non-negative int, got ${v}`);
  }
  if (!bettorPk || typeof bettorPk !== 'string') throw new Error('bettorPk (hex) required');
  if (!psArtifact || !Buffer.isBuffer(psArtifact.templatePrefix) || !Buffer.isBuffer(psArtifact.templateSuffix)) {
    throw new Error('psArtifact {templatePrefix, templateSuffix, templateHashHex} required (pool-bshard-artifacts.computePoolSideArtifact)');
  }
  if (!tokArtifact || !Buffer.isBuffer(tokArtifact.templatePrefix) || !Buffer.isBuffer(tokArtifact.templateSuffix)) {
    throw new Error('tokArtifact {templatePrefix, templateSuffix, templateHashHex} required (pool-bshard-artifacts.computeKttTokenArtifact)');
  }
  // self-verify: blake2b(prefix‖suffix) == ps_tmpl_hash — 沿用既有 PoolSide 自验公式（legacy 编译器族）。
  const psHash = Buffer.from(blake2b(Buffer.concat([psArtifact.templatePrefix, psArtifact.templateSuffix]), { dkLen: 32 })).toString('hex');
  if (psHash !== psArtifact.templateHashHex) {
    throw new Error(`register witness self-verify FAILED(ps): blake2b(prefix‖suffix) ${psHash.slice(0, 12)} != ps_tmpl_hash ${psArtifact.templateHashHex.slice(0, 12)}`);
  }
  // token 侧模板自验公式不同（v1.0.0 编译器族，blake3(len8LE+prefix+len8LE+suffix)，见 extractTemplateArtifactV100
  // 内部已做过一次；这里对调用方传入的 templateHashHex 做一次独立核对，防止调用方传了跟 templatePrefix/Suffix
  // 不匹配的 hash 进来）。
  const le8 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const tokHash = Buffer.from(blake3(Buffer.concat([le8(tokArtifact.templatePrefix.length), tokArtifact.templatePrefix, le8(tokArtifact.templateSuffix.length), tokArtifact.templateSuffix]))).toString('hex');
  if (tokHash !== tokArtifact.templateHashHex) {
    throw new Error(`register witness self-verify FAILED(token): blake3(...) ${tokHash.slice(0, 12)} != token_tmpl_hash ${tokArtifact.templateHashHex.slice(0, 12)}`);
  }
  if (!tokArtifact.entryAbi?.dispatch_tag || !Number.isInteger(tokArtifact.stateFieldCount)) {
    throw new Error('tokArtifact.{entryAbi.dispatch_tag, stateFieldCount} required(用于消费上一笔续约代币输入的 transfer witness) — pool-bshard-artifacts.computeKttTokenArtifact 已经返回这两项，不用重编');
  }
  return {
    side, stake: BigInt(stake), leafOutIdx, psOutIdx, tokOutIdx, bettorPk,
    ps_prefix: psArtifact.templatePrefix, ps_suffix: psArtifact.templateSuffix,
    ps_tmpl_hash: psArtifact.templateHashHex, // for the leaf ctor (baked) — must match the deployed leaf
    tok_prefix: tokArtifact.templatePrefix, tok_suffix: tokArtifact.templateSuffix,
    tok_tmpl_hash: tokArtifact.templateHashHex,
    dispatch_tag: dispatchTagHex.replace(/^0x/, ''),
    // 消费上一笔续约代币输入(第二笔起)时, KanetTestToken.transfer 入口需要的 witness 参数——协议级常量,
    // 跟 amount/owner 无关(tokArtifact 是同一次编译产物的切面, 不用为此再编一次)。owner_input_idx 固定
    // 指向 leaf 自己在这笔交易里的 input 下标(始终是 0, 因为 leaf 永远是第一个 input——token 的 owner
    // 字段存的是 leafCovId, KanetTestToken.transferPolicy 要求 OpInputCovenantId(owner_input_idx[0])==owner)。
    token_transfer_dispatch_tag: tokArtifact.entryAbi.dispatch_tag,
    token_transfer_state_field_count: tokArtifact.stateFieldCount,
    token_owner_input_idx: 0,
  };
}

/**
 * Relay command for the register_append TX. The relay reveals the current leaf (register_append selector),
 * carries the leaf's own KAS UTXO value forward UNCHANGED (D-020: KAS 侧只剩 dust, 不再随 stake 增长),
 * mints/续续约代币（tok_out）+ a DUST PoolSide ticket:
 *   - [leafOutIdx] new leaf: SAME address (template P2SH, state-excluded), value = 原样搬运当前 leaf UTXO
 *     的真实面值（relay 侧读 matched UTXO 现取，不由 JS 算）, State {local_yes/no bumped, count+1,
 *     pool_value+stake} (= leafContinuationState)。
 *   - [tokOutIdx] 代币续约输出: 新铸/合并的 KanetTestToken, amount=pool_value+stake, owner=leaf 自身
 *     covenant id, scriptPubKeyHex = tokArtifact（调用方已用 computeKttTokenArtifact 算好）。
 *   - [psOutIdx]  dust PoolSide ticket: value = ticketDustSompi, State {bettorPk, direction:side, stake, shardPoolId}。
 * @param {object} o { witness, leafOutpointTxid, leafRedeemHex, currentLeafState, bettorFunding,
 *   tokenInput?: {outpointTxid, index, redeemHex}(前一笔续约产出的代币 UTXO——完整 redeem 字节, 不是
 *     scriptPubKey, relay 用同一套 payToScriptHashScript(redeemBytes) 手法自己算地址/匹配 UTXO, 跟 leaf
 *     input 的处理方式一致, 不盲信调用方传的地址；第一笔下注为 null——leaf 还没有任何续约代币可消费),
 *   tokContinuationRedeemHex(pool-bshard-artifacts.computeKttTokenArtifact 的 script, 完整 redeem 字节),
 *   tokDustSompi, leafContinuationState, ticketDustSompi, shardPoolId, changeAddress }
 * @returns {object} relay command (action='bshard_register_bet')
 */
export function buildRegisterCommand({ witness, leafOutpointTxid, leafRedeemHex, currentLeafState, bettorFunding, tokenInput = null, tokContinuationRedeemHex, tokDustSompi, leafContinuationState, ticketDustSompi, shardPoolId, changeAddress }) {
  if (!leafOutpointTxid) throw new Error('leafOutpointTxid (current shard leaf UTXO txid) required');
  if (!currentLeafState) throw new Error('currentLeafState (current leaf 4-field state; relay computes current per-state leaf address from redeem+current_state) required');
  if (!tokContinuationRedeemHex) throw new Error('tokContinuationRedeemHex (pool-bshard-artifacts.computeKttTokenArtifact 的 script hex) required');
  if (tokDustSompi == null) throw new Error('tokDustSompi (代币续约输出的 KAS dust 面值, >= DUST_MIN) required');
  const stake = BigInt(witness.stake);
  // route-split: PoolLeaf is 4-field {local_yes,local_no,count,pool_value} — NO outcome fields (closed/winningSide/
  // payoutRoot live in PoolRoot). leafContinuationState is the 4-field leaf state; no closed check (leaf has no closed).
  // relay handler (unlockBshardRegister) consumes: inputs.leaf.{redeem_hex, current_state, outpointTxid},
  // inputs.token?.{outpointTxid, index, redeemHex}(可选，第一笔下注为空),
  // inputs.funding[].{address, outpointTxid}; computes per-state leaf addr + token addr + ticket addr + change 自己算。
  return {
    action: 'bshard_register_bet', type: 'bshard_register_bet', // relay dispatches on cmd.type (relay.mjs switch(cmd.type))
    witness: {
      side: witness.side, stake: stake.toString(), leaf_out_idx: witness.leafOutIdx, ps_out_idx: witness.psOutIdx,
      tok_out_idx: witness.tokOutIdx, bettor_pk: witness.bettorPk,
      ps_prefix_hex: witness.ps_prefix.toString('hex'), ps_suffix_hex: witness.ps_suffix.toString('hex'),
      tok_prefix_hex: witness.tok_prefix.toString('hex'), tok_suffix_hex: witness.tok_suffix.toString('hex'),
      dispatch_tag_hex: witness.dispatch_tag,
      token_transfer_dispatch_tag_hex: witness.token_transfer_dispatch_tag,
      token_transfer_state_field_count: witness.token_transfer_state_field_count,
      token_owner_input_idx: witness.token_owner_input_idx,
    },
    inputs: {
      leaf: { outpointTxid: leafOutpointTxid, redeem_hex: leafRedeemHex, current_state: currentLeafState },
      token: tokenInput, // null = 第一笔下注（scanOwnedTokenInputs 天然扫到 0，等于 genesis pool_value=0）
      funding: bettorFunding, // [{ outpointTxid, address }] P2PK wallet UTXOs (relay finds + wallet-签名)
    },
    // outputs: leaf_continuation（relay 原样搬运当前 leaf UTXO 真实面值，不加算）+ tok_continuation（新铸/续
    // 代币输出）+ dust ticket {bettorPk,direction,stake,shardPoolId}（relay 计算 ticket addr）+ change。
    outputs: {
      leaf_continuation: { state: leafContinuationState || null },
      tok_continuation: { redeem_hex: tokContinuationRedeemHex, amountSompi: String(tokDustSompi) },
      poolSide_ticket: { amountSompi: ticketDustSompi != null ? String(ticketDustSompi) : null, state: { bettorPk: witness.bettorPk, direction: witness.side, stake: stake.toString(), shardPoolId: shardPoolId || (leafContinuationState && leafContinuationState.shardPoolId) || null } },
      change_address: changeAddress,
    },
  };
}
