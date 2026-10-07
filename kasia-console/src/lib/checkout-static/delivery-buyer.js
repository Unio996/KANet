// delivery-buyer.js — 账本1877 步3: 数字商品「付款后交付」买家侧核心逻辑(浏览器与 Node 同一份; 全部副作用经注入, 便于断言 b 拦截所有请求 URL)。
//   页面只是薄壳(delivery.html + delivery-page.js): 读发票(片段里的 nonce/dl + 查询串里的公开报价) → 推导订单地址/退款地址/信箱地址(与商家 console 同一地址, 对拍见 delivery-invoice.test.mjs)
//   → 轮询信箱取货并本地解密 → 粘贴密文兜底 → 到期退款(零签名 refund) → 清扫信箱/退款到买家填的地址(用 nonce 派生的私钥在本页签名)。
//   🔴 nonce 只在页面内存: 只经 takeInvoiceFromLocation(读片段后立刻 replaceState 抹掉); 任何网络请求(读后端 fetch / 节点 rpc)只带【地址】, 不带 nonce 或其任何子串(v0.3 §3 断言 b 由测试拦截验证)。
import { takeInvoiceFromLocation, deriveMailboxKey, deriveRefundKey, deriveOrderNonce, mailboxAddress, pickDeliverable, decryptDeliverable } from './delivery-crypto.js';
import { buildCommissionRefundTx } from './broadcast-commission.js';
import { verifyQuoteSignature } from './verify-core.js';

// CommissionSplit 入口 ABI(dispatch tag 只由入口签名决定, 与 ctor 无关; 与 commission-plan-sdk 编译产物的一致性由 delivery-buyer.test.mjs 对拍)。
export const COMMISSION_ENTRIES = Object.freeze({
  refund: Object.freeze({ dispatch_tag: '777f5b11', params: Object.freeze([]) }),
  split: Object.freeze({ dispatch_tag: 'cc1c91af', params: Object.freeze([Object.freeze({ name: 'hasChange', type: Object.freeze({ kind: 'bool' }) })]) }),
});

const b64ToText = (s) => { const bin = typeof atob === 'function' ? atob(s) : Buffer.from(s, 'base64').toString('binary'); const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0)); return new TextDecoder().decode(bytes); };
const hexOf = (u8) => Array.from(u8, (x) => x.toString(16).padStart(2, '0')).join('');

/** 从页面 URL 的查询串取公开报价(?q=base64(JSON))。只读 search, 不碰片段。 */
export function readQuoteFromSearch(search) {
  const q = new URLSearchParams(String(search || '').replace(/^\?/, '')).get('q');
  if (!q) throw new Error('链接里没有报价参数(q)');
  let quote; try { quote = JSON.parse(b64ToText(q)); } catch { throw new Error('报价参数无法解析'); }
  return quote;
}

/**
 * 买家侧订单推导。deps: { kaspa, RB(resolve-order-browser 模块), feeSplitLib, sourceSha256Hex }。
 * @returns {Promise<{network:string, orderAddress:string, redeemScriptHex:string, refundAddress:string, refundPrivHex:string, mailboxAddress:string, mailboxPrivHex:string, totalSompi:bigint, deadlineMs:number, refundProtocol:object}>}
 */
export async function deriveBuyerOrder({ kaspa, RB, feeSplitLib, sourceSha256Hex, quote, orderNonceHex, deadlineMs }) {
  if (!verifyQuoteSignature(kaspa, quote)) throw new Error('报价验签失败');
  const network = quote.network; if (!network) throw new Error('报价缺 network');
  if (quote.require_channel_deposit) throw new Error('该报价要求渠道押金, 发票模式不支持');
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= 0) throw new Error('链接缺少有效的截止时间');
  const contractNonceHex = await deriveOrderNonce({ orderNonceHex });   // orderNonceHex = 交付秘密; 合约 order_nonce 是其单向派生(redeem 随花费公开)
  const { refundPrivHex } = await deriveRefundKey({ orderNonceHex, network });
  const refundAddress = mailboxAddress(kaspa, refundPrivHex, network);
  const resolved = RB.resolveRulesForOrder(kaspa, feeSplitLib, quote, { ok: true, channelSpks: [] });
  const finalRoles = resolved.payoutLeaves.map((r) => ({ amountSompi: r.amountSompi, spk: r.spk }));
  const order = RB.rebuildCommissionOrderAddress(kaspa, { network, finalRoles, payerRefundAddress: refundAddress, maxSplitFeeSompi: BigInt(quote.max_split_fee_sompi), maxRefundFeeSompi: BigInt(quote.max_refund_fee_sompi), orderNonceHex: contractNonceHex, deadlineMs }, sourceSha256Hex);
  const { mailboxPrivHex } = await deriveMailboxKey({ orderNonceHex, orderAddress: order.address });
  const refundSpkScript = kaspa.payToAddressScript(new kaspa.Address(refundAddress));
  const refundSpk = new Uint8Array(2 + refundSpkScript.script.length / 2);
  refundSpk[0] = Number(refundSpkScript.version) & 0xff; refundSpk[1] = (Number(refundSpkScript.version) >> 8) & 0xff;
  for (let i = 0; i < refundSpk.length - 2; i++) refundSpk[2 + i] = parseInt(refundSpkScript.script.substr(i * 2, 2), 16);
  const redeemScriptHex = typeof order.redeemScript === 'string' ? order.redeemScript : hexOf(order.redeemScript);
  return {
    network, orderAddress: order.address, redeemScriptHex, refundAddress, refundPrivHex, mailboxAddress: mailboxAddress(kaspa, mailboxPrivHex, network), mailboxPrivHex,
    totalSompi: resolved.payoutLeaves.reduce((a, r) => a + r.amountSompi, 0n), deadlineMs,
    refundProtocol: { redeemScriptHex, entries: COMMISSION_ENTRIES, refundSpk, maxRefundFeeSompi: BigInt(quote.max_refund_fee_sompi), deadlineMs },
  };
}

/** 读信箱取货: reader.listAddressTxs(信箱地址) → pickDeliverable。请求只带信箱地址。 */
export async function checkDelivery({ reader, derived, orderNonceHex }) {
  const { txs, currentBlueScore } = await reader.listAddressTxs(derived.mailboxAddress);
  return pickDeliverable({ orderNonceHex, orderAddress: derived.orderAddress, txs, currentBlueScore });
}
/** 粘贴密文兜底(商家导出的 hex): 与读链取货同一个 decryptDeliverable(AEAD 校验)。失败 ⇒ null。 */
export async function decryptPasted({ derived, orderNonceHex, payloadHex }) {
  return decryptDeliverable({ orderNonceHex, orderAddress: derived.orderAddress, payloadHex: String(payloadHex || '').trim().toLowerCase() });
}

/** 订单资金状态(只读): 订单地址上的交易历史 → 是否已付款 / 是否已被花费(split 或退款)。请求只带订单地址。 */
export async function checkOrderFunds({ reader, derived }) {
  const { txs } = await reader.listAddressTxs(derived.orderAddress);
  const funding = txs.find((t) => t.outputs.some((o) => o.address === derived.orderAddress));
  if (!funding) return { funded: false, spent: false };
  const idx = funding.outputs.find((o) => o.address === derived.orderAddress).index;
  const spender = txs.find((t) => t.spentOutpoints.some((s) => s.txid === funding.txid && s.index === idx));
  return { funded: true, spent: !!spender, fundingTxid: funding.txid, spenderTxid: spender?.txid };
}

/**
 * 到期退款(零签名 refund, 任何人可触发; 钱退到由 nonce 派生的退款 P2PK, 随后用 sweepP2pk 清扫到买家自己的地址)。
 * rpc 需 getUtxosByAddresses / getBlockDagInfo / submitTransaction。PMT 必须现查节点(同 broadcast-commission 既有 MUST 纪律)。
 */
export async function triggerRefund({ kaspa, rpc, derived }) {
  const { entries } = await rpc.getUtxosByAddresses([derived.orderAddress]);
  if (!entries || entries.length !== 1) throw new Error(`订单地址上有 ${entries ? entries.length : 0} 笔 UTXO(期望恰 1)`);
  const e = entries[0];
  const pmt = Number((await rpc.getBlockDagInfo()).pastMedianTime);
  const built = buildCommissionRefundTx(kaspa, derived.refundProtocol, { transactionId: String(e.outpoint.transactionId), index: Number(e.outpoint.index), amountSompi: BigInt(e.amount) }, pmt);
  const r = await rpc.submitTransaction({ transaction: built.tx, allowOrphan: false });
  return { txId: r.transactionId };
}

/**
 * 清扫: 把某个派生私钥(信箱或退款)名下的全部 UTXO 签名转到买家填的地址。私钥只在本页内存, 不上传。
 * @returns {Promise<{status:'nothing'|'sent', txIds?:string[], count?:number}>}
 */
export async function sweepP2pk({ kaspa, rpc, network, privHex, toAddress }) {
  const priv = new kaspa.PrivateKey(privHex);
  const fromAddr = priv.toPublicKey().toAddress(network);
  const from = fromAddr.toString();
  if (!kaspa.Address.validate(toAddress)) throw new Error('目标地址非法');
  if (new kaspa.Address(toAddress).prefix !== fromAddr.prefix) throw new Error('目标地址与订单网络不符');
  const { entries } = await rpc.getUtxosByAddresses([from]);
  if (!entries || entries.length === 0) return { status: 'nothing' };
  const { transactions } = await kaspa.createTransactions({ entries, outputs: [], changeAddress: toAddress, priorityFee: 0n, networkId: network });
  const txIds = [];
  for (const p of transactions) { await p.sign([priv]); txIds.push(await p.submit(rpc)); }
  return { status: 'sent', txIds, count: entries.length };
}

/**
 * 页面流程(薄壳之外的全部逻辑)。deps: { location, history, kaspa, RB, feeSplitLib, sourceSha256Hex, makeReader(), now? }
 * 读发票(片段 + 查询串) → 抹片段 → 推导。返回 { derived, orderNonceHex(仅内存), quote, actions }。
 * 🔴 orderNonceHex 不进任何返回给 UI 的字符串字段(UI 只拿 derived.* 的地址与金额)。
 */
export async function startBuyerFlow({ location, history, kaspa, RB, feeSplitLib, sourceSha256Hex, makeReader }) {
  const inv = takeInvoiceFromLocation(location, history);
  if (!inv) throw new Error('链接里没有订单凭据(#n=…)——请用商家发给你的完整链接打开');
  const quote = readQuoteFromSearch(location.search);
  const derived = await deriveBuyerOrder({ kaspa, RB, feeSplitLib, sourceSha256Hex, quote, orderNonceHex: inv.nonce, deadlineMs: inv.deadlineMs });
  const reader = makeReader(derived.network);
  const nonce = inv.nonce;
  return {
    derived, quote,
    check: () => checkDelivery({ reader, derived, orderNonceHex: nonce }),
    funds: () => checkOrderFunds({ reader, derived }),
    paste: (payloadHex) => decryptPasted({ derived, orderNonceHex: nonce, payloadHex }),
    refund: (rpc) => triggerRefund({ kaspa, rpc, derived }),
    sweepMailbox: (rpc, toAddress) => sweepP2pk({ kaspa, rpc, network: derived.network, privHex: derived.mailboxPrivHex, toAddress }),
    sweepRefund: (rpc, toAddress) => sweepP2pk({ kaspa, rpc, network: derived.network, privHex: derived.refundPrivHex, toAddress }),
    credentialJson: () => JSON.stringify({ kind: 'kanet-delivery-credential', version: 1, link_without_fragment: location.pathname + location.search, n: nonce, dl: derived.deadlineMs, order_address: derived.orderAddress }),
  };
}
