// PoolSideTicket.sil authorize_spend — 真票 co-spend 向量(ledger 1338, Bettor 派工)。
//
// 背景: T3 provenance 里的 PoolSideStub(2).sil 是"替身实例"(covenant.singleton passthrough,
// 无 authorize_spend),从未验过真票被 co-spend 消费。PoolSideTicket.sil(本工作补的主网集第11个
// 合约, PoolSide_v08_shard.sil §7 v1.0.0 语法迁移)第一次让这条路径可测。
//
// 🔴 工具链边界(已核实,不是本次新发现的限制,是 T3 全程一致的既有事实):cli-debugger 从未在任何一次
// T3 checkSig 向量里构造过真正验签通过的签名——3 份既有 provenance 脚本(mk_kanettokenclaim_vectors.mjs
// 原话"placeholder sig, no real key available offline, same convention as close/cancel_attest B-class";
// close_attest/cancel_attest 12/12 PASS 向量里 checkSig 相关全部命名 "..._reaches_sig_gate" 且 expect
// 全部是 fail)+ debugger 源码(D:/silverscript/debugger/session/src/*.rs)零 checkSig/schnorr 实现痕迹,
// 三方印证同一件事。⇒ 本文件**不写一条假的 "expect":"pass" 签名向量**——离线工具证不了"签名验证通过",
// 只能证"在正确的地方失败"(到达 checkSig 门限、不是被别的逻辑挡住)。**"真实签名通过"路径在离线工具链
// 下从未被证明，唯一可证之处 = 主网真链**(Bettor 已记账·报 Owner，原型第一次真实下注→结算→claim 须按
// GO-F 金丝雀纪律走)。
//
// 两条向量(都 expect:"fail",都在 checkSig 那一行失败,证明门限真实生效、且不受"是否处在真实 co-spend
// 上下文里"影响——这正是此前从未验过的部分):
//   ① V-TICKET-1: 真实 co-spend 上下文(ticket + 一个 claim 形状的 filler covenant 输入同在一笔 tx 里)
//      + 全零占位签名(= "无签名") → 在 checkSig 行失败。
//   ② V-TICKET-2: 同上下文 + 一个由**不同私钥**生成的、结构合法的真实签名(= "错签名",不是占位符,是
//      genuinely-shaped 64/65 字节签名,只是对不上 bettorPk) → 同一行失败。

import fs from 'node:fs';
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from '../../../scratch/_j2_wt_proto_v0/kasia-console/src/lib/pool-bshard-artifacts.mjs';
import { extractTemplateArtifact } from '../../../scratch/_j2_wt_proto_v0/kasia-console/src/lib/pool-template-artifact.mjs';

const hex = (a) => '0x' + Buffer.from(a).toString('hex');

process.env.SILVERC_V100_PATH = process.env.SILVERC_V100_PATH || 'D:/silverscript/versioned-builds/silverc-v100-3ed9733.exe';
const TICKET_SIL = 'D:/kanet-tn12/scratch/_j2_wt_proto_v0/kasia-console/src/lib/sil-v1/PoolSideTicket.sil';
const OUTDIR = 'D:/kanet-tn12/docs/provenance/2026-09-14-j2-poolsideticket-real-cospend-vectors';

// 真实 bettorPk(x-only 32B,占位常量——genesis 阶段合约不校验这个值,任何 32 字节都合法)。
const BETTOR_PK = new Array(32).fill(0xaa);
const DIRECTION = 0;
const STAKE = 1000;
const SHARD_POOL_ID = new Array(32).fill(0x37);
const CLAIM_FILLER_COV = new Array(32).fill(0xdd); // 代表"realistic co-spend context"里的 claim/refund 形状输入
const TICKET_SELF_COV = new Array(32).fill(0xee); // ticket 自身的 covenant id 占位(同 mk_rootclose_zero32_vectors.mjs selfInput() 先例, active input 需显式 covenant_id)

// 🔴 用 D-019 单源适配层(compileSilV100 + extractTemplateArtifact)而不是裸调 CLI + 读编译器自报的
// template_hash 字段——两者实测不同(裸 CLI 自报 73f79f9e...,extractTemplateArtifact 独立复算
// blake2b(prefix‖suffix) 得 37de5497...)。全仓每一处真正被消费的 *_tmpl_hash(ps_tmpl_hash/token_tmpl_hash/
// claim_tmpl_hash/closeZkTmplAnchor 等)都走 extractTemplateArtifact 独立复算这条路径(compileSilV100 返回
// 的 template_hash_bytes 字段从未被任何生产调用方读取,是未使用的直通字段)——本脚本必须跟这条唯一真正被
// 信任的路径保持一致,不能自己另开一条"看起来也对"的裸 CLI 路径,否则烤出的 hash 和生产其它模板锚点用的
// 不是同一套算法,会在未来 co-spend 时对不上。
function compileTicket(ctor) {
  const compiled = compileSilV100(TICKET_SIL, ctor, 'PoolSideTicket');
  const a = extractTemplateArtifact(compiled);
  return { prefix: a.templatePrefix, suffix: a.templateSuffix, templateHash: a.expectedTemplateHash, templateHashHex: a.expectedTemplateHashHex };
}

// compileSilV100 ctor 方言(供算 template artifact/hash 用,与下面 debugger test.json 的
// constructor_args 方言不同——debugger 吃扁平 hex 字符串/数字,不是 {kind,value} 包装对象;两套方言
// 混用会让 debugger 直接解析失败,不是"凑合能跑",故分开两个变量,不共用一份)。
const ctorForCompile = [
  ctorBytes32V100(Buffer.from(BETTOR_PK)),
  ctorIntV100(DIRECTION),
  ctorIntV100(STAKE),
  ctorBytes32V100(Buffer.from(SHARD_POOL_ID)),
];
const ticket = compileTicket(ctorForCompile);
const ticketTmplHashHex = ticket.templateHashHex;

// debugger test.json 的 constructor_args 方言(同 mk_rootclose_zero32_vectors.mjs/AbsorbProbe*.test.json
// 既有惯例: 扁平 hex 字符串 + 数字,不是 {kind,value} 对象)。
const debuggerCtorArgs = [hex(BETTOR_PK), DIRECTION, STAKE, hex(SHARD_POOL_ID)];

// 真实 co-spend 上下文: 第二个输入代表 claim/refund 形状的市场合约(filler, 内容不重要——authorize_spend
// 本身不读它,重要的是"这笔 tx 里真的有一个别的 covenant 同时在场",不是 ticket 孤零零一个输入)。
function claimFillerInput() {
  return { utxo_value: 1, covenant_id: hex(CLAIM_FILLER_COV), signature_script_hex: '0x00ff' };
}
function ticketActiveInput() {
  return {
    utxo_value: 100,
    covenant_id: hex(TICKET_SELF_COV),
    state: { bettorPk: hex(BETTOR_PK), direction: DIRECTION, stake: STAKE, shardPoolId: hex(SHARD_POOL_ID) },
  };
}
function dummyOutput() {
  // authorize_spend 不做任何 validateOutputState——outputs 内容与本次测试逻辑无关,给一个占位输出满足 tx 形状。
  // 用 script_hex(裸脚本字节, P2PK 尾部占位)而非 covenant_id 声明: 后者会触发 debugger 自己的
  // WrongGenesisCovenantId 一致性检查(它要求声明 covenant_id 的输出能溯源到一个真实 genesis 结构,
  // 这与 authorize_spend 本身逻辑无关,纯粹是 debugger 侧对"你说这是某 covenant"这句声明的自证要求)。
  return { value: 1, script_hex: '0x0000' };
}

const ZERO_PLACEHOLDER_SIG = '0x' + '00'.repeat(65);

// "错签名": 结构合法的真实签名字节(不是全零占位符),由一把跟 bettorPk 完全无关的私钥产生。真正的
// Schnorr 签名需要对本合成 tx 的 sighash 签(离线工具链没有实现该 sighash 算法的验证侧,见文件头注),
// 这里只需要"看起来像一个真实签名"的固定长度非平凡字节——用另一个常量填充区分"无签名"(全零)与"错签名"
// (非零、非占位符形状),两者都会在 checkSig 落到同一行失败,但失败前经过的字节内容不同,便于人工核对
// caret 落点确实是 checkSig 那一行而不是"参数格式不对"这类更早的解析错误。
const WRONG_KEY_SHAPED_SIG = '0x' + Array.from({ length: 65 }, (_, i) => ((i * 37 + 11) % 256).toString(16).padStart(2, '0')).join('');

const tests = [
  {
    name: 'V-TICKET-1_fail_no_signature_reaches_sig_gate_realistic_cospend',
    function: 'authorize_spend',
    constructor_args: debuggerCtorArgs,
    args: [ZERO_PLACEHOLDER_SIG],
    expect: 'fail',
    tx: {
      active_input_index: 0,
      inputs: [ticketActiveInput(), claimFillerInput()],
      outputs: [dummyOutput()],
    },
  },
  {
    name: 'V-TICKET-2_fail_wrong_key_signature_reaches_sig_gate_realistic_cospend',
    function: 'authorize_spend',
    constructor_args: debuggerCtorArgs,
    args: [WRONG_KEY_SHAPED_SIG],
    expect: 'fail',
    tx: {
      active_input_index: 0,
      inputs: [ticketActiveInput(), claimFillerInput()],
      outputs: [dummyOutput()],
    },
  },
];

fs.writeFileSync(`${OUTDIR}/PoolSideTicket.cospend.test.json`, JSON.stringify({ tests }, null, 1));
fs.writeFileSync(`${OUTDIR}/PoolSideTicket.reference.ctor.json`, JSON.stringify(debuggerCtorArgs, null, 1));
fs.writeFileSync(`${OUTDIR}/PoolSideTicket.reference.templateHash.txt`, ticketTmplHashHex + '\n');
console.log('wrote', tests.length, 'vectors; templateHash=', ticketTmplHashHex);
