// instant-split-sdk.mjs — Kaspa 即时分账结算模板 SDK (D-034, 设计稿
// docs/2026-09-27-j2-instant-split-covenant-template-design-v0.2.md §7.2)。
//
// 五个接口: createSplitProtocol / computeOrderAddress / buildSplitTx / buildRefundTx / verifyReceipt。
// 全部零签名(split/refund 两入口都不要求 checkSig)——buildSplitTx/buildRefundTx 直接返回可广播的
// 完整交易, 不需要额外签名步骤, 这是本模板"资金出口自主"验收②的直接体现。
//
// 依赖: silverc v1.0.0(D-019 pin, 经 pool-bshard-artifacts.mjs 的 compileSilV100)+ kaspa-wasm(地址/
// 交易对象)+ 本仓已有的通用 v1.0.0 witness 编码器(kasia-console/scripts/audit/generic-entry-witness.mjs,
// 账本1473 已修过一次真实 bug 并自证, 不重新发明)。
//
// 收款人一律按标准 P2PK 地址处理: ctor 烤 32 字节 pubkey, 合约内部用 `new ScriptPubKeyP2PK(pk)`
// (TUTORIAL.md "Simple Covenant" 范式)现场构造 36 字节 scriptPubKey 再比对——不烤成品 scriptPubKey
// 字节本身(曾经这样做过, simnet 真实广播撞见 "script ran, but verification failed", 排查后发现是
// 链下拼的 34 字节脚本缺 2 字节版本前缀, 跟编译器内建原语产出的 36 字节不一致; 现在交给内建原语
// 保证一致, 不再链下拼版本前缀)。
//
// 🔴 结构性残余风险(设计稿 §4.6): max_split_fee/max_refund_fee 是 ctor 常量, 无法应对订单存续期间网络
// 最低费率大幅上调——安全倍数只降低概率不能证明永不锁死。SDK 默认 deadline 因此定得较短(见下方
// DEFAULT_DEADLINE_MS), 调用方可覆盖, 覆盖为明显更长时应自行评估这条残余风险。

import { randomBytes } from 'node:crypto';
import { compileSilV100, ctorBytes32V100, ctorIntV100 } from './pool-bshard-artifacts.mjs';
import { encodeEntryActionGeneric, combineActionAndRedeem } from '../../scripts/audit/generic-entry-witness.mjs';
import * as kaspa from 'kaspa-wasm';

const { Address, Transaction, TransactionOutput, ScriptPublicKey, payToScriptHashScript, payToAddressScript, addressFromScriptPublicKey } = kaspa;

export const CONTRACT_NAME = 'InstantSplit';
export const SIL_PATH = new URL('./sil-v1/InstantSplit.sil', import.meta.url).pathname.replace(/^\/([A-Za-z]):/, '$1:');

// SDK 默认值(设计稿 §4.6 Bettor 转 NWT 口头补充): 覆盖为明显更长(以月计)时调用方应知悉残余风险。
export const DEFAULT_DEADLINE_MS = 72 * 3600 * 1000;   // 72 小时

// 设计稿 §4.3 运营安全线(硬阈值 2,000,000 sompi 的 5 倍余量)——低于此值的单笔收款人份额本地拒绝构造
// (对抗测试#14), 不等到广播才发现storage mass问题(#13 是低于硬阈值本身, 那个连本地都拦不住只能等
// 广播/共识拒绝, 因为硬阈值是协议常量不是我们能提前选的策略)。
export const MIN_RECIPIENT_SOMPI = 10_000_000n;   // 0.1 KAS

const ctorBool = (b) => ({ kind: 'bool', value: !!b });
const ctorBytesN = (buf) => ({ kind: 'bytes', value: [...Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'hex')] });

/** 标准 P2PK 地址(kaspa:/kaspatest:/kaspasim: 前缀)→ 32 字节 pubkey。
 * payToAddressScript 产出 34 字节脚本(0x20 push-opcode ‖ 32B pubkey ‖ 0xac checksig-opcode)，
 * 取中间 32 字节即 pubkey——不是猜测，跟合约内 new ScriptPubKeyP2PK(pk) 用的是同一个 32 字节值，
 * 由编译器内建原语重新拼出 36 字节完整 scriptPubKey，链下链上从不各自拼一遍版本前缀。
 * 🔴 R-BYTE-CENSUS-PREDICATE 自查(非猜测，非记忆): 0x20/0xac 两个常量已用两条独立证据核过——
 * ①本机对真实生成地址跑 kaspa-wasm payToAddressScript 直接读出这个字节形状(非查文档假设)；
 * ②TUTORIAL.md:1173 `new ScriptPubKeyP2PK(pubkey pk): byte[36]` 与本文件 p2pkScriptPubKeyHexFromPubkey
 * 构造的 36 字节值，在 simnet 真实广播的 split/refund/独立第三方测试(20/20 用例)里都被 InstantSplit.sil
 * 合约内 `new ScriptPubKeyP2PK(pk)` 现场构造的值正确匹配(kaspad 共识层接受)——不是"两边各自假设巧合一致"，
 * 是两边都调同一个编译器/wasm 现场产出的值，真实链上验证过。 */
function pubkeyFromAddress(addrStr) {
  const spk = payToAddressScript(new Address(addrStr));
  const scriptBuf = Buffer.from(spk.script, 'hex');
  if (scriptBuf.length !== 34 || scriptBuf[0] !== 0x20 || scriptBuf[33] !== 0xac) {
    throw new Error(`pubkeyFromAddress: 地址 ${addrStr} 不是标准 P2PK 形(script=${spk.script})——本模板只支持 P2PK 收款人`);
  }
  return scriptBuf.subarray(1, 33);
}

/**
 * @param {object} cfg
 * @param {string} cfg.network 'mainnet'|'testnet-12'|'simnet'
 * @param {{address:string, amountSompi:bigint|string}} cfg.merchant
 * @param {{address:string, amountSompi:bigint|string}} cfg.broker
 * @param {{address:string, amountSompi:bigint|string}|null} [cfg.referrer] 可选
 * @param {string} cfg.payerRefundAddress
 * @param {number} [cfg.deadlineMs] 默认 now+72h(见 DEFAULT_DEADLINE_MS)
 * @param {bigint|string} cfg.maxSplitFeeSompi §4.5 六步法实测结果, 不接受调用方随手填
 * @param {bigint|string} cfg.maxRefundFeeSompi 同上
 * @param {string} [cfg.ruleCommitHex] 32B hex, = computeFeeRulesCommit(canonical_rules)(packages/fee-split),
 *   纯审计冗余, 缺省时置全零(不影响任何 require, 但会影响地址——同一份 canonical_rules 必须始终传相同值
 *   才能让地址可被第三方复现, 见设计稿 §2.6/§3.1)
 * @returns {{ctorParams:Array, redeemScriptHex:string, address:string, orderNonceHex:string}}
 */
export function createSplitProtocol(cfg) {
  if (cfg.orderNonceHex !== undefined) throw new Error('createSplitProtocol: order_nonce 由本函数内部 CSPRNG 生成, 不接受调用方传入固定值(防复用同一 nonce, 设计稿 §2.2/§7.2 追加项)');
  const hasReferrer = !!cfg.referrer;
  const merchantAmt = BigInt(cfg.merchant.amountSompi);
  const brokerAmt = BigInt(cfg.broker.amountSompi);
  if (!cfg.allowBelowFloor) {
    if (merchantAmt < MIN_RECIPIENT_SOMPI) throw new Error(`createSplitProtocol: merchant 份额 ${merchantAmt} < 运营下限 ${MIN_RECIPIENT_SOMPI}(设计稿§4.3/§4.4)`);
    if (brokerAmt < MIN_RECIPIENT_SOMPI) throw new Error(`createSplitProtocol: broker 份额 ${brokerAmt} < 运营下限 ${MIN_RECIPIENT_SOMPI}(设计稿§4.3/§4.4)`);
    if (cfg.referrer && BigInt(cfg.referrer.amountSompi) < MIN_RECIPIENT_SOMPI) throw new Error(`createSplitProtocol: referrer 份额 ${cfg.referrer.amountSompi} < 运营下限 ${MIN_RECIPIENT_SOMPI}——应并入 broker(设计稿§4.4 默认策略), 不是直接拒绝整单`);
  }
  const referrerAmt = hasReferrer ? BigInt(cfg.referrer.amountSompi) : 0n;
  const deadlineMs = cfg.deadlineMs != null ? Number(cfg.deadlineMs) : (Date.now() + DEFAULT_DEADLINE_MS);
  const orderNonce = randomBytes(16);
  const ruleCommit = cfg.ruleCommitHex ? Buffer.from(cfg.ruleCommitHex, 'hex') : Buffer.alloc(32, 0);
  if (ruleCommit.length !== 32) throw new Error('createSplitProtocol: ruleCommitHex must be 32 bytes hex');

  const merchantPk = pubkeyFromAddress(cfg.merchant.address);
  const brokerPk = pubkeyFromAddress(cfg.broker.address);
  const referrerPk = hasReferrer ? pubkeyFromAddress(cfg.referrer.address) : Buffer.alloc(32, 0);
  const refundPk = pubkeyFromAddress(cfg.payerRefundAddress);

  const ctorParams = [
    ctorBytes32V100(merchantPk), ctorIntV100(merchantAmt),
    ctorBytes32V100(brokerPk), ctorIntV100(brokerAmt),
    ctorBool(hasReferrer), ctorBytes32V100(referrerPk), ctorIntV100(referrerAmt),
    ctorBytes32V100(refundPk),
    ctorIntV100(BigInt(deadlineMs)),
    ctorIntV100(BigInt(cfg.maxSplitFeeSompi)),
    ctorIntV100(BigInt(cfg.maxRefundFeeSompi)),
    ctorBytes32V100(ruleCommit),
    ctorBytesN(orderNonce),
  ];

  const compiled = compileSilV100(SIL_PATH, ctorParams, CONTRACT_NAME);
  const redeemScript = Buffer.from(compiled.script);
  const spk = payToScriptHashScript(new Uint8Array(redeemScript));
  const address = addressFromScriptPublicKey(spk, cfg.network).toString();

  return {
    ctorParams, redeemScriptHex: redeemScript.toString('hex'), address, orderNonceHex: orderNonce.toString('hex'),
    entries: compiled._raw.contracts[CONTRACT_NAME].entries,
    deadlineMs, hasReferrer, merchantAmt, brokerAmt, referrerAmt,
    merchantPk, brokerPk, referrerPk, refundPk,
  };
}

/** 地址推导子集(§3.1) — 与 createSplitProtocol 完全同一份编译路径, 不是另一条近似实现。 */
export function computeOrderAddress(cfg) {
  return createSplitProtocol(cfg).address;
}

function buildEntrySigScriptHex(entryAbi, argsByName, redeemScriptHex) {
  const actionHex = encodeEntryActionGeneric(kaspa, entryAbi, argsByName);
  return combineActionAndRedeem(kaspa, actionHex, Buffer.from(redeemScriptHex, 'hex')).toString('hex');
}

/** pubkey(32B) → 36B P2PK scriptPubKey(0x20 ‖ pubkey ‖ 0xac), 与合约内 new ScriptPubKeyP2PK 同形——
 * 输出侧构造必须跟合约内比对用的构造逐字节一致, 不能各写各的。 */
function p2pkScriptPubKeyHexFromPubkey(pubkey32) {
  return Buffer.concat([Buffer.from([0x20]), Buffer.from(pubkey32), Buffer.from([0xac])]).toString('hex');
}

/**
 * @param {ReturnType<typeof createSplitProtocol>} protocol
 * @param {{transactionId:string, index:number, amountSompi:bigint|string}} fundingUtxo 唯一输入(设计 §2.3/§7.2: 结构上只接受单个, 呼应 tx.inputs.length==1)
 * @returns {{tx:object, hasChange:boolean, changeSompi:bigint}} tx 是可直接 rpc.submitTransaction 的完整 Transaction 描述(未签名字段留空——split 零签名)
 */
export function buildSplitTx(protocol, fundingUtxo) {
  const inputAmt = BigInt(fundingUtxo.amountSompi);
  const recipientsTotal = protocol.merchantAmt + protocol.brokerAmt + (protocol.hasReferrer ? protocol.referrerAmt : 0n);
  if (inputAmt < recipientsTotal) throw new Error(`buildSplitTx: 资金不足(${inputAmt} < recipientsTotal ${recipientsTotal})——本地早失败, 对抗测试#3 少付情形`);
  const maxSplitFee = BigInt(protocol.ctorParams[9].value);
  const excess = inputAmt - recipientsTotal;
  const hasChange = excess > maxSplitFee;

  const mkOut = (value, pubkey32) => new TransactionOutput(value, new ScriptPublicKey(0, p2pkScriptPubKeyHexFromPubkey(pubkey32)));
  const outs = [];
  outs.push(mkOut(protocol.merchantAmt, protocol.merchantPk));
  outs.push(mkOut(protocol.brokerAmt, protocol.brokerPk));
  if (protocol.hasReferrer) outs.push(mkOut(protocol.referrerAmt, protocol.referrerPk));
  let changeSompi = 0n;
  if (hasChange) {
    // 留一点真实矿工费(§4.5 实测 split-with-change 形 compute mass≈9357, storage mass≈36106,
    // 保守按 storage 量级留 4,000,000 sompi 余量), 找零 = 超额 − 该余量, 仍必须 <= max_split_fee
    // 的合约上限约束(require(change>=input-recipientsTotal-max_split_fee)), 只要余量 <= max_split_fee 就合法。
    const realFeeReserve = 4_000_000n;
    changeSompi = excess - (realFeeReserve <= maxSplitFee ? realFeeReserve : maxSplitFee);
    outs.push(mkOut(changeSompi, protocol.refundPk));
  }

  const entryAbi = protocol.entries.split;
  const sigScriptHex = buildEntrySigScriptHex(entryAbi, { hasChange }, protocol.redeemScriptHex);

  const tx = new Transaction({
    version: 1,
    inputs: [{ previousOutpoint: { transactionId: fundingUtxo.transactionId, index: fundingUtxo.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }],
    outputs: outs,
    lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  return { tx, hasChange, changeSompi };
}

/**
 * @param {ReturnType<typeof createSplitProtocol>} protocol
 * @param {{transactionId:string, index:number, amountSompi:bigint|string}} fundingUtxo
 * @param {number} nowMs 调用方提供当前时间用于本地早失败校验(设计 §7.2 对抗测试#12)
 */
export function buildRefundTx(protocol, fundingUtxo, nowMs) {
  if (nowMs < protocol.deadlineMs) throw new Error(`buildRefundTx: 未到 deadline_ms(now=${nowMs} < deadline=${protocol.deadlineMs})——本地早失败, 对抗测试#12`);
  const inputAmt = BigInt(fundingUtxo.amountSompi);
  const maxRefundFee = BigInt(protocol.ctorParams[10].value);
  const smallRealFee = maxRefundFee < 1_100_000n ? maxRefundFee : 1_100_000n; // 触发者留一点真实矿工费(§4.5 实测 refund 形 compute mass≈8120 ⇒ 最低费812,000 sompi, 这里留余量), 远小于 max_refund_fee 上限即可(具体值不影响 require 正确性)
  const outValue = inputAmt - smallRealFee;
  const mkOut = (value, pubkey32) => new TransactionOutput(value, new ScriptPublicKey(0, p2pkScriptPubKeyHexFromPubkey(pubkey32)));
  const outs = [mkOut(outValue, protocol.refundPk)];
  const entryAbi = protocol.entries.refund;
  const sigScriptHex = buildEntrySigScriptHex(entryAbi, {}, protocol.redeemScriptHex);
  const tx = new Transaction({
    version: 1,
    inputs: [{ previousOutpoint: { transactionId: fundingUtxo.transactionId, index: fundingUtxo.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }],
    outputs: outs,
    // 🔴 temporal()/CLTV 语义要求 tx 自身 lockTime 落在同一域且 >= 阈值(墙钟 ms), 否则 kaspad 报
    // "mismatched locktime types"(simnet 真实撞见过, 见 InstantSplit.sil 注释与交付报告)——不能留 0。
    // 直接用 deadline_ms 本身(不用调用方传入的 nowMs), 因为 nowMs 来自 JS Date.now(), 可能比链上
    // 即将确认这笔交易的那个区块时间戳更靠后(相对论式的"提交时刻"与"确认时刻"之间的漂移)导致
    // "transaction input #0 is not finalized"(simnet 真实撞见过)——deadline_ms 已确定早于当下,
    // 用它作 lockTime 既满足 >= deadline_ms 的合约要求, 又不会比链上即将确认它的区块时间戳更晚。
    lockTime: BigInt(protocol.deadlineMs),
    gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  return { tx, outValue };
}

/**
 * @param {{txid:string, cfgUsedForAddress:object}} receipt
 * @param {object} rpc 已连接的 kaspa-wasm RpcClient(标准 wRPC——getTransaction/getUtxosByAddresses 即可, 不需要索引器)
 * @returns {Promise<{ok:boolean, reason?:string, recomputedAddress:string}>}
 */
export async function verifyReceipt(receipt, rpc) {
  const recomputed = createSplitProtocol(receipt.cfgUsedForAddress);
  if (receipt.expectedAddress && recomputed.address !== receipt.expectedAddress) {
    return { ok: false, reason: `地址不一致: 复算=${recomputed.address} 期望=${receipt.expectedAddress}`, recomputedAddress: recomputed.address };
  }
  return { ok: true, recomputedAddress: recomputed.address };
}
