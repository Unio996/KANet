// pool-refund-builder.mjs — bshard refund_draw witness/command assembler (J2, 2026-06-15, integration builder 3/3b).
//
// Console-side assembly for a refund_draw TX (market cancelled/timed-out → bettor reclaims their own stake 1:1).
// Models PoolShard_fold refund_draw (b1e9ca14 entry 4, L202-238). The relay builds/signs/broadcasts:
//   - reveals the pool UTXO (refund_draw selector) + the bettor's PoolSide ticket (spent-once),
//   - pays the bettor P2PK(tk.bettorPk) = tk.stake,
//   - recreates the pool continuation: SAME address (template P2SH, state-excluded) + value = pool_value - stake,
//     with the State flipped closed=2 (F2 cancel latch) + pool_value -= stake (all other State fields unchanged).
//
// refund_draw witness order (b1e9ca14 L203-208): poolOutIdx, payoutOutIdx, ticketInIdx, ticket_prefix_len,
// ticket_suffix_len. refund is PERMISSIONLESS (no sig — anyone may trigger; funds go to the ticket's bettor via
// P2PK(tk.bettorPk)). ticket_prefix/suffix_len come from my per-market PoolSide artifact (same template as register).
//
// On-chain welds re-verified (b1e9ca14): L209 require(closed != 1) + L210 require(tx.time >= (deadline+7200)*1000)
// (timeout gate) + ticket shardPoolId == shard_pool_id + L238 weld5 require(out[poolOutIdx].value == pool_value - tk.stake).
// closed flips 0→2 (write-once latch): first refund implicit-cancels, blocking late close (require closed==0). See F2 fix.

import { blake2b } from '@noble/hashes/blake2b';

// PoolRoot（多-entry，selector dispatch 前导 1B）的 state_layout.start —— **仅作防御断言用**。
// 🔴 **它不是权威**（Codex `0741bae0` 明裁：字面量作唯一权威 = REJECTED）。
// 🔨 **CP3 更新（2026-08-13）**：权威**不再是** CP2 那版的「构造方传进来的 `templatePrefix.length`」——
//    它与真权威**恒等但远一跳**，而那一跳正落在"构造方自觉传对前缀"上，即 Codex 抓的松散点。
//    **权威 = silverc 吐出的 `state_layout.start`**（`computePoolRootArtifact()`，零跳）。
//    本常量只在该值与本 typed 路径的已知族不符时**喊出手滑**。
const POOLROOT_STATE_START = 1;

/**
 * Assemble the refund_draw witness, self-verified against the PoolSide ticket's baked ps_tmpl_hash.
 * @param {object} o {
 *   poolOutIdx, payoutOutIdx, ticketInIdx,                       // output/input positions
 *   psArtifact: { templatePrefix:Buffer, templateSuffix:Buffer, templateHashHex },  // PoolSide template (= register's)
 *   bettorPk(hex), stake(bigint) }                               // ticket fields (refund pays P2PK(bettorPk) = stake)
 * @returns {object} witness (ticket_prefix/suffix as Buffers) + bettorPk + stake
 */
export function buildRefundWitness(o) {
  const { poolOutIdx, payoutOutIdx, ticketInIdx, psArtifact, bettorPk, stake } = o;
  for (const [k, v] of [['poolOutIdx', poolOutIdx], ['payoutOutIdx', payoutOutIdx], ['ticketInIdx', ticketInIdx]]) {
    if (typeof v !== 'number' || v < 0) throw new Error(`${k} must be a non-negative int, got ${v}`);
  }
  if (!psArtifact || !Buffer.isBuffer(psArtifact.templatePrefix) || !Buffer.isBuffer(psArtifact.templateSuffix)) {
    throw new Error('psArtifact {templatePrefix, templateSuffix, templateHashHex} required (pool-bshard-artifacts.computePoolSideArtifact)');
  }
  if (!bettorPk || typeof bettorPk !== 'string') throw new Error('bettorPk (ticket owner, hex) required');
  if (!(BigInt(stake) > 0n)) throw new Error(`stake must be > 0, got ${stake}`);
  // self-verify: blake2b(prefix‖suffix) == ps_tmpl_hash (= the on-chain readInputStateWithTemplate(...,ps_tmpl_hash)
  // template check; a mismatch → the relay would build a refund TX the covenant rejects on the ticket read).
  const tmplHash = Buffer.from(blake2b(Buffer.concat([psArtifact.templatePrefix, psArtifact.templateSuffix]), { dkLen: 32 })).toString('hex');
  if (tmplHash !== psArtifact.templateHashHex) {
    throw new Error(`refund witness self-verify FAILED: blake2b(prefix‖suffix) ${tmplHash.slice(0, 12)} != ps_tmpl_hash ${psArtifact.templateHashHex.slice(0, 12)}`);
  }
  return {
    poolOutIdx, payoutOutIdx, ticketInIdx,
    ticket_prefix: psArtifact.templatePrefix, ticket_suffix: psArtifact.templateSuffix,
    ticket_prefix_len: psArtifact.templatePrefix.length, ticket_suffix_len: psArtifact.templateSuffix.length,
    ps_tmpl_hash: psArtifact.templateHashHex,
    bettorPk, stake: BigInt(stake),
  };
}

/**
 * Relay command for the refund_draw TX. The relay reveals the pool (refund_draw selector) + the PoolSide ticket,
 * pays the bettor (P2PK(bettorPk) = stake), and recreates the pool continuation (SAME address, value pool_value-stake,
 * State flipped closed=2 + pool_value-=stake). The new pool State region is given by `poolContinuationState` for the
 * relay to serialize (closed=2 latch + unchanged local_yes/no/count/winningSide/payoutRoot). value-conserve weld
 * (on-chain L238) self-checked here: payout(stake) + pool_out(poolValue-stake) == poolValue (no value created).
 * @returns {object} relay command (action='bshard_refund_cancelled')
 */
export function buildRefundCommand({ witness, poolOutpointTxid, poolRedeemHex, poolRootArtifact, expectedRootTmplHashHex, currentPoolState, ticketOutpointTxid, ticketRedeemHex, ticketState, poolValueSompi, bettorAddress, poolContinuationState, changeAddress }) {
  if (!poolOutpointTxid || !ticketOutpointTxid) throw new Error('poolOutpointTxid + ticketOutpointTxid required');
  // ── CP3 (J2 2026-08-13; @J1tn (205) 升级, @Bettor 21:0xZ 采纳为设计定向) ───────────────
  // 权威 = **silverc 吐出的 `state_layout.start`**（零跳）, 不再从调用方给的前缀长度反推。
  // 认证 = **一步跨边界比**: 用这份 redeem 自己的 prefix‖suffix 算 blake2b, 与**另一端**烤死的
  //        `root_tmpl_hash` 比。另一端必须来自构造记录/链上烤死值 —— **不能**是同一次编译的输出,
  //        否则左右同源、比不出任何东西（CP3 §4）。
  // 🔵 这一比同时覆盖 **suffix 段**（原方案只绑前缀+总长, suffix 异的 redeem 会漏到远处才报错, @J1tn (205)）。
  // 🔴 **不写"hash 钉住了切分点"** —— 那句已被 @J1tn (208) 自己 + Codex `66d5f287` 撤回。
  //    本比对认证的是**模板身份**; 链上原语的 prefix_len 由 witness 传, 不归构造侧管。
  if (!poolRootArtifact || !Array.isArray(poolRootArtifact.script) || !poolRootArtifact.state_layout) {
    throw new Error('poolRootArtifact {script, state_layout} required (computePoolRootArtifact) — 缺失即 fail-closed, 不默认');
  }
  const { start: poolStateStart, len: poolStateLen } = poolRootArtifact.state_layout;
  if (!Number.isInteger(poolStateStart) || !Number.isInteger(poolStateLen)) {
    throw new Error(`poolRootArtifact.state_layout.{start,len} 必须是整数, 得到 {${poolStateStart}, ${poolStateLen}}`);
  }
  if (typeof expectedRootTmplHashHex !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedRootTmplHashHex)) {
    throw new Error('expectedRootTmplHashHex required (32B hex; 源=构造记录/链上烤死 root_tmpl_hash, 非同次编译产物)');
  }
  if (typeof poolRedeemHex !== 'string' || !/^[0-9a-fA-F]+$/.test(poolRedeemHex) || poolRedeemHex.length % 2 !== 0) {
    throw new Error('poolRedeemHex 必须是偶数长 hex');
  }
  const poolRedeem = Buffer.from(poolRedeemHex, 'hex');
  if (poolRedeem.length !== poolRootArtifact.script.length) {
    throw new Error(`poolRedeemHex 长度 ${poolRedeem.length} 与 PoolRoot 模板总长 ${poolRootArtifact.script.length} 不符 ⇒ 拒`);
  }
  const actualTmplHash = Buffer.from(blake2b(
    Buffer.concat([poolRedeem.subarray(0, poolStateStart), poolRedeem.subarray(poolStateStart + poolStateLen)]),
    { dkLen: 32 },
  )).toString('hex');
  if (actualTmplHash !== expectedRootTmplHashHex.toLowerCase()) {
    throw new Error(`pool redeem 模板认证失败: blake2b(prefix‖suffix)=${actualTmplHash.slice(0, 12)} != 烤死 root_tmpl_hash ${expectedRootTmplHashHex.slice(0, 12)} ⇒ 拒`);
  }
  // 🔵 CP2 那版(收松散 poolTemplatePrefixHex + startsWith + 常量族断言)已被上方单步比对取代。
  //    保留一条防御断言: 派生值若与本 typed 路径已知族不符, 喊出手滑/换模板(它不产生权威)。
  if (poolStateStart !== POOLROOT_STATE_START) {
    throw new Error(`state_layout.start=${poolStateStart} 与本 typed 路径(bshard_refund_cancelled ⇒ PoolRoot 多-entry, ${POOLROOT_STATE_START}) 不符 ⇒ 拒`);
  }
  if (!currentPoolState) throw new Error('currentPoolState (current pool 7-field state; relay computes current per-state pool address) required');
  if (!ticketState) throw new Error('ticketState {bettorPk, direction, stake, shardPoolId} (relay computes ticket address) required');
  if (!bettorAddress) throw new Error('bettorAddress (P2PK(bettorPk); refund recipient) required');
  if (poolValueSompi == null) throw new Error('poolValueSompi (current pool UTXO value) required');
  const poolValue = BigInt(poolValueSompi);
  const stake = BigInt(witness.stake);
  const poolOut = poolValue - stake;
  if (poolOut < 0n) throw new Error(`refund value-conserve FAILED: stake ${stake} > pool_value ${poolValue}`);
  // value-conserve self-check (mirrors on-chain weld5 + payout bind): payout + pool_out == pool_value.
  if (stake + poolOut !== poolValue) throw new Error('refund value-conserve self-check FAILED: payout + pool_out != pool_value');
  if (poolContinuationState && poolContinuationState.closed !== 2) {
    throw new Error(`refund pool continuation must set closed=2 (F2 cancel latch), got ${poolContinuationState.closed}`);
  }
  // relay handler (unlockBshardRefund) consumes: inputs.pool.{redeem_hex, current_state, outpointTxid},
  // inputs.ticket.{redeem_hex, state, outpointTxid}, witness.{ps_prefix_hex, ps_suffix_hex} (ticket-addr metadata);
  // computes per-state pool/ticket addr + change itself. (ps_prefix/suffix derived from the witness template buffers.)
  return {
    action: 'bshard_refund_cancelled', type: 'bshard_refund_cancelled', // relay dispatches on cmd.type (relay.mjs switch(cmd.type))
    witness: {
      pool_out_idx: witness.poolOutIdx, payout_out_idx: witness.payoutOutIdx, ticket_in_idx: witness.ticketInIdx,
      ticket_prefix_len: witness.ticket_prefix_len, ticket_suffix_len: witness.ticket_suffix_len,
      ps_prefix_hex: witness.ticket_prefix.toString('hex'), ps_suffix_hex: witness.ticket_suffix.toString('hex'),
      bettor_pk: witness.bettorPk,
    },
    inputs: {
      // `state_start` = 构造方传进来的权威值（已在函数头做存在性 + 族一致断言）。
      pool: {
        outpointTxid: poolOutpointTxid, redeem_hex: poolRedeemHex, current_state: currentPoolState,
        state_start: poolStateStart,
      },
      ticket: { outpointTxid: ticketOutpointTxid, redeem_hex: ticketRedeemHex, state: ticketState },
    },
    // outputs: refund → bettor P2PK = stake; pool_continuation (relay computes per-state addr; value-=stake, closed=2); change (relay computes amount)
    outputs: {
      payout: { address: bettorAddress, amountSompi: stake.toString() },
      pool_continuation: { amountSompi: poolOut.toString(), state: poolContinuationState || null },
      change_address: changeAddress,
    },
  };
}
