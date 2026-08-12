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
//    权威 = **构造方传进来的 `templatePrefix.length`** —— 拼这份 redeem 的人手上就有它
//    （`scripts/bshard-e2e-flow.mjs:114`：`rootRedeem = templatePrefix + state + templateSuffix`
//     ⇒ `start ≡ templatePrefix.length`）。本常量只在传入值与本 typed 路径的已知族不符时**喊出手滑**。
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
export function buildRefundCommand({ witness, poolOutpointTxid, poolRedeemHex, poolTemplatePrefixHex, currentPoolState, ticketOutpointTxid, ticketRedeemHex, ticketState, poolValueSompi, bettorAddress, poolContinuationState, changeAddress }) {
  if (!poolOutpointTxid || !ticketOutpointTxid) throw new Error('poolOutpointTxid + ticketOutpointTxid required');
  // 🔴 **权威 = 拼装这份 redeem 用的模板前缀本身**（Codex `0741bae0`：字面量作唯一权威 = REJECTED）。
  //    收前缀而不是收一个数，是因为**数可以被随手填对，而前缀能被验**：
  //    `rootRedeem = templatePrefix + state + templateSuffix`（`scripts/bshard-e2e-flow.mjs:114`）
  //    ⇒ ① `start ≡ templatePrefix.length` 由它**派生**，不是申报；
  //       ② 且必须**验证这份 redeem 确实以该前缀开头** —— 这一步把「描述符」与「实际会上链的那段脚本」
  //          绑在一起，正是 Codex 要的"绑定 redeem 身份"。
  if (typeof poolTemplatePrefixHex !== 'string' || !/^[0-9a-fA-F]+$/.test(poolTemplatePrefixHex) || poolTemplatePrefixHex.length % 2 !== 0) {
    throw new Error('poolTemplatePrefixHex required (拼 pool redeem 用的模板前缀 hex) — 缺失/非法即 fail-closed, 不默认');
  }
  if (typeof poolRedeemHex !== 'string' || !poolRedeemHex.toLowerCase().startsWith(poolTemplatePrefixHex.toLowerCase())) {
    throw new Error('poolRedeemHex 不以 poolTemplatePrefixHex 开头 ⇒ 该前缀不是这份 redeem 的模板 ⇒ 拒（描述符必须绑到实际脚本上）');
  }
  //    ⚠ **作用域注(@J1tn 19:50Z 二审)**: 本路径的气密性**有一半来自下面那道族断言钉死长度**，
  //       不是 `startsWith` 单独给的 —— `startsWith` 挡不住**前缀截断**(传模板前缀的更短前段:
  //       它照样是 redeem 的前缀, 照样过 startsWith, 却派生出更小的 start)。这里之所以安全，
  //       是因为族断言把派生值钉死在 1，可接受的前缀只剩 redeem 自己的第一个字节。
  //       🔴 **将来 start≠1 的路径若只抄 `startsWith` 而不配等价的钉法, 这道绑定就是漏的。**
  const poolStateStart = poolTemplatePrefixHex.length / 2;   // ← 派生, 非申报
  // 🔵 常量在这里**只作防御断言**：它不产生权威，只在派生值与本 typed 路径（PoolRoot 多-entry）
  //    的已知族不符时把手滑/换模板喊出来。
  if (poolStateStart !== POOLROOT_STATE_START) {
    throw new Error(`派生 state_start=${poolStateStart} 与本 typed 路径(bshard_refund_cancelled ⇒ PoolRoot 多-entry, ${POOLROOT_STATE_START}) 不符 ⇒ 拒`);
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
