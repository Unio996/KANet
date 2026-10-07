// delivery-watcher.mjs — 账本1877 步2: 数字商品「付款后交付」卖家侧状态推进(设计 v0.1 §3–§5 + v0.2 + Bettor 裁定②)。
//   纯逻辑 + 全部副作用经 ctx 注入(读链/读 UTXO/广播 split/发信箱/落链核对/时钟), 同 broker-buy-completion-watcher 的形态(tick + 幂等 + 注入式发送)。
//   ⚠ 本文件【不自带定时器、不接 index.js】: 真实 ctx 适配器(CommissionSplit 的 split 广播、api.kaspa.org 读后端、relay 信箱命令)与启用开关属步 3, 未接线前零运行时影响。
//
// 状态机(delivery-store.mjs ALLOWED 集中声明迁移合法性):
//   watching ─(订单 UTXO 在, 金额≥应付, 资金交易深度≥20)→ paid ─(广播 split, 其落链深度≥20 且输出吻合)→ split_done
//   watching ─(买家抢先 split: 订单 UTXO 已被花)→ 三条同时满足才 split_done, 任一不满足 → manual_review(裁定②)
//   split_done ─(分配库存 + 加密 + 发信箱)→ mailbox_sent ─(信箱交易落链深度≥20)→ delivered
//   任意异常/无库存/重试超限 → manual_review(原因落库); 到期未付 → expired。
// 🔴 铁律对应: ① 交付绝不早于 split_done(退款路径已永久关闭)。② delivered 仅在信箱交易落链确认后写(NO TX NO STATE CHANGE)。③ nonce/明文交付物不进日志(日志只打订单末 8 位 + 状态)。
import { encryptDeliverable, MAX_PLAINTEXT_BYTES } from './checkout-static/delivery-crypto.js';
import { deriveMailboxKey } from './checkout-static/delivery-crypto.js';
import * as S from './delivery-store.mjs';

export const MIN_DEPTH = 20;                              // = monitor.js REORG_SAFE_MIN_DEPTH
export const SPLIT_SAFETY_MS = 10 * 60 * 1000;           // 距 deadline 不足此值不自动 split(留给退款路径, 转人工)
export const MAX_SPLIT_ATTEMPTS = 5;
export const MAX_MAILBOX_ATTEMPTS = 3;
export const SPLIT_RETRY_AFTER_MS = 5 * 60 * 1000;       // 已广播 split 后, 这么久还没落链才允许再试
export const MAILBOX_RESEND_AFTER_MS = 15 * 60 * 1000;   // 信箱交易这么久没落链才重发
export const MAILBOX_AMOUNT_KAS = '0.2';                // = KASIA_MIN_AMOUNT 先例; relay 下限 simnet 实测 0.15(0.14 报 Storage mass exceeds maximum, 见 delivery-mailbox.mjs), 留余量

const tag = (o) => String(o.id).slice(-8);
const sqliteMs = (s) => Date.parse(String(s).replace(' ', 'T') + 'Z');
const depthOf = (tx, cur) => (tx && tx.isAccepted && Number.isFinite(tx.acceptingBlueScore) && Number.isFinite(cur)) ? cur - tx.acceptingBlueScore : -1;

/**
 * @typedef {object} Ctx
 * @property {(address:string)=>Promise<{txs:Array<{txid:string,isAccepted:boolean,acceptingBlueScore:number,blockTimeMs:number,outputs:Array<{index:number,valueSompi:string,address:string}>,spentOutpoints:Array<{txid:string,index:number}>}>,currentBlueScore:number}>} readHistory
 * @property {(address:string)=>Promise<Array<{txid:string,index:number,amountSompi:string}>>} getUtxos
 * @property {(order:object, utxo:object)=>Promise<{txid:string}>} triggerSplit
 * @property {(a:{target:string,amountKas:string,payloadHex:string})=>Promise<{txid:string}>} sendMailbox
 * @property {(privHex:string, network:string)=>string} mailboxAddress
 * @property {(address:string, txid:string)=>Promise<boolean>} mailboxLanded  深度 ≥ MIN_DEPTH
 * @property {()=>number} nowMs
 * @property {(msg:string)=>void} [log]
 */

function manual(db, order, reason, ctx) {
  S.transition(db, order.id, 'manual_review', { manual_reason: String(reason).slice(0, 300) });
  (ctx.log || console.log)(`[delivery] order=${tag(order)} → manual_review: ${String(reason).slice(0, 120)}`);
  return 'manual_review';
}

/** 订单地址上"花费了该资金输出"的交易(买家抢先 split / 退款 / 我们自己的 split 都走这里判定)。 */
function findSpender(txs, fundTxid, fundIndex) {
  return txs.find((t) => (t.spentOutpoints || []).some((o) => o.txid === fundTxid && Number(o.index) === Number(fundIndex)));
}
/** 花费交易是否是"给商家的输出金额精确吻合"的 split。 */
const paysMerchantExactly = (tx, order) => (tx.outputs || []).some((o) => o.address === order.merchant_address && String(o.valueSompi) === String(order.merchant_amount_sompi));

async function stepWatching(db, order, ctx) {
  const { txs, currentBlueScore } = await ctx.readHistory(order.order_address);
  const utxos = await ctx.getUtxos(order.order_address);
  const funding = txs.find((t) => (t.outputs || []).some((o) => o.address === order.order_address && BigInt(o.valueSompi) >= BigInt(order.total_sompi)));
  const fundOut = funding && funding.outputs.find((o) => o.address === order.order_address && BigInt(o.valueSompi) >= BigInt(order.total_sompi));

  if (utxos.length === 0) {
    if (!funding) return ctx.nowMs() > order.deadline_ms ? (S.transition(db, order.id, 'expired', { manual_reason: '到期未付款' }), 'expired') : 'watching';
    // 订单 UTXO 已不在 ⇒ 被花了: 谁花的? —— 裁定②: 到期前落链 + 给商家的输出金额精确吻合 + 深度≥20, 三条同时满足才自动继续。
    const spender = findSpender(txs, funding.txid, fundOut.index);
    if (!spender) return manual(db, order, '订单 UTXO 已不在但读后端未给出花费交易(读后端缺口/重组), 转人工核链', ctx);
    if (!spender.isAccepted) return 'watching';                               // 还没被接受: 等
    if (Number(spender.blockTimeMs) >= order.deadline_ms) { S.transition(db, order.id, 'expired', { manual_reason: '到期后被花费(退款), 不交付', pay_txid: funding.txid }); return 'expired'; }
    if (!paysMerchantExactly(spender, order)) return manual(db, order, `花费交易 ${spender.txid.slice(0, 12)} 未给商家精确金额(非本订单 split), 不自动交付`, ctx);
    if (depthOf(spender, currentBlueScore) < MIN_DEPTH) return 'watching';    // 深度未够: 等
    S.transition(db, order.id, 'split_done', { pay_txid: funding.txid, split_txid: spender.txid });
    return 'split_done';
  }
  const u = utxos.find((x) => BigInt(x.amountSompi) >= BigInt(order.total_sompi));
  if (!u) return 'watching';                                                  // 少付: 不交付, 不推进(沿用 monitor.js 的"不足"语义)
  const fundTx = txs.find((t) => t.txid === u.txid);
  if (depthOf(fundTx, currentBlueScore) < MIN_DEPTH) return 'watching';
  S.transition(db, order.id, 'paid', { pay_txid: u.txid });
  return 'paid';
}

async function stepPaid(db, order, ctx) {
  const { txs, currentBlueScore } = await ctx.readHistory(order.order_address);
  const utxos = await ctx.getUtxos(order.order_address);
  if (utxos.length === 0) {                                                   // 订单 UTXO 没了: 自己的 split 或抢先者
    const fundTxid = order.pay_txid;
    const funding = txs.find((t) => t.txid === fundTxid);
    const fo = funding && funding.outputs.find((o) => o.address === order.order_address);
    const spender = fo && findSpender(txs, fundTxid, fo.index);
    if (!spender || !spender.isAccepted) return 'paid';
    if (Number(spender.blockTimeMs) >= order.deadline_ms) { S.transition(db, order.id, 'expired', { manual_reason: '到期后被花费(退款), 不交付' }); return 'expired'; }
    if (!paysMerchantExactly(spender, order)) return manual(db, order, `花费交易 ${spender.txid.slice(0, 12)} 未给商家精确金额, 不自动交付`, ctx);
    if (depthOf(spender, currentBlueScore) < MIN_DEPTH) return 'paid';
    S.transition(db, order.id, 'split_done', { split_txid: spender.txid });
    return 'split_done';
  }
  if (ctx.nowMs() > order.deadline_ms - SPLIT_SAFETY_MS) return manual(db, order, '已付款但距到期不足安全窗口, 不自动 split(留给退款路径)', ctx);
  if (order.split_txid && ctx.nowMs() - sqliteMs(order.updated_at) < SPLIT_RETRY_AFTER_MS) return 'paid';   // 刚广播过, 等它落链
  if (order.split_attempts >= MAX_SPLIT_ATTEMPTS) return manual(db, order, `split 广播 ${order.split_attempts} 次仍未落链`, ctx);
  try {
    const { txid } = await ctx.triggerSplit(order, utxos[0]);
    S.recordSplitBroadcast(db, order.id, txid);
    (ctx.log || console.log)(`[delivery] order=${tag(order)} split 已广播 tx=${String(txid).slice(0, 12)}`);
  } catch (e) {
    S.bumpCounter(db, order.id, 'split_attempts');
    (ctx.log || console.log)(`[delivery] order=${tag(order)} split 广播失败(下个 tick 重试): ${String(e.message).slice(0, 100)}`);
  }
  return 'paid';
}

async function stepSplitDone(db, order, ctx) {
  const stock = S.assignStock(db, order.id);                                   // 幂等: 已分配 ⇒ 同一项
  if (!stock) return manual(db, order, `库存不足(sku=${order.sku_id})`, ctx);
  const plaintext = S.readStockPlaintext(db, stock.stockId);
  if (Buffer.byteLength(plaintext) > MAX_PLAINTEXT_BYTES) return manual(db, order, '交付物超过 1024B 上限', ctx);
  const nonceHex = S.unsealNonceForDelivery(db, order.id);
  const { mailboxPrivHex } = await deriveMailboxKey({ orderNonceHex: nonceHex, orderAddress: order.order_address });
  const mailbox = ctx.mailboxAddress(mailboxPrivHex, order.network);
  const payloadHex = await encryptDeliverable({ orderNonceHex: nonceHex, orderAddress: order.order_address, plaintext });
  try {
    const { txid } = await ctx.sendMailbox({ target: mailbox, amountKas: MAILBOX_AMOUNT_KAS, payloadHex });
    S.transition(db, order.id, 'mailbox_sent', { mailbox_address: mailbox, mailbox_txid: txid, mailbox_payload_hex: payloadHex, mailbox_sent_at: new Date(ctx.nowMs()).toISOString().replace('T', ' ').slice(0, 19) });
    (ctx.log || console.log)(`[delivery] order=${tag(order)} 信箱交易已发 tx=${String(txid).slice(0, 12)}`);
    return 'mailbox_sent';
  } catch (e) {
    S.bumpCounter(db, order.id, 'mailbox_attempts');
    const n = S.getOrderPublic(db, order.id).mailbox_attempts;
    (ctx.log || console.log)(`[delivery] order=${tag(order)} 信箱发送失败(${n}/${MAX_MAILBOX_ATTEMPTS}): ${String(e.message).slice(0, 100)}`);
    if (n >= MAX_MAILBOX_ATTEMPTS) return manual(db, order, `信箱发送失败 ${n} 次`, ctx);
    return 'split_done';
  }
}

async function stepMailboxSent(db, order, ctx) {
  if (await ctx.mailboxLanded(order.mailbox_address, order.mailbox_txid)) {
    S.transition(db, order.id, 'delivered', { delivered_at: new Date(ctx.nowMs()).toISOString().replace('T', ' ').slice(0, 19) });
    (ctx.log || console.log)(`[delivery] order=${tag(order)} delivered`);
    return 'delivered';
  }
  if (ctx.nowMs() - sqliteMs(order.mailbox_sent_at) < MAILBOX_RESEND_AFTER_MS) return 'mailbox_sent';
  if (order.mailbox_attempts + 1 >= MAX_MAILBOX_ATTEMPTS) return manual(db, order, '信箱交易长时间未落链且重发次数用尽', ctx);
  try {
    const { txid } = await ctx.sendMailbox({ target: order.mailbox_address, amountKas: MAILBOX_AMOUNT_KAS, payloadHex: order.mailbox_payload_hex });   // 同一密文, 新交易
    S.recordMailboxResend(db, order.id, txid);
  } catch (e) { S.bumpCounter(db, order.id, 'mailbox_attempts'); (ctx.log || console.log)(`[delivery] order=${tag(order)} 信箱重发失败: ${String(e.message).slice(0, 100)}`); }
  return 'mailbox_sent';
}

const STEPS = { watching: stepWatching, paid: stepPaid, split_done: stepSplitDone, mailbox_sent: stepMailboxSent };

/** 推进一个订单一步。返回推进后的状态名。永不抛: 任何异常 ⇒ 记日志、保持原状态(下个 tick 再试), 不吞成"已交付"。 */
export async function tickOrder(db, order, ctx) {
  const step = STEPS[order.state];
  if (!step) return order.state;
  try { return await step(db, order, ctx); }
  catch (e) { (ctx.log || console.log)(`[delivery] order=${tag(order)} state=${order.state} tick 异常(保持原状态): ${String(e.message).slice(0, 120)}`); return order.state; }
}

/** 一轮 tick: 逐单推进(串行, 避免并发抢 relay 钱包 UTXO)。返回 {processed, byState}。 */
export async function deliveryTick(db, ctx) {
  const orders = S.listOrdersByState(db, ['watching', 'paid', 'split_done', 'mailbox_sent']);
  const byState = {};
  for (const o of orders) { const s = await tickOrder(db, o, ctx); byState[s] = (byState[s] || 0) + 1; }
  return { processed: orders.length, byState };
}
