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
 * @param {string} kind  'market_genesis' | 'bet_mint_step_a' | 'bet_mint_step_b'
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

// 🔴 账本1435→1436订正: stake 新铸筹码(bet_mint 步骤A)的 owner 绝不能是"它自己的covenant_id"——
// covenant_id 的真实公式(rusty-kaspa consensus/core/src/hashing/covenant_id.rs:13-14)把输出的完整
// 脚本字节(含 State, 含 owner 本身)喂进哈希, "owner=自己的covenant_id"是自指不动点方程, 无解(真实
// kaspa-wasm 实测确认: 换脚本/换 value, 算出的 covenant_id 就不同)。也不能是 leaf 的 covenant_id
// (会被 ShardLeaf_direct.sil 的 scanOwnedTokenInputs 误计入奖池, 见 docs/provenance/2026-09-15-j2-
// register-append-full-tx-three-execution/ 撞出的真实回归)。改用固定哨兵值:
//   STAKE_CHIP_OWNER_UNBOUND = 全零32字节。
// 依据(ShardLeaf_direct.sil/KanetTestToken.sil 源码逐字确认):
//   ① ShardLeaf_direct.sil:140-141 对 stake 筹码只核模板形状和 amount, 不核 owner 字段——"合法在场
//      不计入"这句头注的真实含义就是"owner 不等于 leaf, 因此 scanOwnedTokenInputs(:104, owner==leaf
//      covenant_id)不会把它算进 pool_value"。ZERO32 显然 != leaf 的 covenant_id, 满足。
//   ② KanetTestToken.sil 的"在场"检查是 require(OpInputCovenantId(owner_input_idx[i]) ==
//      prev_states[i].owner)(transferPolicy:84, delegate:114)。非 covenant 输入(如 relay 的普通
//      P2PK fee 输入)的 OpInputCovenantId 回退为 ZERO_HASH——bet_mint 步骤B 花这枚筹码时, 只要把
//      owner_input_idx 指向 fee 输入(而不是 leaf), ZERO_HASH==ZERO32 自然成立, 不需要额外签名。
//   ③ owner != ZERO32 的检查(KanetTestToken.sil:102)只作用于 next_states(transferPolicy 里"正在
//      创建的输出"), 不作用于 genesis 阶段, 也不作用于 prev_states(正在花费的输入)——genesis 时把
//      owner 写成 ZERO32 不会被合约自己拒绝。
// 🔴 已知代价(账本1435/1436 明确接受, 并入 T-PROTO-BETTORPK-BINDING 同族的 T-ORPHAN-CHIP-RECOVERY-
// ENTRY): 步骤A落链后、步骤B广播前这段窗口, 任何人都能用任意一个非covenant输入冒充"在场"把这枚
// stake 筹码花掉, 导致这次下注的步骤B失败、筹码孤儿化——但攻击者拿到的东西和自己免费铸一份完全等价
// (KTT genesis 本身就是任何人免费无限铸), 没有真实损失路径。**这条取舍只在"KTT是零价值测试币"这个
// 前提下成立——如果未来 KTT 承载真实价值, 这个 owner=ZERO32 设计必须重做, 不能直接沿用。**
// 构造层能做的缓解: 步骤A落链后尽快发步骤B, 不人为延迟(driveBetIntent 已有的两步链式依赖天然如此)。
export const STAKE_CHIP_OWNER_UNBOUND = ZERO32.toString('hex');

/**
 * bet_mint 步骤 A: KanetTestToken genesis ctor(v0.3 方案C, 8 字段, 无 market_tmpl_suffix)。
 * @param {object} o
 * @param {number} o.amount  下注金额(代币内部计数值, 不是 KAS)
 * @param {string} o.ownerCovIdHex  32 字节 hex(无 0x)。**两种合法调用者, 不要混用**:
 *   (a) bet_mint 步骤A(新铸 stake 筹码) —— 传 `STAKE_CHIP_OWNER_UNBOUND`(全零), 不要传任何
 *       covenant id(自指不动点方程无解, 见上方大段注释); (b) register_append 构造"合并奖池代币"
 *       (held/新genesis, 不经过这个函数——那是 ShardLeaf_direct 自己 State 里的 owner 字段, 值是
 *       leaf 的 covenant_id, 走的是 register_append 自己的输出构造, 不是这个函数)。
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
 * @returns {{script:Buffer, scriptPubKeyHex:string, stateLayout:{start:number,len:number}}}
 */
export function computeShardLeafRedeemScript({ marketId, minBet, sealCount, rootcloseTmplHash, state }) {
  if (!/^[0-9a-f]{64}$/.test(marketId)) throw new Error(`computeShardLeafRedeemScript: marketId must be 32-byte hex, got ${marketId}`);
  if (!/^[0-9a-f]{64}$/.test(rootcloseTmplHash)) throw new Error(`computeShardLeafRedeemScript: rootcloseTmplHash must be 32-byte hex, got ${rootcloseTmplHash}`);
  const { ps_tmpl_hash, token_tmpl_hash } = loadProtocolConstants();
  const ctor = [
    ctorBytes32V100(marketId), ctorBytes32V100(ps_tmpl_hash), ctorBytes32V100(marketId),
    ctorIntV100(sealCount), ctorIntV100(minBet), ctorBytes32V100(rootcloseTmplHash), ctorBytes32V100(ZERO32.toString('hex')),
    ctorBytes32V100(token_tmpl_hash),
    ctorIntV100(state.local_yes), ctorIntV100(state.local_no), ctorIntV100(state.count), ctorIntV100(state.pool_value),
  ];
  const compiled = compileSilV100(SHARD_LEAF_DIRECT_SIL, ctor, 'ShardLeaf_direct');
  const artifact = artifactOf(compiled);
  return { script: artifact.script, scriptPubKeyHex: '0x' + p2sh(artifact.script), stateLayout: artifact.stateLayout };
}

export { p2sh, hex, ZERO32 };
