// broadcast-commission.js — 浏览器版 split/refund 交易组装(D-034 §8 后续票⑥ part(b), Bettor 派工
// 2026-09-27: "不新写任何交易构造逻辑——直接复用已合入并审过的 SDK builder"）。逐字对应
// commission-plan-sdk.mjs 的 buildCommissionSplitTx / buildCommissionRefundTx / mkSpkOut / PMT_LAG_GUIDANCE
// 四项, 唯一区别: Buffer→Uint8Array(浏览器没有 Buffer), 依赖的 generic-entry-witness 换成
// vendor/generic-entry-witness-browser.mjs(已用 vendor/generic-entry-witness-browser-parity.mjs 核过
// 与 Node 原版逐字节一致)。两个入口零签名(split/refund 都不要求 checkSig)——page 本身从不持有/
// 传输任何私钥, 这点跟已合入的 Node 版 SDK 完全一致, 不是本文件新增的安全属性。
import { encodeEntryActionGeneric, combineActionAndRedeem } from './vendor/generic-entry-witness-browser.mjs';

export const PMT_LAG_GUIDANCE = 'PMT(节点 virtual_past_median_time)判据同 instant-split-sdk.mjs/commission-plan-sdk.mjs——buildCommissionRefundTx 要求调用方现查节点 PMT, 不接受 Date.now() 或 tip 时间戳(同一份推导, 不重复, 见 docs/2026-09-27-j2-instant-split-covenant-template-design-v0.2.md §4.6)。';

function buildEntrySigScriptHex(kaspaWasm, entryAbi, argsByName, redeemScriptHex) {
  const actionHex = encodeEntryActionGeneric(kaspaWasm, entryAbi, argsByName);
  const combined = combineActionAndRedeem(kaspaWasm, actionHex, hexToBytes(redeemScriptHex));
  return bytesToHex(combined);
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0'); return s; }

// 🔴 逐字对应 commission-plan-sdk.mjs mkSpkOut 头注的真实发现: spkBytesFromAddress 返回的是【完整】
// 序列化 scriptPubKey(2 字节 version LE ‖ script), 但 kaspa-wasm 构造 TransactionOutput 时
// new ScriptPublicKey(version, scriptHex) 要的是拆开的两个字段——直接整体传会在 kaspad 广播时被判
// "non-standard script form"拒绝(T1/T2/T3/T6 初版实测踩过, 已修), 这里补齐同一条纪律。
function mkSpkOut(kaspaWasm, value, spkFull) {
  const version = spkFull[0] | (spkFull[1] << 8);
  const scriptOnly = spkFull.subarray(2);
  return new kaspaWasm.TransactionOutput(value, new kaspaWasm.ScriptPublicKey(version, bytesToHex(scriptOnly)));
}

/**
 * @param {object} kaspaWasm 已 init 好的浏览器版 kaspa-wasm 模块
 * @param {object} protocol { roles:[{name,amountSompi,spk:Uint8Array}], refundSpk:Uint8Array,
 *   maxSplitFeeSompi:BigInt, entries:{split,refund}, redeemScriptHex:string }
 * @param {{transactionId:string, index:number, amountSompi:bigint}} fundingUtxo
 * @returns {{tx:object, hasChange:boolean, changeSompi:bigint}}
 */
export function buildCommissionSplitTx(kaspaWasm, protocol, fundingUtxo) {
  const inputAmt = BigInt(fundingUtxo.amountSompi);
  const recipientsTotal = protocol.roles.reduce((a, r) => a + r.amountSompi, 0n);
  if (inputAmt < recipientsTotal) throw new Error(`buildCommissionSplitTx: 资金不足(${inputAmt} < ${recipientsTotal})`);
  const excess = inputAmt - recipientsTotal;
  const hasChange = excess > protocol.maxSplitFeeSompi;

  const outs = protocol.roles.map(r => mkSpkOut(kaspaWasm, r.amountSompi, r.spk));
  let changeSompi = 0n;
  if (hasChange) {
    const realFeeReserve = 4_000_000n;
    changeSompi = excess - (realFeeReserve <= protocol.maxSplitFeeSompi ? realFeeReserve : protocol.maxSplitFeeSompi);
    outs.push(mkSpkOut(kaspaWasm, changeSompi, protocol.refundSpk));
  }
  const sigScriptHex = buildEntrySigScriptHex(kaspaWasm, protocol.entries.split, { hasChange }, protocol.redeemScriptHex);
  const tx = new kaspaWasm.Transaction({
    version: 1,
    inputs: [{ previousOutpoint: { transactionId: fundingUtxo.transactionId, index: fundingUtxo.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }],
    outputs: outs, lockTime: 0n, gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  // massShape: 广播前 mass 预检要的 plain-object 形(⑥新增要求, 不是原 SDK 就有的字段)——直接用刚
  // 构造这笔 tx 时已经算出来的真实 sigScriptHex/outs, 不是另猜一份近似形状。
  const massShape = {
    version: 1,
    inputs: [{ signatureScript: sigScriptHex, computeBudget: 70, amount: inputAmt, spkLen: 37n, hasCovenant: true }],
    outputs: [
      ...protocol.roles.map(r => ({ value: r.amountSompi, spk: bytesToHex(r.spk).slice(4), covenant: false })),
      ...(hasChange ? [{ value: changeSompi, spk: bytesToHex(protocol.refundSpk).slice(4), covenant: false }] : []),
    ],
  };
  return { tx, hasChange, changeSompi, massShape };
}

/**
 * @param {number} currentPmtMs 调用方现查的节点 getBlockDagInfo().pastMedianTime(毫秒)——不接受
 *   Date.now() 或 tip 时间戳(同 commission-plan-sdk.mjs 既有 MUST 纪律)。
 */
export function buildCommissionRefundTx(kaspaWasm, protocol, fundingUtxo, currentPmtMs, safetyMarginMs = 5000) {
  if (currentPmtMs < protocol.deadlineMs + safetyMarginMs) {
    throw new Error(`buildCommissionRefundTx: 还没到期(currentPmtMs=${currentPmtMs} < deadline+margin=${protocol.deadlineMs + safetyMarginMs}); ${PMT_LAG_GUIDANCE}`);
  }
  const inputAmt = BigInt(fundingUtxo.amountSompi);
  const smallRealFee = protocol.maxRefundFeeSompi < 1_100_000n ? protocol.maxRefundFeeSompi : 1_100_000n;
  const outValue = inputAmt - smallRealFee;
  const outs = [mkSpkOut(kaspaWasm, outValue, protocol.refundSpk)];
  const sigScriptHex = buildEntrySigScriptHex(kaspaWasm, protocol.entries.refund, {}, protocol.redeemScriptHex);
  const tx = new kaspaWasm.Transaction({
    version: 1,
    inputs: [{ previousOutpoint: { transactionId: fundingUtxo.transactionId, index: fundingUtxo.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }],
    outputs: outs, lockTime: BigInt(protocol.deadlineMs), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  const massShape = {
    version: 1,
    inputs: [{ signatureScript: sigScriptHex, computeBudget: 70, amount: inputAmt, spkLen: 37n, hasCovenant: true }],
    outputs: [{ value: outValue, spk: bytesToHex(protocol.refundSpk).slice(4), covenant: false }],
  };
  return { tx, outValue, massShape };
}
