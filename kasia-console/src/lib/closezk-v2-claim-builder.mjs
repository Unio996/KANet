// closezk-v2-claim-builder.mjs — CloseZkV2 claim witness/command assembler (J2, 2026-07-08).
// 设计文档: docs/2026-07-08-closezkv2-claim-driver-design.md(NWT GREEN-with-conditions, Bettor 终GO)。
//
// CloseZkV2 是 state-in-address 模板冻结合约(`kasia-console/src/lib/CloseZkV2.sil`)——续约地址靠在固定 213B
// 状态区内 byte-splice 产生(见 kasia-relay/src/lib/p2sh.mjs unlockBshardZkClose:2153-2169), 不是 V1 PayoutShard
// 那种"重编译算新地址"模型。parseCloseZkV2State 是 unlockBshardZkClose splice 写入逻辑的精确反向 parse——
// 两边独立实现, 靠 round-trip 测试(见 closezk-v2-claim-builder.test.mjs)互证, 不是靠"文本声明共享"。
//
// verify-value-source 铁律(Bettor #bjucwr 直接指令): w0-16(nullifier bitmap)/consolidated_pool/closed/
// payoutRootField 全部现读现解, 不接受 DB 缓存/caller 声称的 state 当权威——本文件的 parseCloseZkV2State
// 只认当前活 UTXO 的 redeem_hex 本身。
//
// payouts(全量 leaf 列表)权威源(Bettor #bk28lo②裁定): 必须调 computePariMutuelPayout(与 guest 电路/
// zk-prove-enqueue.mjs:75 同一份公开确定性算法)独立重算, 不读任何 DB payout 缓存表——"重算+链根双锁":
// leaf 集合来自独立重算, 树根来自链上现读绑定, 两条独立来源互证。

import { computePariMutuelPayout } from './pool-shard-settle.mjs';
import { payoutRoot, merkleProof, climbProof, payoutLeaf } from './pool-payout-root.mjs';

// ── CloseZkV2 213B 状态区 offset 表(unlockBshardZkClose splice 写入逻辑的精确反向, p2sh.mjs:2153-2169) ──
//   区域起点 = redeem_hex 的 offset 1(_POOL_STATE_START 同款: byte 0 是 selector-dispatch 前导, 不属于状态区)。
//   每个 int 字段前有 1B 的 push-length marker(int=0x08/byte32=0x20), parse 时校验 marker 匹配期望值——
//   marker 不对 = offset 表本身跟当次编译产物脱节(今晚 72.31KAS anchor offset 过期同一形状), fail-closed 而非静默读错值。
const _STATE_START = 1;
const _STATE_LEN = 213;
const _OFF = {
  attestedWinner: 0,      // marker@0(push8), value@1..9
  closed: 9,               // marker@9(push8), value@10..18
  payoutRootField: 18,     // marker@18(push32), value@19..51
  consolidated_pool: 51,   // marker@51(push8), value@52..60
  wWordsStart: 60,         // 17 words × 9B(1B marker + 8B value) = 153B, 60..213
};
const _NULLIFIER_WORDS = 17;

/**
 * parseCloseZkV2State — 从当前活 CloseZkV2 UTXO 的 redeem_hex 现读现解状态区(verify-value-source 铁律落地)。
 * @param {string} redeemHex  当前活 UTXO 的完整 redeem script hex(链上实况, 非 DB 缓存字段)
 * @returns {{attestedWinner:number, closed:number, payoutRootField:string, consolidated_pool:string,
 *   w0..w16:string}}
 */
export function parseCloseZkV2State(redeemHex) {
  const redeem = Buffer.from(String(redeemHex || ''), 'hex');
  if (redeem.length < _STATE_START + _STATE_LEN) {
    throw new Error(`parseCloseZkV2State: redeem 太短(${redeem.length}B, 需 >= ${_STATE_START + _STATE_LEN}) — 非 CloseZkV2 redeem?`);
  }
  const region = redeem.slice(_STATE_START, _STATE_START + _STATE_LEN);
  const readI64 = (markerOff, expectMarker) => {
    if (region[markerOff] !== expectMarker) {
      throw new Error(`parseCloseZkV2State: offset ${markerOff} 期望 marker 0x${expectMarker.toString(16)}, 实际 0x${region[markerOff]?.toString(16)} — offset 表跟实际 redeem 布局脱节, 拒绝往下读(同今晚 anchor-offset 过期同一形状, 不静默继续)`);
    }
    return region.readBigInt64LE(markerOff + 1);
  };
  const attestedWinner = Number(readI64(_OFF.attestedWinner, 0x08));
  const closed = Number(readI64(_OFF.closed, 0x08));
  if (region[_OFF.payoutRootField] !== 0x20) {
    throw new Error(`parseCloseZkV2State: offset ${_OFF.payoutRootField} 期望 marker 0x20(push32), 实际 0x${region[_OFF.payoutRootField]?.toString(16)}`);
  }
  const payoutRootField = region.slice(_OFF.payoutRootField + 1, _OFF.payoutRootField + 1 + 32).toString('hex');
  const consolidated_pool = readI64(_OFF.consolidated_pool, 0x08);
  const w = {};
  for (let i = 0; i < _NULLIFIER_WORDS; i++) {
    w['w' + i] = readI64(_OFF.wWordsStart + 9 * i, 0x08).toString();
  }
  if (attestedWinner !== 0 && attestedWinner !== 1) {
    throw new Error(`parseCloseZkV2State: attestedWinner=${attestedWinner} 不是 0/1 — 解码位置可能错位, 拒绝往下传递可疑值(同 readPayoutShardV2AttestedState 同款 fail-closed 纪律)`);
  }
  if (closed !== 2) {
    throw new Error(`parseCloseZkV2State: closed=${closed} != 2 — claim 只服务 zk_close 已完成待 claim 的窗口(closed==2), 拒绝读取(escape_claim 域是 closed==3, 走独立路径)`);
  }
  return { attestedWinner, closed, payoutRootField, consolidated_pool: consolidated_pool.toString(), ...w };
}

/**
 * nullifier bit 当前是否已置位(逐 word: word_idx=merkleIndex/63, bit_in=merkleIndex%63, 同 .sil claim entry
 * 逻辑/unlockBshardPayoutClaim word_idx/bitIn 算法一致)。
 */
function _nullifierBitSet(state, merkleIndex) {
  const wordIdx = Math.floor(merkleIndex / 63), bitIn = merkleIndex % 63;
  if (wordIdx >= _NULLIFIER_WORDS) throw new Error(`merkle_index ${merkleIndex} → word_idx ${wordIdx} 越界(cap ${_NULLIFIER_WORDS} words)`);
  const w = BigInt(state['w' + wordIdx] ?? 0);
  return ((w >> BigInt(bitIn)) & 1n) === 1n;
}

/**
 * buildClaimWitness — 组装单个 winner 的 claim witness, self-verify 后才返回(不自验通过绝不喂给 relay)。
 * @param {string} winnerPkHex  这个 winner 的 pk(必须在重算出的 payoutLeaves 里)
 * @param {number} merkleIndex  这个 winner 在 payoutLeaves 里的 canonical 下标(computePariMutuelPayout 输出序:
 *   winner leaves 在前, fee leaves 在后, 见 pool-shard-settle.mjs:58-61)
 * @param {object} currentState  parseCloseZkV2State() 现读产物(权威源, 非 DB 缓存)
 * @param {{bettors:Array, feeLeaves:Array, poolTotalAtZkCloseSompi:string|bigint}} ctx
 *   - bettors/feeLeaves: 喂给 computePariMutuelPayout 独立重算(不读 DB payout 缓存表, Bettor #bk28lo②)
 *   - poolTotalAtZkCloseSompi: **zk_close 落链那一刻**的 consolidated_pool(payoutRootField 是那一刻的树,
 *     不随后续 claim 递减而变)。⚠ 不是 currentState.consolidated_pool(那是活着的、逐笔递减的剩余池子)——
 *     两者只在"第一次 claim 之前"数值相等, 第二个及以后的 claimant 这两个值必然不同。调用方必须显式提供,
 *     不允许从 currentState 反推(那正是会引入 poolTotal 用错值的一类 bug, 靠这个显式参数从源头堵住)。
 * @returns {{bettorPk, payout:bigint, merkle_index, siblings:Buffer[], payoutRootFieldHex}}
 */
export function buildClaimWitness(winnerPkHex, merkleIndex, currentState, { bettors, feeLeaves, poolTotalAtZkCloseSompi }) {
  if (poolTotalAtZkCloseSompi == null) throw new Error('buildClaimWitness: poolTotalAtZkCloseSompi 必需(zk_close 落链时刻的 pool 值, 非当前剩余池)');
  const pm = computePariMutuelPayout({
    bettors, winningDirection: currentState.attestedWinner, poolTotalSompi: poolTotalAtZkCloseSompi, feeLeaves,
  });
  if (pm.degenerate) throw new Error(`buildClaimWitness: computePariMutuelPayout degenerate(${pm.reason}) — 无赢家场景不该走 claim 路径`);
  const payouts = pm.payoutLeaves.map(l => ({ pk: l.pk, amount: BigInt(l.amount) }));
  if (merkleIndex < 0 || merkleIndex >= payouts.length || payouts[merkleIndex].pk !== winnerPkHex) {
    throw new Error(`buildClaimWitness: merkle_index ${merkleIndex} 处的 pk 不是 ${winnerPkHex.slice(0, 12)}(重算出的 payoutLeaves 顺序对不上, 拒绝组装)`);
  }
  const payout = payouts[merkleIndex].amount;
  if (payout < 1n) throw new Error(`buildClaimWitness: payout ${payout} < 1`);
  if (payout > BigInt(currentState.consolidated_pool)) {
    throw new Error(`buildClaimWitness: payout ${payout} > 当前活剩余池 ${currentState.consolidated_pool} — 这个 winner 大概率已经 claim 过或数据不一致`);
  }
  // ★ 权威源双锁 ①: 重算出的 payoutLeaves 树根必须等于链上现读的 payoutRootField(否则本地 self-verify 挡下, 不喂给 relay)。
  const root = payoutRoot(payouts);
  if (root.toString('hex') !== currentState.payoutRootField) {
    throw new Error(`buildClaimWitness: 重算 payoutRoot(${root.toString('hex').slice(0, 16)}) != 链上现读 payoutRootField(${currentState.payoutRootField.slice(0, 16)}) — bettors/feeLeaves/poolTotal 输入跟 zk_close 那次实际 mint 用的不一致, 拒绝组装`);
  }
  const siblings = merkleProof(payouts, merkleIndex);
  // ★ 权威源双锁 ②: climb 自验证(同 pool-claim-builder.mjs 套路, 装出来的 witness 必须自己能爬回 root)。
  const climbed = climbProof(payoutLeaf(winnerPkHex, payout), merkleIndex, siblings);
  if (!climbed.equals(Buffer.from(currentState.payoutRootField, 'hex'))) {
    throw new Error(`buildClaimWitness: climb self-verify FAILED for ${winnerPkHex.slice(0, 12)}(不应该发生, root 已经匹配却 climb 不回——merkle_index/siblings 装配有 bug)`);
  }
  // ★ nullifier 本地防呆(链上 require 是最后一道防线, 非唯一防线): 目标 bit 现读必须还是 0。
  if (_nullifierBitSet(currentState, merkleIndex)) {
    throw new Error(`buildClaimWitness: merkle_index ${merkleIndex} 的 nullifier bit 已置位 — ${winnerPkHex.slice(0, 12)} 已经 claim 过, 拒绝重复组装`);
  }
  return { bettorPk: winnerPkHex, payout, merkle_index: merkleIndex, siblings, payoutRootFieldHex: currentState.payoutRootField };
}

/**
 * buildClaimCommand — 组装 relay 命令(action='closezk_v2_claim')。字段命名对齐 CloseZkV2.sil claim 形参声明序
 * (selfOutIdx/payoutOutIdx/bettorPk/payout/merkle_index/s0..s9)。
 * @returns {object} relay command
 */
export function buildClaimCommand({ witness, closezkOutpointTxid, closezkRedeemHex, currentState, feeOutpointTxid, feeAddress, selfOutIdx, payoutOutIdx, bettorAddress, changeAddress }) {
  if (!closezkOutpointTxid || !feeOutpointTxid) throw new Error('closezkOutpointTxid + feeOutpointTxid 必需(claim 不留 fee 余量, 必须独立 fee input, 同 unlockBshardPayoutClaim 纪律)');
  if (!bettorAddress) throw new Error('bettorAddress(P2PK(bettorPk), payout 收款地址) 必需');
  const siblingsHex = witness.siblings.map(s => s.toString('hex'));
  while (siblingsHex.length < 10) siblingsHex.push('00'.repeat(32));   // depth-10 固定 10 步, 不足补零(同 escape_claim/claim .sil 展开步数一致)
  return {
    action: 'closezk_v2_claim', type: 'closezk_v2_claim',
    witness: {
      self_out_idx: selfOutIdx, payout_out_idx: payoutOutIdx,
      bettor_pk: witness.bettorPk, payout: witness.payout.toString(), merkle_index: witness.merkle_index,
      siblings_hex: siblingsHex,
    },
    inputs: {
      closezk: { outpointTxid: closezkOutpointTxid, redeem_hex: closezkRedeemHex, state: currentState },
      fee: { outpointTxid: feeOutpointTxid, address: feeAddress },
    },
    outputs: { payout: { address: bettorAddress, amountSompi: witness.payout.toString() }, change_address: changeAddress },
  };
}
