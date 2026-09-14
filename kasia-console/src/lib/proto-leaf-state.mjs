// proto-leaf-state.mjs — bet_mint 步骤 B(register_append)构造前必须先算清楚的三件事(Bettor 1428
// 复核订正, 撤销"新加 4 列存当前 state"的方案): 状态从已落链记录推算(不单独存储, 防漂移), 同一市场
// append 串行(in-flight 拒绝), 构造前 fail-closed 核对库与链是否一致。
//
// 为什么不加列(Bettor 1428 原话理由): ①违反 NO TX NO STATE CHANGE——tx_json 构造成功就更新 current_*
// 的话, 广播失败/AMBIGUOUS 时 DB 状态就错了, 之后每一笔下注都会按错误状态构造; ②新增列是可以推算出来
// 的冗余副本, 时间长了必然漂移。改为纯函数现算, 每次都从权威源(proto_bets 已确认行)重新推导, 不缓存。

import { sqlite } from '../db/client.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { blake2b } = require('../../node_modules/@noble/hashes/blake2b.js');

/**
 * ShardLeaf_direct 当前 State(local_yes/local_no/count/pool_value)从已落链确认(status='confirmed')的
 * proto_bets 行推算——依据 ShardLeaf_direct.sil:50-53, genesis 初始值全 0(init_local_yes/no/count/
 * pool_value 直接赋给 State, 无额外偏移), 之后每次 register_append 只做加法, 因此:
 *   local_yes = Σ stake(side=0), local_no = Σ stake(side=1), count = 行数, pool_value = Σ stake。
 * pending/chip_minted_pending_stake(append 未落链)/orphaned_chip 都不计入——只信已确认的下注。
 */
export function deriveLeafState(marketId) {
  const row = sqlite.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN side = 0 THEN stake ELSE 0 END), 0) AS local_yes,
      COALESCE(SUM(CASE WHEN side = 1 THEN stake ELSE 0 END), 0) AS local_no,
      COUNT(*) AS count,
      COALESCE(SUM(stake), 0) AS pool_value
    FROM proto_bets WHERE market_id = ? AND status = 'confirmed'
  `).get(marketId);
  return { local_yes: row.local_yes, local_no: row.local_no, count: row.count, pool_value: row.pool_value };
}

/**
 * 同一市场的 append(步骤B)串行: 只要存在任何一条该市场的 append intent 处于 prepared/submitted/
 * ambiguous, 新的步骤B 一律拒绝(错误码 market_append_in_flight)——两笔并发 append 都读同一个"当前
 * leaf UTXO"构造, 后广播的那笔必然双花自己的输入(leaf 只有一个, 不能被两笔交易同时花)。
 */
export function assertNoInFlightAppend(marketId) {
  const row = sqlite.prepare(`
    SELECT pbi.intent_key, pbi.status FROM proto_bet_intents pbi
    JOIN proto_bets pb ON pb.id = pbi.bet_id
    WHERE pb.market_id = ? AND pbi.step = 'append' AND pbi.status IN ('prepared', 'submitted', 'ambiguous')
    LIMIT 1
  `).get(marketId);
  if (row) {
    throw new Error(`assertNoInFlightAppend: market_append_in_flight — market ${marketId} 存在 in-flight append intent ${row.intent_key}(status=${row.status}), 拒绝构造新的步骤B(ambiguous 需要人工处理, v0 不自动清)`);
  }
}

/** AB11 hand-encoding: 4 个 int 字段各自 [08][8字节小端], 与 ShardLeaf_direct.sil:151-154 自己的手写
 *  编码逐字节一致(已用真实 compileSilV100 重编两组不同 init 值验证过, 2026-09-15)。 */
export function encodeLeafStateBytes({ local_yes, local_no, count, pool_value }) {
  const buf = Buffer.alloc(36);
  let off = 0;
  for (const v of [local_yes, local_no, count, pool_value]) {
    buf[off] = 0x08; off += 1;
    buf.writeBigInt64LE(BigInt(v), off); off += 8;
  }
  return buf;
}

/** 给定推算出的 state 和 ShardLeaf_direct 的完整 redeem 脚本(genesis artifacts 里的 script)+
 *  state_layout({start,len}), 算出这个 state 对应的 P2SH scriptPubKey('0x' + 'aa20'+hash+'87')。 */
export function computeExpectedLeafScriptPubKey({ shardLeafRedeemScript, stateLayout, state }) {
  const redeem = Buffer.from(shardLeafRedeemScript);
  const { start, len } = stateLayout;
  if (len !== 36) throw new Error(`computeExpectedLeafScriptPubKey: unexpected state_layout.len=${len}, expected 36(ShardLeaf_direct 4-field State)`);
  if (start < 0 || start + len > redeem.length) throw new Error(`computeExpectedLeafScriptPubKey: state_layout out of bounds(start=${start} len=${len} redeem.length=${redeem.length})`);
  const prefix = redeem.subarray(0, start);
  const suffix = redeem.subarray(start + len);
  const stateBytes = encodeLeafStateBytes(state);
  const fullRedeem = Buffer.concat([prefix, stateBytes, suffix]);
  const hash = Buffer.from(blake2b(Uint8Array.from(fullRedeem), { dkLen: 32 }));
  return '0x' + 'aa20' + hash.toString('hex') + '87';
}

/**
 * 构造前 fail-closed 防漂移校验(Bettor 1428 要求④): 把 deriveLeafState 推算出的状态拼出的 P2SH,
 * 与 RPC 查到的 shardleaf_txid:vout 这个 UTXO 实际的 scriptPubKey 比对, 且该 UTXO 必须仍未花费。
 * 任何一项不符 ⇒ throw leaf_state_drift, 不构造交易——同时守住"库与链是否一致"和"指针是否已被
 * 他人花掉"两件事。
 * @param {object} o
 * @param {string} o.marketId
 * @param {Buffer|number[]} o.shardLeafRedeemScript  genesis 时算出的 ShardLeaf_direct 完整 redeem 脚本
 * @param {{start:number,len:number}} o.stateLayout
 * @param {{scriptPublicKeyHex:string, spent:boolean}|null} o.chainUtxo  调用方经 relay IPC 查到的
 *   shardleaf_txid:vout 现状(注入, 本函数不碰 RPC——同 M0a 门既有手法, 保持离线可测)。null = 查不到
 *   (可能已花费到别处/指针错误)。
 */
export function assertLeafStateMatchesChain({ marketId, shardLeafRedeemScript, stateLayout, chainUtxo }) {
  const state = deriveLeafState(marketId);
  const expectedSpk = computeExpectedLeafScriptPubKey({ shardLeafRedeemScript, stateLayout, state });
  if (!chainUtxo) {
    throw new Error(`assertLeafStateMatchesChain: leaf_state_drift — market ${marketId} 的 leaf UTXO 查不到(指针错误或已被花费到未追踪的输出)`);
  }
  if (chainUtxo.spent) {
    throw new Error(`assertLeafStateMatchesChain: leaf_state_drift — market ${marketId} 的 leaf UTXO 已被花费, 拒绝在一个不存在的 UTXO 上构造交易`);
  }
  const actualSpk = String(chainUtxo.scriptPublicKeyHex).toLowerCase();
  if (expectedSpk.toLowerCase() !== actualSpk) {
    throw new Error(`assertLeafStateMatchesChain: leaf_state_drift — 推算状态对应的 P2SH(${expectedSpk}) 与链上 UTXO 实际 scriptPubKey(${actualSpk}) 不一致(库与链状态不一致, 拒绝构造)`);
  }
  return { ok: true, state, expectedSpk };
}
