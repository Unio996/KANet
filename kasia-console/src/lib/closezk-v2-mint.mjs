// closezk-v2-mint.mjs — T2b(ii) genesis-mint 管线, CloseZkV2 装配主体 (J2 2026-07-07)。
//   设计文档: docs/2026-07-07-closezk-claim-complete-design.md。
//   分工(Bettor 15:53 裁定): J1 = attestedAtMs 读取路径(PayoutShardV2 close_attest state splice, W4a 同款);
//     J2(本文件) = anchor 重算 + Σleaf BLOCKING 断言 + CloseZkV2 ctor 组装 + zk_continuation metadata 写入。
//   两块通过 zk_continuation schema 契约解耦(docs/iteration/COORD-LEDGER.md T2b(i) 段, commit 34ccb6af)。

import { sqlite } from '../db/client.js';
import { compileSil, ctorBytes32, ctorInt } from './pool-bshard-artifacts.mjs';
import { computeCloseZkTmplAnchor } from './pool-shard-register.mjs';
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
 * compileCloseZkV2Redeem — 装配 CloseZkV2 genesis ctor(25 参数, 精确对照 CloseZkV2.sil:13-24)。
 *   closeZkTmplAnchor 由调用方传入(必须是 computeCloseZkTmplAnchor(CLOSEZK_V2_SIL, gateTmplHash) 当次算出的新值,
 *   §4 硬门⑥——本函数不自己算 anchor, 强制调用方走这条路径, 防止有人手滑传个缓存的旧 repro4 anchor 进来)。
 * @param {object} o
 * @param {string} o.gateTmplHash 32B hex
 * @param {string} o.betsRootBaked 32B hex(genesis 时 W2 committee-attest 已产出, hash-chain 根, zk_close journalHash 用)
 * @param {string} o.refundRootBaked 32B hex(genesis 时委员 attest 一并产出, escape_claim 用)
 * @param {number} o.attestedAtMs J1 那段 state-splice 读出的原值, 严禁做任何 *1000//1000 转换(§4 硬门②)
 * @param {number} o.attestedWinner 0|1, 委员判定值
 * @param {string} o.closeZkTmplAnchor 32B hex, 必须是对 CloseZkV2.sil 当次编译产物重算的值
 * @param {number|string} o.consolidatedPool
 * @returns {string} compiled redeem hex
 */
export function compileCloseZkV2Redeem({ gateTmplHash, betsRootBaked, refundRootBaked, attestedAtMs, attestedWinner, closeZkTmplAnchor, consolidatedPool }) {
  if (!/^[0-9a-f]{64}$/i.test(String(closeZkTmplAnchor || ''))) {
    throw new Error('compileCloseZkV2Redeem: closeZkTmplAnchor 必须是 32B hex — 调用方须先跑 computeCloseZkTmplAnchor(CLOSEZK_V2_SIL, gateTmplHash), 不接受省略/复用旧值');
  }
  const ctor = [
    ctorBytes32(closeZkTmplAnchor), ctorBytes32(betsRootBaked), ctorBytes32(refundRootBaked),
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

export { CLOSEZK_V2_SIL };
