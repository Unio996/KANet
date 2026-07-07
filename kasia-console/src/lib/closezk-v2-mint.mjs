// closezk-v2-mint.mjs — T2b(ii) genesis-mint 管线, CloseZkV2 装配主体 (J2 2026-07-07)。
//   设计文档: docs/2026-07-07-closezk-claim-complete-design.md。
//   分工(Bettor 15:53 裁定): J1 = attestedAtMs 读取路径(PayoutShardV2 close_attest state splice, W4a 同款);
//     J2(本文件) = anchor 重算 + Σleaf BLOCKING 断言 + CloseZkV2 ctor 组装 + zk_continuation metadata 写入。
//   两块通过 zk_continuation schema 契约解耦(docs/iteration/COORD-LEDGER.md T2b(i) 段, commit 34ccb6af)。

import { sqlite } from '../db/client.js';
import { compileSil, ctorBytes32, ctorInt } from './pool-bshard-artifacts.mjs';
import { computeCloseZkTmplAnchor } from './pool-shard-register.mjs';
import { readPayoutShardV2AttestedState } from './bshard-close-enforce.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = dirname(fileURLToPath(import.meta.url));
const CLOSEZK_V2_SIL = join(LIB, 'CloseZkV2.sil');
const SILVERC_ZK = process.env.SILVERC_ZK_PATH || 'D:/silverscript/versioned-builds/silverc-zk-8065184.exe';
const z32 = '00'.repeat(32);
const W17 = () => Array.from({ length: 17 }, () => ctorInt(0));

/**
 * assertPayoutLeavesConserved — §4 硬门⑤(承重件, Bettor 15:33 独立源码核验升级为 BLOCKING)。
 *   在 guest journal/gate 构造之前调用(不是在 CloseZkV2 genesis-mint 时——那一刻 payoutRootField 还是占位
 *   ZERO32, 还没有 leaf 集可验)。校验 Σ(leaves.amount) === consolidatedPool 精确成立, 不等即拒绝继续。
 *   闭合 main.rs L152-156 的真实断裂分支(fee_leaves 传空 + fee_bps>0 时 bps-fallback 会漏记一笔 fee_sompi,
 *   树先天不完整——本断言独立于 guest 电路重算, 拦"driver 读取的 leaf 集跟 guest 实际 commit 的不是同一份"
 *   这类更上游的数据传递 bug, 不信任"guest 那边应该是对的"这种口头保证, 设计文档 §2.3.1/§4⑤)。
 * @param {Array<{pk:string, amount:number|string}>} leaves 完整 payoutRootField 叶子集(winner payouts + fee leaves 全部)
 * @param {number|string} consolidatedPool
 * @throws {Error} Σleaf != consolidatedPool
 */
export function assertPayoutLeavesConserved(leaves, consolidatedPool) {
  if (!Array.isArray(leaves) || leaves.length === 0) {
    throw new Error('assertPayoutLeavesConserved: leaves 为空 — 拒绝 mint(至少需要 1 个 winner/fee leaf)');
  }
  const sum = leaves.reduce((acc, l) => acc + BigInt(l.amount), 0n);
  const pool = BigInt(consolidatedPool);
  if (sum !== pool) {
    throw new Error(
      `assertPayoutLeavesConserved: Σleaf=${sum} != consolidated_pool=${pool}(差额 ${pool - sum} sompi) — ` +
      `拒绝 mint(main.rs L152-156 bps-fallback 断裂分支同形状: 若上游用了空 fee_leaves+非零 fee_bps, ` +
      `树会先天漏记 fee 部分。设计文档 §4 mint 政策要求禁 bps-fallback, 一律显式非空 fee_leaves)。`
    );
  }
}

/**
 * compileCloseZkV2Redeem — 装配 CloseZkV2 genesis ctor(精确对照 CloseZkV2.sil:13-24)。
 *
 * 🔴 修复(NWT 15:59 CRITICAL BLOCKING 发现, 2026-07-07): 上一版此函数把 closeZkTmplAnchor 错误地塞进了
 *   ctor 第一个槽(应为 gateTmplHash), gateTmplHash 参数被静默丢弃——铸出的市场 zk_close 会永久失败
 *   (require(blake2b(gatePrefix+gateSuffix)==gateTmplHash) 验的是错值, 真实 gate 永远对不上, closed 卡死
 *   在 1, claim 永远够不着, 51.11KAS 那种"双出口出生皆断"同类事故)。根因: closeZkTmplAnchor 根本不是
 *   CloseZkV2 自己的 ctor 字段——它是 PayoutShardV2 的 ctor 字段(§2.1, `docs/2026-07-07-zk-genesis-mint-
 *   pipeline-design.md`), 由 PayoutShardV2 的 zk_handoff entry 在【花费时】witness 验证目标 CloseZkV2 的
 *   template prefix/suffix 是否匹配这个锚——不是 CloseZkV2 自身编译时需要的输入。修复=从本函数签名彻底删除
 *   这个参数, 不再让调用方有机会传错值进来(比"多加一层校验"更彻底: 消除攻击面而非拦截)。
 *
 * @param {object} o
 * @param {string} o.gateTmplHash 32B hex(CloseZkV2 自己的 ctor 字段, zk_close entry 验 gate 用)
 * @param {string} o.betsRootBaked 32B hex(genesis 时 W2 committee-attest 已产出, hash-chain 根, zk_close journalHash 用)
 * @param {string} o.refundRootBaked 32B hex(genesis 时委员 attest 一并产出, escape_claim 用)
 * @param {number} o.attestedAtMs J1 那段 state-splice 读出的原值, 严禁做任何 *1000//1000 转换(§4 硬门②)
 * @param {number} o.attestedWinner 0|1, 委员判定值
 * @param {number|string} o.consolidatedPool
 * @returns {string} compiled redeem hex
 */
export function compileCloseZkV2Redeem({ gateTmplHash, betsRootBaked, refundRootBaked, attestedAtMs, attestedWinner, consolidatedPool }) {
  if (!/^[0-9a-f]{64}$/i.test(String(gateTmplHash || ''))) {
    throw new Error('compileCloseZkV2Redeem: gateTmplHash 必须是 32B hex');
  }
  const ctor = [
    ctorBytes32(gateTmplHash), ctorBytes32(betsRootBaked), ctorBytes32(refundRootBaked),
    ctorInt(Number(attestedAtMs)),      // §4 硬门②: 原值直接烤入, 调用方保证零转换
    ctorInt(Number(attestedWinner)),
    ctorInt(1),                          // init_closed: 恒为 1(§4 硬门①, closed==0 是理论态, mint 只产 closed==1 实例)
    ctorBytes32(z32),                    // init_payoutRootField: ZERO32 占位, zk_close 完成后才写真实值
    ctorInt(Number(consolidatedPool)),
    ...W17(),
  ];
  return Buffer.from(compileSil(CLOSEZK_V2_SIL, ctor, SILVERC_ZK).script).toString('hex');
}

/**
 * writeZkContinuation — zk_handoff LAND 后写 pool_markets.metadata.zk_continuation(T2b(i) schema, COORD-LEDGER
 *   commit 34ccb6af 定稿)。NO TX NO STATE: 只在调用方已确认 zk_handoff tx landed 之后调用, 本函数不做链上确认。
 *   单条同步 SQLite UPDATE(同 publishCloseRequestV2 原子性纪律)——proving 子对象缺省 pending 态, 后续 proving
 *   job 跑完再补(mint 跟 proving 是两个独立异步阶段, mint 可以先于 proving 完成, 设计文档 schema 段已论证)。
 * @param {string} marketId
 * @param {object} o { outpointTxid, outpointIndex, redeemHex, valueSompi, attestedWinner, attestedAtMs, sourceCloseAttestTxid, sourceZkHandoffTxid }
 */
export function writeZkContinuation(marketId, o) {
  if (!o?.outpointTxid || o?.outpointIndex == null || !o?.redeemHex || o?.valueSompi == null) {
    throw new Error('writeZkContinuation: outpointTxid/outpointIndex/redeemHex/valueSompi 必需');
  }
  const row = sqlite.prepare('SELECT metadata FROM pool_markets WHERE id = ?').get(marketId);
  if (!row) throw new Error(`writeZkContinuation: market ${marketId} 不存在`);
  let meta; try { meta = JSON.parse(row.metadata || '{}'); } catch { meta = {}; }
  meta.zk_continuation = {
    outpoint: { txid: o.outpointTxid, index: Number(o.outpointIndex) },
    redeemHex: o.redeemHex,
    valueSompi: String(o.valueSompi),
    attestedWinner: Number(o.attestedWinner),
    attestedAtMs: Number(o.attestedAtMs),
    mintedAt: o.mintedAt || new Date().toISOString(),
    sourceCloseAttestTxid: o.sourceCloseAttestTxid || null,
    sourceZkHandoffTxid: o.sourceZkHandoffTxid || o.outpointTxid,
    // proving 子对象(NWT GREEN, COORD-LEDGER T2b(i)): 缺省 pending, W5(并入 T2b) proving job 跑完原子整体覆盖。
    proving: { status: 'pending', guestPayoutRootHex: null, journalHash: null, imageId: null, gate: null, provingError: null },
  };
  sqlite.prepare(`UPDATE pool_markets SET metadata = ? WHERE id = ?`).run(JSON.stringify(meta), marketId);
  return { ok: true };
}

/**
 * buildCloseZkV2GenesisFromAttestedState — 合体入口(J1+J2 切片对接, Bettor 18:45 合体序①)。
 *   编排: readPayoutShardV2AttestedState(J1, 从落链的 close_attest_v2 continuation 读 5 个 committee-attested
 *   字段) → computeCloseZkTmplAnchor(对 CLOSEZK_V2_SIL 当次编译重算, §4 硬门①) → compileCloseZkV2Redeem(J2,
 *   §4 硬门⑥不接受省略 anchor —— 注意: anchor 本身不进 CloseZkV2 ctor, 见 compileCloseZkV2Redeem CRITICAL 修复
 *   记录; 这里算 anchor 是为了返回给调用方去更新/校验 PayoutShardV2 侧的 closeZkTmplAnchor 期望值, 不是喂给本函数)。
 *   字段名桥接(J1 读出用 `Hex` 后缀反映"原始读取", J2 组装用 `Baked` 后缀反映"ctor 烤入语义" — 命名差异非
 *   bug, 两个模块各自的既有惯例, 这里做唯一的映射点)。
 * @param {string} psv2RedeemHex 已落链的 PayoutShardV2 continuation redeem hex(closed 已被委员写成 1)
 * @param {string} gateTmplHash 32B hex — CloseZkV2 自己的 ctor 字段, 来自 guest image 绑定的 gate 模板哈希(跟
 *   committee-attested 值无关, 调用方显式传入, 不从 psv2 state 推导)
 * @returns {{redeemHex:string, anchorHex:string, consolidatedPool:bigint, attestedWinner:number, attestedAtMs:number}}
 */
export function buildCloseZkV2GenesisFromAttestedState(psv2RedeemHex, gateTmplHash) {
  const state = readPayoutShardV2AttestedState(psv2RedeemHex);   // J1 的切片, fail-closed 四项已在函数内部核过
  const anchor = computeCloseZkTmplAnchor(CLOSEZK_V2_SIL, gateTmplHash);   // §4 硬门①: 每次对 CloseZkV2 当次编译重算
  const redeemHex = compileCloseZkV2Redeem({
    gateTmplHash,
    betsRootBaked: state.betsRootHex,
    refundRootBaked: state.refundRootHex,
    attestedAtMs: state.attestedAtMs,
    attestedWinner: state.attestedWinner,
    consolidatedPool: state.consolidatedPool,
  });
  return { redeemHex, anchorHex: anchor.anchorHex, consolidatedPool: state.consolidatedPool, attestedWinner: state.attestedWinner, attestedAtMs: state.attestedAtMs };
}

export { CLOSEZK_V2_SIL };
