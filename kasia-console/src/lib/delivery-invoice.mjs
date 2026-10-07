// delivery-invoice.mjs — 账本1877 步3(Bettor 账本1879 裁定): 发票模式下的订单推导。
//   发票模式 = 运营者在本机建单, 订单的 payer_refund_spk 取【由 nonce 派生的 P2PK】(delivery-crypto.deriveRefundKey), 因此商家建单时订单地址就能完全算出, 不需要买家回话;
//   买家凭凭据(nonce)能推出同一退款私钥 ⇒ 退款不会落到交易所充值地址, 买家用清扫工具取回。CommissionSplit 合约的 refund_spk 是通用 byte[37] 槽位(任意 spk), 不改合约。
//   复用: commission-plan-sdk.mjs 的 verifyQuoteSignature / resolveRulesForOrder / createCommissionSplitProtocol(同一份编译路径, 与结账页逐字节 parity);
//   buyer 页用 resolve-order-browser.js 的 rebuildCommissionOrderAddress(固定偏移覆写)推导同一地址——两条路径的 parity 由本模块测试对拍。
import * as kaspa from 'kaspa-wasm';
import * as SDK from './commission-plan-sdk.mjs';
import { deriveRefundKey } from './checkout-static/delivery-crypto.js';

/** 报价 → 编码进发票链接 ?q= 的串(同 mint-quote 脚本与结账页解码的 base64(JSON))。 */
export const encodeQuoteParam = (quote) => Buffer.from(JSON.stringify(quote)).toString('base64');

/**
 * @param {{quote:object, orderNonceHex:string, deadlineMs:number, expectNetwork?:string}} o
 * @returns {Promise<{network:string, orderAddress:string, refundAddress:string, totalSompi:string, merchantAddress:string, merchantAmountSompi:string, protocol:object, finalRoles:object[]}>}
 */
export async function deriveInvoiceOrder({ quote, orderNonceHex, deadlineMs, expectNetwork }) {
  if (!quote || typeof quote !== 'object') throw new Error('deriveInvoiceOrder: quote 必填');
  if (quote.order_kind && quote.order_kind !== 'commission_split') throw new Error('deriveInvoiceOrder: 只支持 CommissionSplit 报价(order_kind)');
  if (!SDK.verifyQuoteSignature(quote)) throw new Error('deriveInvoiceOrder: 报价验签失败');
  const network = quote.network;
  if (!network || typeof network !== 'string') throw new Error('deriveInvoiceOrder: 报价缺 network');
  if (expectNetwork && network !== expectNetwork) throw new Error(`deriveInvoiceOrder: 报价网络 ${network} ≠ 本机网络 ${expectNetwork}`);
  const now = Date.now();
  if (Number.isFinite(quote.valid_from_ms) && now < quote.valid_from_ms) throw new Error('deriveInvoiceOrder: 报价尚未生效');
  if (Number.isFinite(quote.valid_until_ms) && now > quote.valid_until_ms) throw new Error('deriveInvoiceOrder: 报价已过期');
  if (quote.require_channel_deposit) throw new Error('deriveInvoiceOrder: 发票模式 V1 不支持要求渠道押金的报价');
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs <= now) throw new Error('deriveInvoiceOrder: deadlineMs 必须是未来的毫秒时间戳');
  const resolved = SDK.resolveRulesForOrder(quote, { ok: true, channelSpks: [] });   // 发票模式无渠道归因: 渠道位按报价规则并回 fold_to
  const finalRoles = resolved.payoutLeaves.map((r) => ({ name: r.name, amountSompi: r.amountSompi, spk: r.spk }));
  const provider = resolved.payoutLeaves[0];
  if (!provider || provider.name !== 'provider') throw new Error('deriveInvoiceOrder: 第一个收款角色必须是 provider');
  const { refundPrivHex } = await deriveRefundKey({ orderNonceHex, network });
  const refundAddress = new kaspa.PrivateKey(refundPrivHex).toPublicKey().toAddress(network).toString();
  const protocol = SDK.createCommissionSplitProtocol({
    network, finalRoles: finalRoles.map((r) => ({ amountSompi: r.amountSompi, spk: r.spk })), payerRefundAddress: refundAddress, deadlineMs,
    maxSplitFeeSompi: BigInt(quote.max_split_fee_sompi), maxRefundFeeSompi: BigInt(quote.max_refund_fee_sompi), orderNonceHex,
  });
  const totalSompi = resolved.payoutLeaves.reduce((a, r) => a + r.amountSompi, 0n);
  const providerRole = quote.canonical_rules.roles.find((r) => r.name === 'provider');
  return {
    network, orderAddress: protocol.address, refundAddress, totalSompi: String(totalSompi), merchantAddress: providerRole.address,
    merchantAmountSompi: String(provider.amountSompi), protocol, finalRoles,
  };
}
