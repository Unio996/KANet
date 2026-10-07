// delivery-split-adapter.mjs — 账本1877 步3: watcher 的 triggerSplit 真适配器。
//   console 不碰链: 重建订单协议 → 构造零签名 split tx(复用 commission-plan-sdk.buildCommissionSplitTx, 与结账页同一套) → 经 relay 窄命令 delivery_split_submit 广播。
//   🔴 fail-closed: 重建出的订单地址必须 == 库里登记的订单地址, 否则不广播(防报价/nonce/deadline 与建单时不一致 ⇒ 构造出不属于该订单的 tx)。
//   报价有效期不管已存在订单(skipValidity); 只在建单路径校验有效期。
import * as SDK from './commission-plan-sdk.mjs';
import { deriveInvoiceOrder } from './delivery-invoice.mjs';
import * as S from './delivery-store.mjs';

/**
 * @param {{db:object, relayCall:(cmd:object)=>Promise<object>}} deps  relayCall = 发给 relay 的命令(origin 由调用方在 sendCommandAsync 里带)
 * @returns {(order:object, utxo:{txid:string,index:number,amountSompi:string})=>Promise<{txid:string}>}
 */
export function makeTriggerSplit({ db, relayCall }) {
  return async function triggerSplit(order, utxo) {
    const quoteJson = S.getQuoteJson(db, order.id);
    if (!quoteJson) throw new Error('triggerSplit: 订单没有 quote_json(非发票模式订单, 不能自动 split)');
    const nonceHex = S.unsealNonceForDelivery(db, order.id);
    const d = await deriveInvoiceOrder({ quote: JSON.parse(quoteJson), orderNonceHex: nonceHex, deadlineMs: Number(order.deadline_ms), expectNetwork: order.network, skipValidity: true });
    if (d.orderAddress !== order.order_address) throw new Error('triggerSplit: 重建的订单地址与库里登记的不一致 — 拒绝广播(fail-closed)');
    const built = SDK.buildCommissionSplitTx(d.protocol, { transactionId: utxo.txid, index: Number(utxo.index), amountSompi: BigInt(utxo.amountSompi) });
    // 不序列化整笔 tx(v1 tx 的 SafeJSON 需要 UTXO 条目, 且"调用方给整笔 tx"是更大的信任面): 只传组件, relay 本地自己构造并按订单 ctor 校验。
    const expectedTxid = String(built.tx.id);
    const inp = built.tx.inputs[0];
    const spkHex = (o) => { const v = Number(o.scriptPublicKey.version); return (v & 0xff).toString(16).padStart(2, '0') + ((v >> 8) & 0xff).toString(16).padStart(2, '0') + String(o.scriptPublicKey.script); };
    const r = await relayCall({ type: 'delivery_split_submit', input: { txid: String(inp.previousOutpoint.transactionId), index: Number(inp.previousOutpoint.index) }, sig_script_hex: String(inp.signatureScript), outputs: built.tx.outputs.map((o) => ({ value: String(o.value), spk_hex: spkHex(o) })), redeem_hex: d.protocol.redeemScriptHex, expected_txid: expectedTxid });
    if (!r || r.ok !== true || !r.txId) throw new Error(`triggerSplit: relay 拒绝/失败: ${String(r?.error || JSON.stringify(r)).slice(0, 160)}`);
    if (String(r.txId) !== expectedTxid) throw new Error('triggerSplit: relay 回的 txid ≠ 预期');
    return { txid: r.txId };
  };
}
