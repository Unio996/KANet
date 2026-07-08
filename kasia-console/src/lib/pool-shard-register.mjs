// pool-shard-register.mjs — (A)-model rolling-shard register orchestration (production register wiring (a), J2 2026-06-21).
//
// One logical market = N ShardLeaf shards, each consolidating into ONE production-shape PayoutShard covenant
// (predicate_commit ctor, cov_id-provenance). This module is the Console-side ORCHESTRATION over:
//   - shard-allocator       : allocateForRegister / registerShard / sealShard / onBettorRegistered (v172 续约列)
//   - pool-register-builder : buildRegisterWitness / buildRegisterCommand (register_append, cross-node 1000 已证兼容 (A) 4-field leaf)
//   - (d) genesis           : PayoutShard genesis-mint (production-shape) + ShardLeaf genesis (count=1 first-bet baked, payout_cov_id baked)
//
// Flow per bettor bet (stake in sompi):
//   allocateForRegister →
//     'use'      : register_append on the open shard's current leaf (current_leaf_outpoint/state) → onBettorRegistered
//     'open_new' : (首片) PayoutShard genesis-mint → ShardLeaf genesis (first bet baked count=1) → registerShard (+ sealShard prev)
//
// NO TX NO STATE: DB accounting (registerShard / onBettorRegistered / payout_shards insert) ONLY after the on-chain tx landed.
// determinism: all redeem compiled with canonical silverc (da9fc22); ShardLeaf bakes the per-market PayoutShard cov_id
//   (consolidate destination-bind). ps_tmpl_hash is bettor-INDEPENDENT (4 dust-ticket fields are State, spliced per register).
//
// Custody (testnet ramp): the gateway relay funds genesis + register from its balance; the bettor's stake is reconciled
//   via the bettor→gateway transfer the caller performs before invoking (custody-bound, like publish). mainnet: bettor-direct
//   funding input is a follow-up (TODO custody-hardening).

import { compileSil, computePoolSideArtifact, ctorBytes32, ctorInt } from './pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from './pool-template-artifact.mjs';
import { buildRegisterWitness, buildRegisterCommand } from './pool-register-builder.mjs';
import { allocateForRegister, registerShard, sealShard, onBettorRegistered } from './shard-allocator.mjs';
import { blake2b } from '@noble/hashes/blake2b';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB = dirname(fileURLToPath(import.meta.url));
// 🔴 事故修复(2026-07-07，Bettor/NWT 裁定，家族口径终案): compilePayoutShardRedeem(PayoutShard.sil V1)
// + compileShardLeafRedeem(ShardLeaf.sil) 硬编码走 legacy binary，无视调用方传的 silverc 参数——不是信任
// caller 会传对，是这两个函数编译的合约本身就属于 V1 家族，续约地址必须跟 genesis 时的字节 byte-exact，
// faaa074(引入 validateOutputStateWithTemplate 新 codegen)之后的 binary 编译产物已证实形状会漂移
// (ShardLeaf 直接编译报错；CloseZkRepro4 byte长度不同，8528 vs 8662——同一类风险，只是 PayoutShard.sil
// 用 validateOutputState 非 WithTemplate 变体，暂未证实是否同样受影响，默认保守当作受影响处理)。
// ZK 专属函数(compilePayoutShardV2Redeem/computeCloseZkTmplAnchor)不受这条影响——它们硬编码走下面的
// SILVERC_ZK，见其后紧跟的注释(第二轮加固，同一晚)。
const SILVERC_LEGACY = process.env.SILVERC_LEGACY_PATH || 'D:/silverscript/versioned-builds/silverc-legacy-2c46231.exe';
// 🔴 NWT 事故复盘顺手抓到的潜伏 footgun(2026-07-07 深夜，同一事故的第二处硬化): computeCloseZkTmplAnchor/
// compilePayoutShardV2Redeem 原来完全依赖调用方显式传对 silverc——生产代码(pool.js register-v07)传对了，
// 但 NWT 自己写验证脚本时忘了传，结果默默吃了 compileSil 的模块级默认值(刚被本次事故修复从 ZK 改成
// legacy)，编出错误字节都不会报错。跟 ShardLeaf/PayoutShard V1 同款处理：硬编码，不依赖调用方传参正确。
const SILVERC_ZK = process.env.SILVERC_ZK_PATH || 'D:/silverscript/versioned-builds/silverc-zk-8065184.exe';
const z32 = '00'.repeat(32);
const W17 = () => Array.from({ length: 17 }, () => ctorInt(0));
const MIN_BET = 100000;                                   // dust-ticket floor (sompi); matches (d)/helper
const TICKET_DUST = 20_000_000;                           // 0.2 KAS PoolSide dust ticket (KIP-9 safe, matches helper)
const PS_SEED = 20_000_000;                               // PayoutShard genesis seed (0.2 KAS sink, matches (d))
const SHARD_GENESIS_SEED = 20_000_000;                    // A(b): 空 ShardLeaf genesis seed (0.2 KAS, KIP-9 safe). 首注 register_append
                                                          //   spend 它+fund stake → output weld out==pool_value(0)+stake 过, seed 退 change (不进池, pool_value 起点=0)。

// REORG_SAFE_MIN_DEPTH (NWT 2026-07-05 review, #33 设计整顿): checkUtxoLanded(kasia-relay/src/lib/p2sh.mjs)
// 的 minDepth 参数, 2026-06-30 phantom-leaf 根治时为 register_append land-gate 校准(TN12 实测 reorg 深度恒定
// 1, 20 = 20× 安全余量)。之前 pool.js 两处(register/refund-maker-unjoined landed() helper)各自硬编码字面量
// 20, #33(claim 确认深度门)又要加两处——四处独立维护同一个数字正是 Owner 点破的"并行维护"反模式。收敛成
// 单一具名常量, 供 pool.js + bshard-auto-settler.mjs 都 import, 只改一处维护点, 行为不变(纯常量提取)。
export const REORG_SAFE_MIN_DEPTH = 20;

const hex32 = (s) => Buffer.from(blake2b(Buffer.from(s), { dkLen: 32 })).toString('hex');
const _i64LE = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };

// 周期 defrag (880-wall 防护, memory reference-consolidate-utxo-880-fix): 每注 gateway funding 自转账 → 碎片化 best UTXO,
// 持续 scale (2000+ tx) 必周期 consolidate_utxo 维持 best, 否则 register funding starvation. 每 DEFRAG_EVERY 注 best-effort 归集.
const DEFRAG_EVERY = 40;
let _regCount = 0;
async function _maybeDefrag(rc) {
  if (++_regCount % DEFRAG_EVERY !== 0) return;
  try { await rc({ type: 'consolidate_utxo' }); } catch { /* best-effort; health-monitor 兜底 */ }
}
const _push8 = (buf) => Buffer.concat([Buffer.from([buf.length]), buf]);   // PUSH<len> data

/**
 * Splice the (A) 4-field ShardLeaf state into a base (genesis) redeem — silverc-INDEPENDENT (no recompile at register
 * → immune to cross-node silverc build drift). state_layout: start=1, 4×PUSH8 = 36B. Byte-equal to recompile (J2 已验).
 */
export function spliceLeafState(baseRedeemHex, st) {
  const stateHex = Buffer.concat([_push8(_i64LE(st.local_yes)), _push8(_i64LE(st.local_no)), _push8(_i64LE(st.count)), _push8(_i64LE(st.pool_value))]);
  const redeem = Buffer.from(baseRedeemHex, 'hex');
  return Buffer.concat([redeem.slice(0, 1), stateHex, redeem.slice(1 + stateHex.length)]).toString('hex');
}

/**
 * Compile a production-shape PayoutShard redeem (22-param ctor incl predicate_commit 2nd).
 * @param {object} o { poolMerkleRoot(hex), predicateCommit(hex), consolidatedPool(int), closed(int), payoutRoot(hex), silverc }
 */
export function compilePayoutShardRedeem({ poolMerkleRoot, predicateCommit, consolidatedPool, closed = 0, payoutRoot = z32 }) {
  const ctor = [ctorBytes32(poolMerkleRoot), ctorBytes32(predicateCommit), ctorInt(Number(consolidatedPool)), ctorInt(closed), ctorBytes32(payoutRoot), ...W17()];
  return Buffer.from(compileSil(join(LIB, 'PayoutShard.sil'), ctor, SILVERC_LEGACY).script).toString('hex');
}

/**
 * Compile a ShardLeaf redeem with the given (A) 4-field state baked.
 * @returns {{ redeemHex, psTmplHashHex }}
 */
export function compileShardLeafRedeem({ marketIdHash, psTmplHashHex, shardPoolId, sealCount, payoutCovId, deadline, localYes, localNo, count, poolValue }) {
  // ★件1(J1): deadline 加在常量区(payoutCovId 后, init State 前) — State 区仍 offset 1/4×PUSH8 不变 (spliceLeafState byte-equal 保持)。
  const ctor = [
    ctorBytes32(marketIdHash), ctorBytes32(psTmplHashHex), ctorBytes32(shardPoolId),
    ctorInt(sealCount), ctorInt(MIN_BET), ctorBytes32(payoutCovId), ctorInt(deadline),
    ctorInt(localYes), ctorInt(localNo), ctorInt(count), ctorInt(poolValue),
  ];
  return Buffer.from(compileSil(join(LIB, 'ShardLeaf.sil'), ctor, SILVERC_LEGACY).script).toString('hex');
}

/**
 * Ensure the per-logical-market PayoutShard covenant exists (genesis-mint once). Reads/writes payout_shards (v172).
 * @returns {{ payoutCovId, psAddr, psOutpoint, psRedeemGenesis }}
 */
export async function ensurePayoutShard({ db, rc, transfer, landed, p2sh, logicalMarketId, poolMerkleRoot, predicateCommit, relayAddr, silverc }) {
  const existing = db.prepare(`SELECT * FROM payout_shards WHERE logical_market_id = ?`).get(logicalMarketId);
  if (existing) return { payoutCovId: existing.payout_cov_id, psAddr: existing.payout_ps_addr, psOutpoint: existing.payout_ps_outpoint, psRedeemGenesis: existing.payout_redeem_hex };

  const redeem = compilePayoutShardRedeem({ poolMerkleRoot, predicateCommit, consolidatedPool: PS_SEED, closed: 0, payoutRoot: z32, silverc });
  const fundTx = await transfer(relayAddr, PS_SEED + 100_000_000);   // seed + headroom to gateway
  const gj = await rc({ type: 'bshard_genesis_mint_payout', payoutshard: { redeem_hex: redeem, seedSompi: String(PS_SEED) }, inputs: { funding: { address: relayAddr, outpointTxid: fundTx, index: 0 } }, outputs: { change_address: relayAddr } });
  const payoutCovId = gj.payoutCovId, psTx = gj.txId || gj.txid, psAddr = p2sh(redeem);
  if (!payoutCovId || payoutCovId === z32) throw new Error('PayoutShard genesis-mint cov_id 0 — covenant provenance fail');
  if (!await landed(psTx, psAddr)) throw new Error('PayoutShard genesis no land');

  db.prepare(`INSERT INTO payout_shards (logical_market_id, payout_cov_id, payout_ps_addr, payout_ps_outpoint, payout_redeem_hex, pool_merkle_root, predicate_commit, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(logicalMarketId, payoutCovId, psAddr, `${psTx}:0`, redeem, poolMerkleRoot, predicateCommit, Math.floor(Date.now() / 1000));
  return { payoutCovId, psAddr, psOutpoint: `${psTx}:0`, psRedeemGenesis: redeem };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ZK-native 结算(2026-07-07，W1/W3，Owner"ZK走到底"钦定)——结构性平行函数，不碰上面 compilePayoutShardRedeem/
// ensurePayoutShard 一个字节。committee-sig 市场继续走原函数零风险；只有显式调用下面这两个函数的
// ZK-native 市场才会走 PayoutShardV2.sil。选择哪个函数由上层调用方(市场类型判断)决定，不是隐式推断。
// ══════════════════════════════════════════════════════════════════════════════════════════════

// closeZkTmplAnchor 的 4 段固定模板切分点。
// 🔴 事故修复(2026-07-08 深夜, J2+Bettor+NWT, 3o0a6 zk_handoff 撞锚点死结坐实): 原来这里是硬编码绝对
// offset(J2 2026-07-06 实测), CloseZkV2.sil 07-07 那次 NUM2BIN byte[32](0) 修复之后没人重新量, 硬编码
// 常量过期 2 字节(_CLOSEZK_REFUNDROOT_ABS 应为 [1394,1426] 不是 [1396,1428])——静默烤出一个【错的】
// anchor 进 PayoutShardV2 ctor(ctor-baked, 不可变), 导致 zk_handoff 在 line 378 的 anchor 校验永远拒签
// (真实 refundRootBaked 非零, 用错误 offset 切模板会带进真实值的前 2 字节, 永远凑不出跟 dummy z32 算出的
// 旧 anchor 一致的哈希)。3o0a6 69.11KAS 卡死案例的根因就是这个。
// 根治: 弃硬编码, 改用 live indexOf 定位(同 handoff driver 脚本硬化过的 findUnique 手法搬进库函数单源)+
// round-trip 自证(4 段模板+dummy state 拼回必须 byte-exact 等于 compiled 原始产物, 不 match 直接 throw,
// 不静默产出错 anchor)。这样即使未来 .sil 源码再改动导致 offset 漂移, 也会在这里 fail-loud, 不会再悄悄
// 烤一个错的值进任何市场的 ctor。
const _CLOSEZK_SUFFIX_BASE = 214; // = state_layout.start(1) + state_layout.len(213), state 区固定宽度编码, 不随市场值变

/**
 * 计算 PayoutShardV2 ctor 需要的 closeZkTmplAnchor = blake2b(4 段固定模板拼接)。CloseZkRepro4.sil/CloseZkV2.sil
 * 零改动，编译一次(dummy ctor，模板跟 betsRoot/refundRoot/attestedWinner/consolidated_pool 具体值无关，只有
 * gateTmplHash 会真实嵌入模板——它绑定具体 guest image_id，必须传真实值，不能用占位符)即可，不需要每个
 * 市场重算(同一个 guest image 的所有 ZK-native 市场共用同一个 anchor)。
 * @param {string} closeZkSilPath 指向 CloseZkV2.sil(或归位后的正式路径)
 * @param {string} gateTmplHash 真实 gate 模板 hash(32B hex，绑定具体 guest image_id——不能传占位符，会导致 anchor 算错)
 */
export function computeCloseZkTmplAnchor(closeZkSilPath, gateTmplHash) {
  // dummyAtMs 必须落在 J2 实测的稳定值域 [2^40, 2^47) 内(同 PayoutShardV2.sil zk_handoff 的 bounds guard)，
  // 否则 minimal-push 变长编码会让模板切分点跟真实 market 用的值对不上。用一个具体真实量级(非边界值)。
  const dummyAtMs = 1783500000000;
  // ⚠ NWT 核实确认(2026-07-07): init_attestedWinner/init_closed/init_consolidated_pool 这三个值(下面写
  // 0/1/0)可以随便填、不影响算出的 anchor —— 它们全部落在 CloseZkRepro4 自己的 state_layout 区域内，
  // extractTemplateArtifact 会把整个 state 区域从 templateSuffix 里切掉(不进最终 hash)。之所以这里仍写
  // 具体值(而非全 0)，纯粹是为了让 dummy ctor 数组形状/类型跟真实 ctor 一致，不是这些值本身有意义。
  // 🔴 distinct non-zero dummy markers (fix): z32 用于两个 dummy 槽会跟 ctor 里其它全零字段(init_payoutRoot
  // 等)碰撞, live findUnique 的"精确出现 1 次"断言会 fail-loud 拦下——这正是硬门该做的事(NWT 测试中用的
  // 0x2222.../0x3333... 同款手法, 避免任何看似合理的占位值意外撞见).
  const dummyBetsRoot = '11'.repeat(32), dummyRefundRoot = '22'.repeat(32);
  const ctor = [
    ctorBytes32(gateTmplHash), ctorBytes32(dummyBetsRoot), ctorBytes32(dummyRefundRoot),
    ctorInt(dummyAtMs), ctorInt(0), ctorInt(1), ctorBytes32(z32), ctorInt(0),
    ...W17(),
  ];
  const compiled = compileSil(closeZkSilPath, ctor, SILVERC_ZK);
  const { templatePrefix, templateSuffix } = extractTemplateArtifact(compiled); // prefix=script[0:1], suffix=script[214:end]
  const fullBuf = Buffer.from(compiled.script);

  // live 定位(不信硬编码常量): 在完整编译产物里搜索 dummy betsRoot/refundRoot 的字节位置, 各自必须
  // 精确出现 1 次——出现 0 次或 >=2 次都 fail-loud(同 handoff driver 的 findUnique 纪律, 不猜第一个)。
  function findUnique(buf, needle, label) {
    const first = buf.indexOf(needle);
    if (first < 0) throw new Error(`computeCloseZkTmplAnchor: findUnique(${label}) 找不到 marker — .sil 源码/silverc 产物跟预期结构不符`);
    const second = buf.indexOf(needle, first + 1);
    if (second >= 0) throw new Error(`computeCloseZkTmplAnchor: findUnique(${label}) marker 出现 >=2 次(offset ${first},${second}) — offset 碰撞风险, 拒绝猜第一个`);
    return first;
  }
  const dummyBetsBuf = Buffer.from(dummyBetsRoot, 'hex');
  const dummyRefundBuf = Buffer.from(dummyRefundRoot, 'hex');
  const atMsBuf6 = Buffer.alloc(6); atMsBuf6.writeUIntLE(dummyAtMs, 0, 6);
  const atMsMarkerAndData = Buffer.concat([Buffer.from([6]), atMsBuf6]);
  const betsAbs = findUnique(fullBuf, dummyBetsBuf, 'betsRoot');
  const atMsAbs = findUnique(fullBuf, atMsMarkerAndData, 'atMs-marker+data');
  const refundAbs = findUnique(fullBuf, dummyRefundBuf, 'refundRoot');

  const _rel = (abs) => abs - _CLOSEZK_SUFFIX_BASE;
  const templateA = templateSuffix.subarray(0, _rel(betsAbs));
  const templateB = templateSuffix.subarray(_rel(betsAbs) + 32, _rel(atMsAbs));
  const templateC = templateSuffix.subarray(_rel(atMsAbs) + 7, _rel(refundAbs));
  const templateD = templateSuffix.subarray(_rel(refundAbs) + 32);

  // round-trip 自证(built into 这次 run, 非事后单独验证): genesisMarker+state(全 0 dummy 值)+4 段模板+
  // dummy betsRoot/refundRoot/atMs 拼回, 必须 byte-exact 等于原始 compiled.script, 不 match 直接 throw
  // (防未来 .sil 结构改动时这里静默产出一个跟真实编译产物脱节的 anchor)。
  {
    const push8 = Buffer.from([8]), push32 = Buffer.from([32]);
    const i64 = (n) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
    const zeroWord = Buffer.concat([push8, i64(0)]);
    const stateBytes = Buffer.concat([
      push8, i64(0), push8, i64(1), push32, Buffer.alloc(32), push8, i64(0),
      ...Array(17).fill(zeroWord),
    ]);
    const reconstructed = Buffer.concat([Buffer.from([templatePrefix[0]]), stateBytes, templateA, dummyBetsBuf, templateB, atMsMarkerAndData, templateC, dummyRefundBuf, templateD]);
    if (!reconstructed.equals(fullBuf)) throw new Error('computeCloseZkTmplAnchor: round-trip 自证 FAIL — 4 段模板+state 拼回不等于原始编译产物, 拒绝产出可能错误的 anchor');
  }

  return {
    anchorHex: Buffer.from(blake2b(Buffer.concat([templateA, templateB, templateC, templateD]), { dkLen: 32 })).toString('hex'),
    genesisMarkerByte: templatePrefix[0], // = 107, 硬编进 zk_handoff 的 byte[1](107)，随手核对不变
    // 2026-07-07(J2, W4a 需要): J1 落码 unlockBshardZkHandoff/unlockBshardZkClose 时要拼装真实
    // betsRootBaked/refundRootBaked/attestedAtMs 进这 4 段固定模板之间, 补充导出(纯加字段, 唯一既有
    // 调用点 pool.js:1267 只解构 .anchorHex, 不受影响)。
    templateA, templateB, templateC, templateD,
  };
}

/**
 * Compile a ZK-native PayoutShardV2 redeem (27-param ctor，比 PayoutShard 多 closeZkTmplAnchor + 4 个 ZK state 初值)。
 * ctor 参数序精确对照 PayoutShardV2.sil:35-49(NWT diff 审过)：
 *   poolMerkleRoot, predicate_commit, closeZkTmplAnchor, init_consolidated_pool, init_closed, init_payoutRoot,
 *   init_w0..init_w16(17), init_attestedWinner, init_attestedAtMs, init_betsRootBaked, init_refundRootBaked。
 * @param {object} o { poolMerkleRoot(hex), predicateCommit(hex), closeZkTmplAnchor(hex), consolidatedPool(int), silverc }
 */
export function compilePayoutShardV2Redeem({ poolMerkleRoot, predicateCommit, closeZkTmplAnchor, consolidatedPool }) {
  const ctor = [
    ctorBytes32(poolMerkleRoot), ctorBytes32(predicateCommit), ctorBytes32(closeZkTmplAnchor),
    ctorInt(Number(consolidatedPool)), ctorInt(0), ctorBytes32(z32),
    ...W17(),
    ctorInt(-1),        // init_attestedWinner: -1=待attest
    ctorInt(0),         // init_attestedAtMs: 0=待attest
    ctorBytes32(z32),   // init_betsRootBaked: ZERO32=待attest
    ctorBytes32(z32),   // init_refundRootBaked: ZERO32=待attest
  ];
  return Buffer.from(compileSil(join(LIB, 'PayoutShardV2.sil'), ctor, SILVERC_ZK).script).toString('hex');
}

/**
 * ZK-native 市场版 ensurePayoutShard——镜像 ensurePayoutShard，只是目标合约 PayoutShardV2.sil + 27 参数 ctor。
 * 上层调用方(市场类型判断，非本函数内部推断)必须显式知道这是 ZK-native 市场才调用这个函数。
 * @returns {{ payoutCovId, psAddr, psOutpoint, psRedeemGenesis }}
 */
export async function ensurePayoutShardV2({ db, rc, transfer, landed, p2sh, logicalMarketId, poolMerkleRoot, predicateCommit, closeZkTmplAnchor, relayAddr, silverc }) {
  const existing = db.prepare(`SELECT * FROM payout_shards WHERE logical_market_id = ?`).get(logicalMarketId);
  if (existing) return { payoutCovId: existing.payout_cov_id, psAddr: existing.payout_ps_addr, psOutpoint: existing.payout_ps_outpoint, psRedeemGenesis: existing.payout_redeem_hex };

  const redeem = compilePayoutShardV2Redeem({ poolMerkleRoot, predicateCommit, closeZkTmplAnchor, consolidatedPool: PS_SEED, silverc });
  const fundTx = await transfer(relayAddr, PS_SEED + 100_000_000);
  const gj = await rc({ type: 'bshard_genesis_mint_payout', payoutshard: { redeem_hex: redeem, seedSompi: String(PS_SEED) }, inputs: { funding: { address: relayAddr, outpointTxid: fundTx, index: 0 } }, outputs: { change_address: relayAddr } });
  const payoutCovId = gj.payoutCovId, psTx = gj.txId || gj.txid, psAddr = p2sh(redeem);
  if (!payoutCovId || payoutCovId === z32) throw new Error('PayoutShardV2 genesis-mint cov_id 0 — covenant provenance fail');
  if (!await landed(psTx, psAddr)) throw new Error('PayoutShardV2 genesis no land');

  // ⚠ payout_shards 表(migrate v172)目前无 V1/V2 区分列——今天范围只加这两个函数，不加 schema。
  // 下游若需要区分本行是 V1 还是 V2 shaped redeem，靠调用方自己的市场类型记录(如 pool_markets.protocol_status
  // ='zk_ready')判断，不靠 introspect 这张表。若后续需要，独立小工单加列，非本次范围。
  db.prepare(`INSERT INTO payout_shards (logical_market_id, payout_cov_id, payout_ps_addr, payout_ps_outpoint, payout_redeem_hex, pool_merkle_root, predicate_commit, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(logicalMarketId, payoutCovId, psAddr, `${psTx}:0`, redeem, poolMerkleRoot, predicateCommit, Math.floor(Date.now() / 1000));
  return { payoutCovId, psAddr, psOutpoint: `${psTx}:0`, psRedeemGenesis: redeem };
}

// #task32 (2026-07-03, Bettor 结构性发现): 'use' 分支(append 到已开分片的当前 leaf, 最常见路径)读
//   current_leaf_outpoint/current_leaf_state 后建 register_append 花它——两个并发 confirm 落在同一
//   shard 会读到同一个 outpoint 抢 splice, 后到者链上花费被拒(安全失败非丢钱, 但合法请求报错需重试)。
//   'open_new' 分支已有 DB UNIQUE(logical_market_id,shard_index) 约束 + 递归重试兜底(见下 L192 附近),
//   'use' 分支没有对应保护。修法: 单进程内按 logicalMarketId 排队(Promise 链, 无外部依赖), 同一市场
//   的并发注册请求串行化——不拒绝, 排队等前一个完成再走, 两笔请求最终都能成功(非"一个赢一个错")。
const _marketLocks = new Map();   // logicalMarketId -> tail Promise (chain)
function _withMarketLock(marketId, fn) {
  const prev = _marketLocks.get(marketId) || Promise.resolve();
  const run = prev.then(fn, fn);   // run fn regardless of prior success/failure, chained after it
  const tail = run.catch(() => {}); // don't let a rejection break the chain for the NEXT waiter
  _marketLocks.set(marketId, tail);
  return run;
}

/**
 * Register one bettor's bet into the (A)-model rolling-shard set. Core (a) orchestration.
 * @param {object} o {
 *   db, rc(cmd)→Promise, transfer(addr,sompi)→txid, landed(txid,addr)→bool, p2sh(redeemHex)→addr,
 *   logicalMarketId, poolMerkleRoot(hex), predicateCommit(hex), bettorPk(hex), direction(0|1), stakeSompi,
 *   relayAddr, silverc, sealCount, deadline(Unix ts; partial-shard sweep gate, ctor-baked 件1), createShardMarketRow(shardIndex, shardP2sh)→shardMarketId (pool_markets row for the shard),
 *   recordBettor({ shardMarketId, shardIndex, bettorPk, direction, stakeSompi, leafTx }) (pool_bettor_sides / shard bettor record)
 * }
 * @returns {{ action, shardIndex, shardMarketId, shardP2sh, leafTx, leafOutpoint, leafState, payoutCovId }}
 */
export async function registerBettorOnShard(o) {
  // 只在【最外层调用】排队, 内部递归自调(_retry/open_new→use)复用同一把已持有的锁位置, 不重复排队
  // (否则递归自调会在已持有的锁后面排自己的队 = 自锁死)。用 o._locked 标记"已在锁内"。
  if (o._locked) return _registerBettorOnShardInner(o);
  return _withMarketLock(o.logicalMarketId, () => _registerBettorOnShardInner({ ...o, _locked: true }));
}

async function _registerBettorOnShardInner(o) {
  const {
    db, rc, transfer, landed, p2sh, logicalMarketId, poolMerkleRoot, predicateCommit,
    bettorPk, direction, stakeSompi, relayAddr, silverc, sealCount, deadline, createShardMarketRow, recordBettor,
    zkNative = false, closeZkTmplAnchor,   // 2026-07-07 新增: ZK-native 市场显式开关。默认 false——
    // 不传这两个字段的既有 committee-sig 调用方行为一字不变(走原 ensurePayoutShard)。这是显式参数，
    // 不是本函数内部推断——上层市场创建流程必须自己知道"这是 ZK-native 市场"才传 zkNative:true，
    // ShardLeaf/register 主体逻辑本身不感知/不判断市场类型(NWT W3 审核重点②)。
  } = o;
  if (!Number.isFinite(Number(deadline)) || Number(deadline) <= 0) throw new Error(`registerBettorOnShard: deadline (Unix ts, ctor-baked partial-sweep gate) required, got ${deadline}`);
  if (direction !== 0 && direction !== 1) throw new Error(`direction must be 0|1, got ${direction}`);
  if (!(BigInt(stakeSompi) > 0n)) throw new Error(`stakeSompi must be > 0`);
  if (zkNative && !closeZkTmplAnchor) throw new Error('registerBettorOnShard: zkNative=true requires closeZkTmplAnchor (fail-closed, no silent placeholder)');
  const stake = Number(stakeSompi);
  const marketIdHash = hex32(logicalMarketId);

  // Per-market PayoutShard (genesis-mint once at first shard) — the consolidation sink every ShardLeaf bakes by cov_id.
  // zkNative 显式 true 才走 V2；committee-sig 市场(zkNative 未传/false)连这个分支的调用点都摸不到。
  const { payoutCovId } = zkNative
    ? await ensurePayoutShardV2({ db, rc, transfer, landed, p2sh, logicalMarketId, poolMerkleRoot, predicateCommit, closeZkTmplAnchor, relayAddr, silverc })
    : await ensurePayoutShard({ db, rc, transfer, landed, p2sh, logicalMarketId, poolMerkleRoot, predicateCommit, relayAddr, silverc });

  const alloc = allocateForRegister(db, logicalMarketId, stake);

  // ── 'use': register_append on the open shard's current renewal leaf ────────────────────────────────────────
  if (alloc.action === 'use') {
    let shard = alloc.shard;
    if (!shard.current_leaf_outpoint || !shard.current_leaf_state) {
      throw new Error(`shard ${shard.shard_market_id} missing current_leaf_outpoint/state (v172) — cannot register_append`);
    }
    if (!shard.shard_redeem_hex) throw new Error(`shard ${shard.shard_market_id} missing shard_redeem_hex — genesis 应存; fail-closed 防 silverc-drift recompile (data-missing bug)`);
    const shardPoolId = hex32(`${logicalMarketId}-shard-${shard.shard_index}`);
    // bettor-independent ps template (4 dust-ticket fields are State, spliced per register)
    // 🔴 事故修复(2026-07-07): 强制 SILVERC_LEGACY——这个 artifact 直接烤进 ShardLeaf ctor(psTmplHashHex)，
    // 属于 V1 家族续约链条一环，默认保守(同 compileShardLeafRedeem 那份理由)，不依赖调用方传入的 silverc。
    const psArtifact = computePoolSideArtifact(join(LIB, 'PoolSide_v08_shard.sil'), [ctorBytes32(bettorPk), ctorInt(direction), ctorInt(stake), ctorBytes32(z32)], SILVERC_LEGACY);
    const fundTx = await transfer(relayAddr, stake + 100_000_000);         // gateway funds stake-into-leaf + fee headroom (built once, reused across retries below — independent of which leaf-state we're appending onto)

    // #tip-lag retry (2026-07-05, Bettor 拍板·公测流量下 race 更频繁): register_append 撞
    // "UTXO not found"(相当于打到一个刚被别的并发赢家抢先花掉的 stale outpoint)时, 不直接
    // throw 让用户看到失败——重新从 DB 读一次这个 shard 的【当前】current_leaf_outpoint/state
    // (若刚才是并发输家, 这次会读到赢家写完之后的新 tip), 用新 state 重建 witness/cmd 重试。
    // 安全性: fundTx(付款进 gateway 的那笔转账)已经完成、金额只取决于 stake 不取决于具体
    // outpoint, 不需要重来; "UTXO not found" 这个报错在 relay 侧(p2sh.mjs)是【构建阶段】
    // 检查不到要花的 UTXO 就直接 throw, 从没广播过 TX, retry 不会双花/双register。有界 3 次
    // (给两三个并发赢家轮流写完 DB 的时间), 每次之间不 sleep(重新读 DB 就是最新的, 不需要等)。
    const MAX_TIP_RETRY = 3;
    let lastErr = null;
    for (let attempt = 0; attempt < MAX_TIP_RETRY; attempt++) {
      if (attempt > 0) {
        const fresh = db.prepare(`SELECT * FROM market_shards WHERE shard_market_id = ?`).get(shard.shard_market_id);
        if (!fresh || !fresh.current_leaf_outpoint || !fresh.current_leaf_state) throw lastErr || new Error(`shard ${shard.shard_market_id} tip-retry: no fresh state to retry with`);
        shard = fresh;
      }
      const st = JSON.parse(shard.current_leaf_state);                     // {local_yes, local_no, count, pool_value}
      const curRedeem = spliceLeafState(shard.shard_redeem_hex, st);
      const newState = { local_yes: st.local_yes + (direction === 0 ? stake : 0), local_no: st.local_no + (direction === 1 ? stake : 0), count: st.count + 1, pool_value: st.pool_value + stake };
      const [leafTxid] = String(shard.current_leaf_outpoint).split(':');
      const witness = buildRegisterWitness({ side: direction, stake: BigInt(stake), leafOutIdx: 0, psOutIdx: 1, bettorPk, psArtifact });
      const cmd = buildRegisterCommand({
        witness, leafOutpointTxid: leafTxid, leafRedeemHex: curRedeem, currentLeafState: st,
        bettorFunding: [{ outpointTxid: fundTx, address: relayAddr, index: 0 }], leafValueSompi: BigInt(st.pool_value),
        leafContinuationState: newState, ticketDustSompi: TICKET_DUST, shardPoolId, changeAddress: relayAddr,
      });
      try {
        const rj = await rc(cmd);
        const regTx = rj.txId || rj.txid;
        const leafContAddr = rj.leafContinuationAddress || p2sh(spliceLeafState(shard.shard_redeem_hex, newState));
        if (!regTx || !await landed(regTx, leafContAddr)) throw new Error(`register_append no land: ${JSON.stringify(rj).slice(0, 160)}`);

        if (recordBettor) await recordBettor({ shardMarketId: shard.shard_market_id, shardIndex: shard.shard_index, bettorPk, direction, stakeSompi: stake, leafTx: regTx });
        onBettorRegistered(db, shard.shard_market_id, { currentLeafOutpoint: `${regTx}:0`, currentLeafState: newState, nowSec: Math.floor(Date.now() / 1000) });
        await _maybeDefrag(rc);
        return { action: 'use', shardIndex: shard.shard_index, shardMarketId: shard.shard_market_id, shardP2sh: shard.shard_p2sh, leafTx: regTx, leafOutpoint: `${regTx}:0`, leafState: newState, payoutCovId };
      } catch (e) {
        lastErr = e;
        const isTipLag = /UTXO not found/i.test(e.message || '');
        if (!isTipLag || attempt === MAX_TIP_RETRY - 1) throw e;
        console.warn(`[registerBettorOnShard] tip-lag retry ${attempt + 1}/${MAX_TIP_RETRY} on ${shard.shard_market_id}: ${e.message}`);
      }
    }
    throw lastErr;
  }

  // ── 'open_new' (A(b) 修, 2026-06-23 J2; 三方收敛 C1 安全洞修): genesis 一个【空】 ShardLeaf (count=0, maker seed, 非 bettor) ──
  //   再让【本注】落 'use' register_append 路 (count 0→1 + mint PoolSide ticket)。根除旧 open_new 的 C1 安全洞:
  //   旧版把首注 baked 进 genesis (count=1) 但【不 mint PoolSide ticket】(只 'use'/buildRegisterCommand psOutIdx:1 mint)
  //   → 每片首注无 per-bettor 链锚 (level2-B anti-swap BUST) + 无法 claim 奖金 (无 claim 票)。A(b) 统一全注走 use-branch。
  //   ★ Bettor 钉的测点: 空 genesis 地址 genAddr (= p2sh(genRedeem)) 必 == 后续 'use' 对 (0,0,0,0) state 的 leaf 地址
  //     (= p2sh(spliceLeafState(genRedeem,{0,0,0,0})))。compileShardLeafRedeem 烤的 (0,0,0,0) State 区 ==
  //     spliceLeafState 写的 (0,0,0,0) 4×PUSH8(i64LE 0) → byte-identical → 同址 (spliceLeafState byte-equal-to-recompile 已验)。
  //   leafValueSompi 起点: 'use' 传 st.pool_value=0 → buildRegisterCommand newLeafValue=0+stake=stake → 合约 weld
  //     out==pool_value(0)+stake 过; genesis seed (0.2KAS) 是 relay input, _appendChange 退 change (不进池)。
  const shardIndex = alloc.nextIndex;
  const shardPoolId = hex32(`${logicalMarketId}-shard-${shardIndex}`);
  // psArtifact = bettor-INDEPENDENT 模板 (4 dust-ticket 字段是 State, register 时 splice); ps_tmpl_hash 进 leaf ctor (bettorPk/dir/stake 只占位求模板, z32 占 shardPoolId 位)。
  // 🔴 事故修复(2026-07-07): 同上处理，强制 SILVERC_LEGACY，不依赖调用方传入的 silverc。
  const psArtifact = computePoolSideArtifact(join(LIB, 'PoolSide_v08_shard.sil'), [ctorBytes32(bettorPk), ctorInt(direction), ctorInt(stake), ctorBytes32(z32)], SILVERC_LEGACY);
  const genState = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 };  // 空 maker seed (非 bettor; level2-A Σcount==loaded 排除它)
  const genRedeem = compileShardLeafRedeem({ marketIdHash, psTmplHashHex: psArtifact.templateHashHex, shardPoolId, sealCount, payoutCovId, deadline, localYes: 0, localNo: 0, count: 0, poolValue: 0, silverc });
  const genAddr = p2sh(genRedeem);
  const genTx = await transfer(genAddr, SHARD_GENESIS_SEED);                // 空 genesis seed (dust, 非 bet stake)
  if (!await landed(genTx, genAddr)) throw new Error('ShardLeaf empty-genesis no land');

  // pool_markets row for this physical shard (UNIQUE shard_market_id in registry) — caller maps shard→market row.
  const shardMarketId = createShardMarketRow ? await createShardMarketRow(shardIndex, genAddr) : `${logicalMarketId}#${shardIndex}`;
  try {
    if (alloc.sealPrevId) sealShard(db, alloc.sealPrevId, Math.floor(Date.now() / 1000));
    registerShard(db, { logicalMarketId, shardIndex, shardMarketId, shardP2sh: genAddr, currentLeafOutpoint: `${genTx}:0`, currentLeafState: genState, shardRedeemHex: genRedeem, nowSec: Math.floor(Date.now() / 1000) });
  } catch (e) {
    // UNIQUE(logical_market_id, shard_index) race: another concurrent open_new won → retry the whole register.
    if (/UNIQUE/i.test(e.message)) { o._retry = (o._retry || 0) + 1; if (o._retry > 3) throw new Error('open_new race retry exhausted'); return registerBettorOnShard(o); }
    throw e;
  }
  // 空 genesis 【不】 recordBettor (它是 maker seed count=0, 非 bettor)。本注落 'use' register_append 路: 新空 shard 现 status=open
  //   有 room (count=0<32) → allocateForRegister 返 'use' → register_append (count 0→1 + mint ticket + recordBettor)。
  o._openedShard = (o._openedShard || 0) + 1;
  if (o._openedShard > 3) throw new Error('open_new→use loop guard (empty-genesis 未被 allocateForRegister 认出 open shard?)');
  return registerBettorOnShard(o);
}
