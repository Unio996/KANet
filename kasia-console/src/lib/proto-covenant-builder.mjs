// proto-covenant-builder.mjs — 原型 v0 market_genesis/bet_mint 的纯构造逻辑(J2, 账本1423/1425批准
// 落码计划)。不签名不广播——只算 ctor/编译/派生 P2SH, 供 proto.js 的 buildAndBroadcast 组装 tx_json
// 后交给 driveMarketGenesis/driveBetIntent(状态机) → sendCmd(covenant_broadcast)(relay 签名+广播)。
//
// 设计: docs/2026-09-14-j2-proto-v0-covenant-construction-spec-v0.1.md §2/§3(H1(b) 撤销/v0.3 方案C
// 后已订正: KanetTestToken 现 8 ctor 字段, 无 market_tmpl_suffix, token_tmpl_hash 是真协议常量)。
//
// 依赖顺序(§2 原文): token_tmpl_hash/ps_tmpl_hash/claim_tmpl_hash(KanetTokenClaim 自己的模板 hash)
// 是协议常量(scripts/proto-v0-template-anchors.json, 全市场复用一次)——claim_tmpl_hash/
// refundclaim_tmpl_hash(RootClaim/RefundClaim 自己的模板 hash, 逐市场变化因为烤了 shard_pool_id=
// market_id) 与 rootclose_tmpl_hash 必须每个市场现算, 顺序: committee keypair → committee_hash →
// RootClaim/RefundClaim(各自现算, 互不依赖) → RootClose(依赖两者) → ShardLeaf_direct(依赖 RootClose)。
//
// 私钥边界(账本1425硬条件③, 已核对源码逐字节确认): market_genesis 全程只用委员会公钥
// (算 committee_hash), 不调用 decryptCommitteePrivkey——RootClose 的 close_commit(market_resolve,
// 不在本轮范围)才需要委员签名。bet_mint 步骤 A(KTT genesis)/步骤 B(register_append)同样不需要
// 解密: register_append entry 体内没有任何 checkSig, bettorPk 只是无签名绑定的 witness 值
// (T-PROTO-BETTORPK-BINDING 既有已知限制)。

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from './pool-bshard-artifacts.mjs';
import { extractTemplateArtifactV100 } from './pool-template-artifact.mjs';
import { generateCommitteeKeypair } from './proto-committee-key.mjs';

const require = createRequire(import.meta.url);
const { blake2b } = require('../../node_modules/@noble/hashes/blake2b.js');

const ROOT_CLAIM_SIL = new URL('./RootClaim.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const REFUND_CLAIM_SIL = new URL('./RefundClaim.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ROOT_CLOSE_SIL = new URL('./RootClose.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SHARD_LEAF_DIRECT_SIL = new URL('./ShardLeaf_direct.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const KANET_TEST_TOKEN_SIL = new URL('./sil-v1/KanetTestToken.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const POOL_SIDE_TICKET_SIL = new URL('./sil-v1/PoolSideTicket.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ANCHORS_JSON = new URL('../../scripts/proto-v0-template-anchors.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const ZERO32 = Buffer.alloc(32, 0x00);
const byteN = (n) => ({ kind: 'byte', value: n });
const hex = (buf) => '0x' + Buffer.from(buf).toString('hex');
const p2sh = (bc) => 'aa20' + Buffer.from(blake2b(Uint8Array.from(bc), { dkLen: 32 })).toString('hex') + '87';

/**
 * RootClose ctor的committee_hash(R8): blake2b(c0Pk‖c1Pk‖c2Pk‖c3Pk‖c4Pk) —— v0单操作员5槽同一把
 * 公钥, 5次拼接同一个pubkeyHex(不是5把不同的委员公钥, 见RootClose.sil文件头R8注释)。原本在
 * computeMarketGenesisArtifacts/computeRootCloseGenesisArtifact内联重复两遍(账本1497批4提取为
 * 共享helper, 供close_commit builder做签名前fail-closed校验复用, 不重复这段计算)。
 * @param {string} committeePubkeyHex 32字节hex(无0x)
 * @returns {string} 32字节hex(无0x)
 */
export function computeCommitteeHash(committeePubkeyHex) {
  const pubkeyBuf = Buffer.from(committeePubkeyHex, 'hex');
  if (pubkeyBuf.length !== 32) throw new Error(`computeCommitteeHash: committee pubkey must be 32 bytes, got ${pubkeyBuf.length}`);
  return Buffer.from(blake2b(Uint8Array.from(Buffer.concat([pubkeyBuf, pubkeyBuf, pubkeyBuf, pubkeyBuf, pubkeyBuf])), { dkLen: 32 })).toString('hex');
}

let _anchorsCache = null;
/**
 * 读协议常量(一次性计算, 全市场复用)——不在这里重算, 只读 scripts/proto-v0-template-anchors.mjs
 * 的产物。缺文件/字段直接 throw(fail-loud, 不静默用旧值/占位值)。
 * 🔴 ps_prefix/ps_suffix/token_prefix/token_suffix(账本1439, Stage 3 register_append witness 需要
 * 的 ps_prefix/ps_suffix/tok_prefix/tok_suffix 四个字段, 见 proto-tx-assembly.mjs
 * buildRegisterAppendTxJson 的 registerAppendArgs)——这些是"锚定 ctor"编译产物的模板 prefix/suffix
 * (与 ps_tmpl_hash/token_tmpl_hash 来自同一次 anchors 生成, anchors.json 早就存了这两个字段, 只是
 * 之前没读出来)。
 * @returns {{ps_tmpl_hash:string, token_tmpl_hash:string, claim_tmpl_hash:string, ps_prefix:string, ps_suffix:string, token_prefix:string, token_suffix:string}} hash 全部 32 字节 hex(无 0x 前缀), prefix/suffix 为原始 hex(无 0x 前缀, 长度不定)
 */
export function loadProtocolConstants() {
  if (_anchorsCache) return _anchorsCache;
  const raw = JSON.parse(readFileSync(ANCHORS_JSON, 'utf8'));
  const ps = raw?.contracts?.PoolSideTicket?.ps_tmpl_hash;
  const token = raw?.contracts?.KanetTestToken?.token_tmpl_hash;
  const claim = raw?.contracts?.KanetTokenClaim?.claim_tmpl_hash;
  const psPrefix = raw?.contracts?.PoolSideTicket?.templatePrefixHex;
  const psSuffix = raw?.contracts?.PoolSideTicket?.templateSuffixHex;
  const tokenPrefix = raw?.contracts?.KanetTestToken?.templatePrefixHex;
  const tokenSuffix = raw?.contracts?.KanetTestToken?.templateSuffixHex;
  if (!ps || !token || !claim || !psPrefix || !psSuffix || !tokenPrefix || !tokenSuffix) {
    throw new Error(`loadProtocolConstants: missing field(s) in ${ANCHORS_JSON} — run scripts/proto-v0-template-anchors.mjs first (ps_tmpl_hash=${!!ps} token_tmpl_hash=${!!token} claim_tmpl_hash=${!!claim} ps_prefix=${!!psPrefix} ps_suffix=${!!psSuffix} token_prefix=${!!tokenPrefix} token_suffix=${!!tokenSuffix})`);
  }
  _anchorsCache = {
    ps_tmpl_hash: ps, token_tmpl_hash: token, claim_tmpl_hash: claim,
    ps_prefix: psPrefix, ps_suffix: psSuffix, token_prefix: tokenPrefix, token_suffix: tokenSuffix,
  };
  return _anchorsCache;
}

/**
 * 读 `feeProfile[kind].cap`(同一份 anchors.json, `proto-v0-template-anchors.json` §4/§9.2 引用的
 * per-kind cap)——buildAndBroadcast 接线用, 与 covenant-broadcast-relay.mjs 硬编码的
 * GLOBAL_ABS_FEE_CAP_SOMPI(kind-无关最终兜底)是两条独立防线, 不是同一个数字的两处写法。
 * @param {string} kind  'market_genesis' | 'bet_mint_step_a' | 'register_append'(账本1462改名，原
 *   'bet_mint_step_b'——D-020 取消两步设计后这个键名已无对应概念，数据内容不变，只改名)
 * @returns {bigint}
 */
export function loadFeeProfileCap(kind) {
  const raw = JSON.parse(readFileSync(ANCHORS_JSON, 'utf8'));
  const cap = raw?.feeProfile?.[kind]?.cap;
  if (!cap) throw new Error(`loadFeeProfileCap: missing feeProfile.${kind}.cap in ${ANCHORS_JSON}`);
  return BigInt(cap);
}

/** 编译产物的常用切片(prefix/suffix, 供后续 witness 用) + template_hash, 统一形状。 */
function artifactOf(compiled) {
  const artifact = extractTemplateArtifactV100(compiled);
  return {
    script: Buffer.from(compiled.script),
    templatePrefix: artifact.templatePrefix,
    templateSuffix: artifact.templateSuffix,
    templateHashHex: artifact.templateHashHex,
    stateLayout: compiled.state_layout,
  };
}

/**
 * RootClaim/RefundClaim 各自的模板 hash(逐市场变化——ctor 烤 shard_pool_id=marketId)。
 * 🔴 只依赖 marketId + 协议常量(ps_tmpl_hash/token_tmpl_hash/claim_tmpl_hash), state 全 0 占位
 * 不影响模板 hash(账本1468矩阵实测证实)——因此**这两个值任何时候都能从 marketId 现算，不需要
 * 持久化存储**，与 rootCloseTmplHash(依赖随机生成的 committeeHash，genesis 时的唯一值，之后无法
 * 重新推导，必须存 proto_markets.rootclose_tmpl_hash)性质不同。原为 computeMarketGenesisArtifacts
 * 内联逻辑，账本1491 实现计划v0.2批3提取为共享 helper，供 computeRootCloseGenesisArtifact
 * (market_seal 用)复用，不重复这段 ctor 构造。
 * @param {object} o
 * @param {string} o.marketId  32 字节 hex(无 0x)
 * @returns {{rootClaimTmplHash:string, refundClaimTmplHash:string}}
 */
export function computeRootClaimAndRefundClaimTmplHashes({ marketId }) {
  if (!/^[0-9a-f]{64}$/.test(marketId)) throw new Error(`computeRootClaimAndRefundClaimTmplHashes: marketId must be 32-byte hex, got ${marketId}`);
  const { ps_tmpl_hash, token_tmpl_hash, claim_tmpl_hash } = loadProtocolConstants();

  const rootClaimCtor = [
    ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(marketId),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
    ctorBytes32V100(ZERO32.toString('hex')), ctorIntV100(0),
    ctorBytes32V100(token_tmpl_hash), ctorBytes32V100(claim_tmpl_hash),
  ];
  const rootClaimCompiled = compileSilV100(ROOT_CLAIM_SIL, rootClaimCtor, 'RootClaim');
  const rootClaimTmplHash = extractTemplateArtifactV100(rootClaimCompiled).templateHashHex;

  const refundClaimCtor = [
    ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(marketId),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
    ctorBytes32V100(ZERO32.toString('hex')),
    ctorBytes32V100(token_tmpl_hash), ctorBytes32V100(claim_tmpl_hash),
  ];
  const refundClaimCompiled = compileSilV100(REFUND_CLAIM_SIL, refundClaimCtor, 'RefundClaim');
  const refundClaimTmplHash = extractTemplateArtifactV100(refundClaimCompiled).templateHashHex;

  return { rootClaimTmplHash, refundClaimTmplHash };
}

/**
 * market_genesis 的完整 ctor 推导链(§2 原文顺序)——只算, 不签名不广播。
 * @param {object} o
 * @param {string} o.marketId  32 字节 hex(无 0x), 后端 randomUUID() 转 32 字节的结果(调用方负责派生)
 * @param {number} o.minBet
 * @param {number} o.deadlineMs
 * @returns {{
 *   committeePubkeyHex:string, committeePrivkeyEnvelope:string, committeeHash:string,
 *   rootClaimTmplHash:string, refundClaimTmplHash:string, rootCloseTmplHash:string,
 *   shardLeafDirect:{script:Buffer, scriptPubKeyHex:string, templateHashHex:string},
 * }}
 */
export async function computeMarketGenesisArtifacts({ marketId, minBet, deadlineMs }) {
  if (!/^[0-9a-f]{64}$/.test(marketId)) throw new Error(`computeMarketGenesisArtifacts: marketId must be 32-byte hex, got ${marketId}`);
  if (!(Number(minBet) > 0)) throw new Error('computeMarketGenesisArtifacts: minBet must be > 0');
  if (!(Number(deadlineMs) > 0)) throw new Error('computeMarketGenesisArtifacts: deadlineMs must be > 0');
  const { ps_tmpl_hash, token_tmpl_hash, claim_tmpl_hash } = loadProtocolConstants();

  // ① 委员会 keypair(v0 单操作员, 5 槽同一把公钥)——本函数只用公钥, 私钥立即加密, 不解密不 log。
  const { generateCommitteeKeypair: gen } = await import('./proto-committee-key.mjs');
  const { encryptCommitteePrivkey } = await import('./proto-committee-key.mjs');
  const { privKeyHex, pubkeyHex } = await gen();
  const committeePrivkeyEnvelope = encryptCommitteePrivkey(privKeyHex);
  const committeeHash = computeCommitteeHash(pubkeyHex);

  // ②③ RootClaim/RefundClaim 模板 hash——提取为共享 helper(见下 computeRootClaimAndRefundClaimTmplHashes),
  //   供 computeRootCloseGenesisArtifact(market_seal 用, 实现计划v0.2 §2.1)复用, 不重复这段 ctor
  //   构造逻辑。两者都只依赖 marketId + 协议常量(全 0 占位 state 不影响模板 hash), 因此**不需要
  //   持久化存储**——任何时候都能从 marketId 现算, 这与 rootCloseTmplHash(依赖随机生成的
  //   committeeHash, 不可重新推导, 必须存 proto_markets.rootclose_tmpl_hash)性质不同。
  const { rootClaimTmplHash, refundClaimTmplHash } = computeRootClaimAndRefundClaimTmplHashes({ marketId });

  // ④ RootClose(依赖②③, 逐市场——烤 committee_hash/claim_tmpl_hash=rootClaimTmplHash/
  //   refundclaim_tmpl_hash=refundClaimTmplHash)。genesis State 全 0(实际由 seal_to_root 提供)。
  const rootCloseCtor = [
    ctorBytes32V100(committeeHash), ctorIntV100(deadlineMs),
    ctorBytes32V100(rootClaimTmplHash), ctorBytes32V100(refundClaimTmplHash), ctorBytes32V100(token_tmpl_hash),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
    ctorBytes32V100(ZERO32.toString('hex')),
  ];
  const rootCloseCompiled = compileSilV100(ROOT_CLOSE_SIL, rootCloseCtor, 'RootClose');
  const rootCloseTmplHash = extractTemplateArtifactV100(rootCloseCompiled).templateHashHex;

  // ⑤ ShardLeaf_direct(依赖④, genesis 输出本身——seal_count=2 v0 固定, min_bet=USER, 4-field 全 0)。
  // 🔴 账本1469/1470(Bettor裁定): own_redeem_len 用不动点收敛现算(见 convergeShardLeafOwnRedeemLen),
  // 不能猜/不能是全局常量(账本1468矩阵实测证实会随seal_count/min_bet的minimal-push编码宽度门槛变化)。
  const { ownRedeemLen: shardLeafOwnRedeemLen, artifact: shardLeafArtifact } = convergeShardLeafOwnRedeemLen({
    marketId, psTmplHash: ps_tmpl_hash, sealCount: 2, minBet, rootCloseTmplHash, tokenTmplHash: token_tmpl_hash,
    state: { local_yes: 0, local_no: 0, count: 0, pool_value: 0 },
  });

  return {
    committeePubkeyHex: pubkeyHex,
    committeePrivkeyEnvelope,
    committeeHash,
    rootClaimTmplHash,
    refundClaimTmplHash,
    rootCloseTmplHash,
    shardLeafOwnRedeemLen,
    shardLeafDirect: {
      script: shardLeafArtifact.script,
      scriptPubKeyHex: '0x' + p2sh(shardLeafArtifact.script),
      templateHashHex: shardLeafArtifact.templateHashHex,
    },
  };
}

/**
 * (账本1469, Bettor裁定①②③) 对给定 ctor 组合(marketId/psTmplHash/sealCount/minBet/rootCloseTmplHash/
 * tokenTmplHash/state)不动点收敛出 own_redeem_len——ShardLeaf_direct 裸编译产物自身的字节长度, 烤入
 * 该市场自己的 ctor(第13个字段), register_append 自续约切片要用。
 *
 * 收敛原理: own_redeem_len 本身作为一个 ctor int 字段, 也参与 minimal-push 编码(账本1468矩阵实测:
 * seal_count/min_bet 跨编码宽度门槛时编译产物变长, own_redeem_len 同理), 所以"猜一个值编译→量出真实
 * 长度→用真实长度再编"这个过程本身也可能因为 own_redeem_len 自己变宽而再长几个字节——直到某一轮"猜测值
 * == 编译出的真实长度"为止(state 区四个 init_* 字段经验证不影响长度, 不参与收敛)。
 *
 * 只用于**genesis 时**(建出一个新市场)或**离线验证/矩阵测试**——不用于 register_append 重建(那里必须
 * 从已存 ctor 原样读回, 见 computeShardLeafRedeemScript 的 fail-closed 断言, 不重新收敛)。
 *
 * @param {object} o
 * @param {string} o.marketId  32字节hex(无0x)
 * @param {string} o.psTmplHash  32字节hex(无0x), 协议常量
 * @param {number} o.sealCount
 * @param {number} o.minBet
 * @param {string} o.rootCloseTmplHash  32字节hex(无0x)——矩阵/单测场景可传任意合法32字节hex占位
 *   (编译只关心字节长度, 不校验该hash对应的RootClose是否真实存在)
 * @param {string} o.tokenTmplHash  32字节hex(无0x), 协议常量
 * @param {{local_yes:number, local_no:number, count:number, pool_value:number}} [o.state]  默认全0
 * @param {number} [o.initialGuess]  收敛起始猜测值, 默认账本1468金丝雀市场实测值14746(只影响收敛快慢,
 *   不影响最终结果)
 * @param {number} [o.maxRounds]  收敛轮数上限, 默认4(超过即 throw, fail-loud)
 * @returns {{ownRedeemLen:number, artifact:{script:Buffer, templateHashHex:string, stateLayout:object}}}
 */
export function convergeShardLeafOwnRedeemLen({
  marketId, psTmplHash, sealCount, minBet, rootCloseTmplHash, tokenTmplHash,
  state = { local_yes: 0, local_no: 0, count: 0, pool_value: 0 }, initialGuess = 14746, maxRounds = 4,
}) {
  const ctorFor = (ownRedeemLenGuess) => [
    ctorBytes32V100(marketId), ctorBytes32V100(psTmplHash), ctorBytes32V100(marketId),
    ctorIntV100(sealCount), ctorIntV100(minBet), ctorBytes32V100(rootCloseTmplHash), ctorBytes32V100(ZERO32.toString('hex')),
    ctorBytes32V100(tokenTmplHash),
    ctorIntV100(state.local_yes), ctorIntV100(state.local_no), ctorIntV100(state.count), ctorIntV100(state.pool_value),
    ctorIntV100(ownRedeemLenGuess),
  ];
  let guess = initialGuess;
  let compiled = null;
  for (let round = 1; round <= maxRounds; round++) {
    compiled = compileSilV100(SHARD_LEAF_DIRECT_SIL, ctorFor(guess), 'ShardLeaf_direct');
    const actualLen = Buffer.from(compiled.script).length;
    if (actualLen === guess) {
      const artifact = artifactOf(compiled);
      // fail-closed(Bettor③要求)双保险: 收敛循环已保证 actualLen===guess, 这里再断言一次不因为"循环写对了"就省略。
      if (artifact.script.length !== guess) {
        throw new Error(`convergeShardLeafOwnRedeemLen: fail-closed — 编译出的长度 ${artifact.script.length} != 收敛值 ${guess}`);
      }
      return { ownRedeemLen: guess, artifact };
    }
    guess = actualLen;
  }
  throw new Error(`convergeShardLeafOwnRedeemLen: own_redeem_len 不动点收敛失败(超过 ${maxRounds} 轮仍未稳定, 最后一次猜测=${guess})——拒绝, 不建出永远无法下注的市场`);
}

// 🔴 D-020(账本1446/1448, a4878d7d): bet_mint 步骤A(独立铸 stake 筹码)已取消, register_append
// 改单笔交易。原先在这里的大段 STAKE_CHIP_OWNER_UNBOUND(全零32字节哨兵owner)推导 + 已知代价说明
// 随步骤A一起作废——NWT 用真实 cli-debugger 证明了该设计的一个更严重问题(ZERO32-owner 的筹码连本带
// 锁定的真实KAS一起可被任意第三方偷走, 见账本1446, 推翻账本1436"无损失"判断), 不只是"孤儿化"这个
// 已接受的代价。account 层面, `computeKttGenesisArtifact` 本身不是 stake 专属函数, 继续用于构造
// register_append 合并输出(owner=leaf 的 covenant_id)——只是不再需要 ZERO32 哨兵值这个调用形态了。

/**
 * KanetTestToken genesis ctor(v0.3 方案C, 8 字段, 无 market_tmpl_suffix)。
 * @param {object} o
 * @param {number} o.amount  下注金额(代币内部计数值, 不是 KAS)
 * @param {string} o.ownerCovIdHex  32 字节 hex(无 0x)。register_append 构造"合并奖池代币"
 *   (held/新genesis)时传 leaf 的 covenant_id(ShardLeaf_direct 自己 State 里的 owner 字段值)。
 * @returns {{script:Buffer, scriptPubKeyHex:string, templateHashHex:string}}
 */
export function computeKttGenesisArtifact({ amount, ownerCovIdHex }) {
  if (!/^[0-9a-f]{64}$/.test(ownerCovIdHex)) throw new Error(`computeKttGenesisArtifact: ownerCovIdHex must be 32-byte hex, got ${ownerCovIdHex}`);
  const ctor = [
    ctorIntV100(amount), ctorBytes32V100(ownerCovIdHex), byteN(4), byteN(0),
    ctorBytes32V100(ZERO32.toString('hex')), ctorBytes32V100(ZERO32.toString('hex')),
    ctorIntV100(3), ctorIntV100(3),
  ];
  const compiled = compileSilV100(KANET_TEST_TOKEN_SIL, ctor, 'KanetTestToken');
  const artifact = artifactOf(compiled);
  // 🔴 账本1439(Stage 3 register_append 消费 held/stake 这两个 KTT 输入时需要): entryAbi(transfer
  // 入口的编译产物, encodeKttTransferZeroOutAction 要用)与 stateFieldCount(State 字段数, 同样用途)
  // 一起返回——这两项和 amount/owner 是同一次编译产物的不同切面, 不该让调用方为了拿到它们再重编一次
  // (那样会跑两次 silverc 且必须保证两次 ctor 完全一致, 容易出错)。
  return {
    script: artifact.script, scriptPubKeyHex: '0x' + p2sh(artifact.script), templateHashHex: artifact.templateHashHex,
    entryAbi: compiled._raw.contracts.KanetTestToken.entries.transfer,
    stateFieldCount: compiled._raw.contracts.KanetTestToken.runtime_state.fields.length,
  };
}

/**
 * (账本1439, Stage 3) PoolSideTicket genesis ctor 真实编译——register_append 每次下注都新铸一份
 * 赢票(不像 KTT stake 筹码那样可能有 held/续约, 每笔下注恰好一张新票, 不会被合并)。
 * @param {object} o
 * @param {string} o.bettorPk  32字节hex(无0x)
 * @param {number} o.direction  0=YES, 1=NO(下注方向)
 * @param {number} o.stake
 * @param {string} o.shardPoolId  32字节hex(无0x)——v0 用 marketId 本身(单市场单份额池)
 * @returns {{script:Buffer, scriptPubKeyHex:string, templateHashHex:string}}
 */
export function computeTicketGenesisArtifact({ bettorPk, direction, stake, shardPoolId }) {
  if (!/^[0-9a-f]{64}$/.test(bettorPk)) throw new Error(`computeTicketGenesisArtifact: bettorPk must be 32-byte hex, got ${bettorPk}`);
  if (!/^[0-9a-f]{64}$/.test(shardPoolId)) throw new Error(`computeTicketGenesisArtifact: shardPoolId must be 32-byte hex, got ${shardPoolId}`);
  const ctor = [ctorBytes32V100(bettorPk), ctorIntV100(direction), ctorIntV100(stake), ctorBytes32V100(shardPoolId)];
  const compiled = compileSilV100(POOL_SIDE_TICKET_SIL, ctor, 'PoolSideTicket');
  const artifact = artifactOf(compiled);
  return { script: artifact.script, scriptPubKeyHex: '0x' + p2sh(artifact.script), templateHashHex: artifact.templateHashHex };
}

/**
 * register_append(bet_mint 步骤B)构造前, 从 proto_markets 已存的值**确定性**重算 ShardLeaf_direct
 * 当前(即将被消费)的完整 redeem 脚本——不调用 computeMarketGenesisArtifacts(那个函数每次都会
 * generateCommitteeKeypair() 生成一把**新的**随机委员会密钥对, 算出的 committee_hash/rootCloseTmplHash
 * 会跟着变, 用来重算"已经落链的市场"的脚本会得到错误结果)。市场创世时唯一变化的量是委员会公钥/
 * RootClaim/RefundClaim/RootClose 这条链——但它们的**最终产物** `rootclose_tmpl_hash` 已经原样存在
 * `proto_markets.rootclose_tmpl_hash` 里, 不需要重新推导那条链, 直接用存的值当 ctor 参数即可, 确定性
 * 且与创世时编译出的字节逐位相同。
 * @param {object} o
 * @param {string} o.marketId  32字节hex(无0x)
 * @param {number} o.minBet
 * @param {number} o.sealCount
 * @param {string} o.rootcloseTmplHash  32字节hex(无0x), 来自 proto_markets.rootclose_tmpl_hash
 * @param {{local_yes:number, local_no:number, count:number, pool_value:number}} o.state
 *   当前 State(deriveLeafState 现算的值, 或 genesis 时的全 0)
 * @param {number} o.ownRedeemLen  该市场 genesis 时不动点收敛烤入 ctor 的 own_redeem_len(读自
 *   proto_markets.shardleaf_own_redeem_len)——**必填, 不重新猜/不重新收敛**(账本1469 Bettor③要求
 *   "register_append 必须从市场已存 ctor 重建"): genesis 时的收敛结果是唯一真值来源, 同
 *   rootcloseTmplHash 一类"一次性事实、之后不变"的字段, 这里只做一次编译 + fail-closed 校验。
 * @returns {{script:Buffer, scriptPubKeyHex:string, stateLayout:{start:number,len:number}}}
 */
export function computeShardLeafRedeemScript({ marketId, minBet, sealCount, rootcloseTmplHash, state, ownRedeemLen }) {
  if (!/^[0-9a-f]{64}$/.test(marketId)) throw new Error(`computeShardLeafRedeemScript: marketId must be 32-byte hex, got ${marketId}`);
  if (!/^[0-9a-f]{64}$/.test(rootcloseTmplHash)) throw new Error(`computeShardLeafRedeemScript: rootcloseTmplHash must be 32-byte hex, got ${rootcloseTmplHash}`);
  if (!(Number.isInteger(ownRedeemLen) && ownRedeemLen > 0)) throw new Error(`computeShardLeafRedeemScript: ownRedeemLen must be a positive integer(读自 proto_markets.shardleaf_own_redeem_len), got ${ownRedeemLen}`);
  const { ps_tmpl_hash, token_tmpl_hash } = loadProtocolConstants();
  const ctor = [
    ctorBytes32V100(marketId), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(marketId),
    ctorIntV100(sealCount), ctorIntV100(minBet), ctorBytes32V100(rootcloseTmplHash), ctorBytes32V100(ZERO32.toString('hex')),
    ctorBytes32V100(token_tmpl_hash),
    ctorIntV100(state.local_yes), ctorIntV100(state.local_no), ctorIntV100(state.count), ctorIntV100(state.pool_value),
    ctorIntV100(ownRedeemLen),
  ];
  const compiled = compileSilV100(SHARD_LEAF_DIRECT_SIL, ctor, 'ShardLeaf_direct');
  const artifact = artifactOf(compiled);
  // fail-closed(账本1469 Bettor③要求, register_append builder 一侧): 真实编译出的长度必须等于已存
  // ctor 里的 own_redeem_len——不等即拒绝返回(说明该市场的 seal_count/min_bet/state 与落库的
  // own_redeem_len 已经不自洽, 继续构造只会产出一笔链上必拒的交易, 不如提前 fail-loud)。
  if (artifact.script.length !== ownRedeemLen) {
    throw new Error(`computeShardLeafRedeemScript: fail-closed — 编译出的 ShardLeaf_direct 长度 ${artifact.script.length} != 已存 own_redeem_len ${ownRedeemLen}`);
  }
  return { script: artifact.script, scriptPubKeyHex: '0x' + p2sh(artifact.script), stateLayout: artifact.stateLayout };
}

/**
 * (账本1491, 实现计划v0.2 §2.1 market_seal builder用) 给定市场已存的 genesis 事实
 * (committeePubkeyHex/deadlineMs/rootCloseTmplHash——均已存 proto_markets, 见 DATABASE.md)+ 新的
 * RootClose State, 重新编译出完整 RootClose redeem 脚本。同 computeShardLeafRedeemScript 的"直接
 * 用真实 state 值重新编译"手法(不是先用全 0 探针编译再手工拼接 state 字节——两者数学等价, 因为
 * template_hash 定义上就是抽象掉 state payload 的结构哈希, 直接编译更简单, 不需要额外的 prefix/
 * suffix 手工切片步骤), 而不是 NWT 审计脚本(`nwt_04_audit_convert_to_rootclose.mjs`/
 * `run-full-chain.mjs`步骤4)里"probe 编译+手工splice"那种审计构造手法——生产代码采用已经在
 * register_append 生产路径验证过的更简单模式。
 * fail-closed(同 computeShardLeafRedeemScript 纪律): 真实编译出的模板 hash 必须等于已存的
 * rootCloseTmplHash——不等即拒绝返回, 说明 committeePubkeyHex/deadlineMs 与落库的
 * rootclose_tmpl_hash 已经不自洽, 不静默用错的 ctor 构造一笔链上必拒(或更糟——covenant_id 算错)
 * 的交易。
 * @param {object} o
 * @param {string} o.marketId  32字节hex(无0x)——RootClaim/RefundClaim tmpl hash 现算要用
 * @param {string} o.committeePubkeyHex  32字节hex(无0x), 即 proto_markets.committee_pubkeys_json[0]
 * @param {number} o.deadlineMs
 * @param {string} o.rootCloseTmplHash  32字节hex(无0x), 已存 proto_markets.rootclose_tmpl_hash,
 *   本函数只用来做 fail-closed 校验, 不是输入构造的一部分
 * @param {{local_yes:number,local_no:number,count:number,pool_value:number,closed:number,winningSide:number,payoutRoot:string}} o.state
 *   payoutRoot 为32字节hex(无0x); market_seal 时全 0(实际值由 close_commit 提供)
 * @returns {{script:Buffer, scriptPubKeyHex:string, stateLayout:object, rootClaimTmplHash:string, refundClaimTmplHash:string}}
 */
export function computeRootCloseGenesisArtifact({ marketId, committeePubkeyHex, deadlineMs, rootCloseTmplHash, state }) {
  if (!/^[0-9a-f]{64}$/.test(marketId)) throw new Error(`computeRootCloseGenesisArtifact: marketId must be 32-byte hex, got ${marketId}`);
  if (!/^[0-9a-f]{64}$/.test(committeePubkeyHex)) throw new Error(`computeRootCloseGenesisArtifact: committeePubkeyHex must be 32-byte hex, got ${committeePubkeyHex}`);
  if (!/^[0-9a-f]{64}$/.test(rootCloseTmplHash)) throw new Error(`computeRootCloseGenesisArtifact: rootCloseTmplHash must be 32-byte hex, got ${rootCloseTmplHash}`);
  if (!/^[0-9a-f]{64}$/.test(state?.payoutRoot || '')) throw new Error(`computeRootCloseGenesisArtifact: state.payoutRoot must be 32-byte hex, got ${state?.payoutRoot}`);
  if (!(Number(deadlineMs) > 0)) throw new Error('computeRootCloseGenesisArtifact: deadlineMs must be > 0');
  const { token_tmpl_hash } = loadProtocolConstants();
  const { rootClaimTmplHash, refundClaimTmplHash } = computeRootClaimAndRefundClaimTmplHashes({ marketId });

  const committeeHash = computeCommitteeHash(committeePubkeyHex);

  const ctor = [
    ctorBytes32V100(committeeHash), ctorIntV100(deadlineMs),
    ctorBytes32V100(rootClaimTmplHash), ctorBytes32V100(refundClaimTmplHash), ctorBytes32V100(token_tmpl_hash),
    ctorIntV100(state.local_yes), ctorIntV100(state.local_no), ctorIntV100(state.count), ctorIntV100(state.pool_value),
    ctorIntV100(state.closed), ctorIntV100(state.winningSide), ctorBytes32V100(state.payoutRoot),
  ];
  const compiled = compileSilV100(ROOT_CLOSE_SIL, ctor, 'RootClose');
  const artifact = artifactOf(compiled);
  if (artifact.templateHashHex !== rootCloseTmplHash) {
    throw new Error(`computeRootCloseGenesisArtifact: fail-closed — 编译出的 RootClose 模板hash(${artifact.templateHashHex}) != 已存 rootCloseTmplHash(${rootCloseTmplHash})——committeePubkeyHex/deadlineMs/marketId 与落库值已不自洽`);
  }
  return {
    script: artifact.script, scriptPubKeyHex: '0x' + p2sh(artifact.script), stateLayout: artifact.stateLayout,
    rootClaimTmplHash, refundClaimTmplHash, committeeHash,
    // 账本1497批4(close_commit): 与computeKttGenesisArtifact同理(账本1439)——entries是这次编译产物
    // 的另一个切面, 不该让调用方(buildCloseCommitTxJson)为了拿到close_commit的entryAbi用手写ctor
    // 再编译一次(容易两次ctor不一致)。close_commit/refund_flip/convert_to_claim/convert_to_refundclaim
    // 四个entry的ABI不依赖state(只依赖ctor早期字段committee_hash/deadline_ms/两个tmplHash/token_tmpl_hash),
    // 用current/new任一次调用返回的entries都一样。
    entries: compiled._raw.contracts.RootClose.entries,
  };
}

export { p2sh, hex, ZERO32 };
