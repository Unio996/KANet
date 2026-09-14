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
const ANCHORS_JSON = new URL('../../scripts/proto-v0-template-anchors.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const ZERO32 = Buffer.alloc(32, 0x00);
const byteN = (n) => ({ kind: 'byte', value: n });
const hex = (buf) => '0x' + Buffer.from(buf).toString('hex');
const p2sh = (bc) => 'aa20' + Buffer.from(blake2b(Uint8Array.from(bc), { dkLen: 32 })).toString('hex') + '87';

let _anchorsCache = null;
/**
 * 读协议常量(一次性计算, 全市场复用)——不在这里重算, 只读 scripts/proto-v0-template-anchors.mjs
 * 的产物。缺文件/字段直接 throw(fail-loud, 不静默用旧值/占位值)。
 * @returns {{ps_tmpl_hash:string, token_tmpl_hash:string, claim_tmpl_hash:string}} 全部 32 字节 hex(无 0x 前缀)
 */
export function loadProtocolConstants() {
  if (_anchorsCache) return _anchorsCache;
  const raw = JSON.parse(readFileSync(ANCHORS_JSON, 'utf8'));
  const ps = raw?.contracts?.PoolSideTicket?.ps_tmpl_hash;
  const token = raw?.contracts?.KanetTestToken?.token_tmpl_hash;
  const claim = raw?.contracts?.KanetTokenClaim?.claim_tmpl_hash;
  if (!ps || !token || !claim) {
    throw new Error(`loadProtocolConstants: missing field(s) in ${ANCHORS_JSON} — run scripts/proto-v0-template-anchors.mjs first (ps_tmpl_hash=${!!ps} token_tmpl_hash=${!!token} claim_tmpl_hash=${!!claim})`);
  }
  _anchorsCache = { ps_tmpl_hash: ps, token_tmpl_hash: token, claim_tmpl_hash: claim };
  return _anchorsCache;
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
  const pubkeyBuf = Buffer.from(pubkeyHex, 'hex');
  if (pubkeyBuf.length !== 32) throw new Error(`computeMarketGenesisArtifacts: committee pubkey must be 32 bytes, got ${pubkeyBuf.length}`);
  const committeeHashBuf = Buffer.from(blake2b(Uint8Array.from(Buffer.concat([pubkeyBuf, pubkeyBuf, pubkeyBuf, pubkeyBuf, pubkeyBuf])), { dkLen: 32 }));
  const committeeHash = committeeHashBuf.toString('hex');

  // ② RootClaim(逐市场——ctor 烤 shard_pool_id=marketId)。genesis State 全 0(实际由
  //   RootClose.convert_to_claim 提供真实值, 这里只是为了拿 template_hash, 占位值不影响哈希)。
  const rootClaimCtor = [
    ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(marketId),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
    ctorBytes32V100(ZERO32.toString('hex')), ctorIntV100(0),
    ctorBytes32V100(token_tmpl_hash), ctorBytes32V100(claim_tmpl_hash),
  ];
  const rootClaimCompiled = compileSilV100(ROOT_CLAIM_SIL, rootClaimCtor, 'RootClaim');
  const rootClaimTmplHash = extractTemplateArtifactV100(rootClaimCompiled).templateHashHex;

  // ③ RefundClaim(同上, 逐市场, 11 ctor 字段——无 init_claimed_bitmap, RootClaim 专属字段)。
  const refundClaimCtor = [
    ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(marketId),
    ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
    ctorBytes32V100(ZERO32.toString('hex')),
    ctorBytes32V100(token_tmpl_hash), ctorBytes32V100(claim_tmpl_hash),
  ];
  const refundClaimCompiled = compileSilV100(REFUND_CLAIM_SIL, refundClaimCtor, 'RefundClaim');
  const refundClaimTmplHash = extractTemplateArtifactV100(refundClaimCompiled).templateHashHex;

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
  const shardLeafCtor = [
    ctorBytes32V100(marketId), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(marketId),
    ctorIntV100(2), ctorIntV100(minBet), ctorBytes32V100(rootCloseTmplHash), ctorBytes32V100(ZERO32.toString('hex')),
    ctorBytes32V100(token_tmpl_hash), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0), ctorIntV100(0),
  ];
  const shardLeafCompiled = compileSilV100(SHARD_LEAF_DIRECT_SIL, shardLeafCtor, 'ShardLeaf_direct');
  const shardLeafArtifact = artifactOf(shardLeafCompiled);

  return {
    committeePubkeyHex: pubkeyHex,
    committeePrivkeyEnvelope,
    committeeHash,
    rootClaimTmplHash,
    refundClaimTmplHash,
    rootCloseTmplHash,
    shardLeafDirect: {
      script: shardLeafArtifact.script,
      scriptPubKeyHex: '0x' + p2sh(shardLeafArtifact.script),
      templateHashHex: shardLeafArtifact.templateHashHex,
    },
  };
}

/**
 * bet_mint 步骤 A: KanetTestToken genesis ctor(v0.3 方案C, 8 字段, 无 market_tmpl_suffix)。
 * @param {object} o
 * @param {number} o.amount  下注金额(代币内部计数值, 不是 KAS)
 * @param {string} o.ownerCovIdHex  本市场 ShardLeaf_direct 的 covenant id(32 字节 hex, 无 0x)——
 *   注意是链上真实分配的 covenant id, 不是脚本 hash(§3 原文标注"待验证"技术点, 调用方负责提供)
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
  return { script: artifact.script, scriptPubKeyHex: '0x' + p2sh(artifact.script), templateHashHex: artifact.templateHashHex };
}

export { p2sh, hex, ZERO32 };
