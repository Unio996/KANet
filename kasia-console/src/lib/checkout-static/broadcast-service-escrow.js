// broadcast-service-escrow.js — 浏览器版 ServiceEscrow.timeout_default 交易组装(D-034 §9, Bettor 派工
// 2026-09-28: "结账页最小改动: 订单类型展示 + 到期退款按钮 + 提示"——照 broadcast-commission.js 已有的
// "不新写任何交易构造逻辑, 直接复用已合入并审过的 SDK builder"原则, 逐字对应 commission-plan-sdk.mjs
// 的 computeTimeoutSplit 公式(设计稿 v0.2 建议-5: "三处同式", 这是第三处)。
//
// 只做 timeout_default(零签名, 到期后任何人可触发)——buyer_confirm/provider_cancel 需要
// checkSig(buyer_pk/provider_pk), 页面本身不持有任何私钥, 这两个入口不在这里做, 走 KANet 控制台
// (kasia-console/src/api/service-escrow.js, relay 自己的钱包签)。
import { encodeEntryActionGeneric, combineActionAndRedeem } from './vendor/generic-entry-witness-browser.mjs';

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) { let s = ''; for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0'); return s; }

// 逐字对应 commission-plan-sdk.mjs mkSpkOut/spkBytesFromAddress 头注的真实发现(见 broadcast-commission.js
// 同名函数同一条纪律): spkFull 是【完整】序列化 scriptPubKey(2 字节 version LE ‖ script), 但
// kaspa-wasm 构造 TransactionOutput 要拆开的两个字段。
function mkSpkOut(kaspaWasm, value, spkFull) {
  const version = spkFull[0] | (spkFull[1] << 8);
  const scriptOnly = spkFull.subarray(2);
  return new kaspaWasm.TransactionOutput(value, new kaspaWasm.ScriptPublicKey(version, bytesToHex(scriptOnly)));
}

/** 逐字对应 commission-plan-sdk.mjs::computeTimeoutSplit——设计稿 v0.2 建议-5"三处同式"的第三处
 * (合约本身/SDK/结账页), 不是重新推导。amountAfterFeeSompi/timeoutBuyerBps 都是 BigInt/Number,
 * 纯整数运算, 不引入浮点。 */
export function computeTimeoutSplit(amountAfterFeeSompi, timeoutBuyerBps) {
  const amt = BigInt(amountAfterFeeSompi);
  const providerCut = amt * BigInt(10000 - Number(timeoutBuyerBps)) / 10000n;
  const buyerAmt = amt - providerCut;
  return { providerCut, buyerAmt };
}

/**
 * @param {object} kaspaWasm 已 init 好的浏览器版 kaspa-wasm 模块
 * @param {object} order ServiceEscrow 订单(结账链接里带的 quote 字段, 见 checkout.js order_kind='service_escrow'
 *   分支): { redeemScriptHex, entries:{timeout_default}, deadlineDaa, timeoutBuyerBps, maxRefundFeeSompi,
 *   providerPayoutSpk:Uint8Array, buyerRefundSpk:Uint8Array }
 * @param {{transactionId:string, index:number, amountSompi:bigint}} fundingUtxo
 * @param {number} currentDaaScore 调用方现查节点 getBlockDagInfo().virtualDaaScore(D-034 §9 建议-4,
 *   不接受本地算的近似值——同 monitor.js::getCurrentDaaScore)
 */
export function buildServiceEscrowTimeoutDefaultTx(kaspaWasm, order, fundingUtxo, currentDaaScore) {
  if (currentDaaScore < order.deadlineDaa) {
    throw new Error(`buildServiceEscrowTimeoutDefaultTx: 还没到期(currentDaaScore=${currentDaaScore} < deadlineDaa=${order.deadlineDaa})`);
  }
  const inputAmt = BigInt(fundingUtxo.amountSompi);
  const amountAfterFee = inputAmt - BigInt(order.maxRefundFeeSompi);
  if (amountAfterFee <= 0n) throw new Error(`buildServiceEscrowTimeoutDefaultTx: 资金(${inputAmt})不够扣 max_refund_fee(${order.maxRefundFeeSompi})`);
  const { providerCut, buyerAmt } = computeTimeoutSplit(amountAfterFee, order.timeoutBuyerBps);

  const outs = [
    mkSpkOut(kaspaWasm, providerCut, order.providerPayoutSpk),
    mkSpkOut(kaspaWasm, buyerAmt, order.buyerRefundSpk),
  ];
  // 逐字对应 broadcast-commission.js::buildEntrySigScriptHex 的调用形状(encodeEntryActionGeneric
  // 直接产出 hex 字符串, combineActionAndRedeem 第二参吃 redeem 的字节数组, 不是两边都转一遍)。
  const actionHex = encodeEntryActionGeneric(kaspaWasm, order.entries.timeout_default, {});
  const combined = combineActionAndRedeem(kaspaWasm, actionHex, hexToBytes(order.redeemScriptHex));
  const sigScriptHex = bytesToHex(combined);
  // 🔴 lockTime 必须是订单自己的 deadlineDaa(不是现查的 currentDaaScore)——同 kasia-relay/src/lib/p2sh.mjs
  // unlockServiceEscrowTimeoutDefault 头注那条施工期真实撞出的纪律: 现查当下反而更容易撞
  // check_tx_is_finalized 的严格小于边界竞态, 订单自己的 deadline 才是稳定值。
  const tx = new kaspaWasm.Transaction({
    version: 1,
    inputs: [{ previousOutpoint: { transactionId: fundingUtxo.transactionId, index: fundingUtxo.index }, signatureScript: sigScriptHex, sequence: 0n, sigOpCount: 0, computeBudget: 70 }],
    outputs: outs, lockTime: BigInt(order.deadlineDaa), gas: 0n, subnetworkId: '0000000000000000000000000000000000000000', payload: '',
  });
  const massShape = {
    version: 1,
    inputs: [{ signatureScript: sigScriptHex, computeBudget: 70, amount: inputAmt, spkLen: 37n, hasCovenant: false }],
    outputs: [
      { value: providerCut, spk: bytesToHex(order.providerPayoutSpk).slice(4), covenant: false },
      { value: buyerAmt, spk: bytesToHex(order.buyerRefundSpk).slice(4), covenant: false },
    ],
  };
  return { tx, providerCut, buyerAmt, massShape };
}
