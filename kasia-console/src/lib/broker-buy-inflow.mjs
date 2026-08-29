// broker-buy-inflow.mjs — BUY 单入金 sender 捕获 (J2 2026-08-29, race 盘点 §7.1, NWT SOUND / Bettor ② GO: 本批【只捕获不自动退】)
// 为什么只捕获: retail_dex_orders.pay_address 对 buy_kas 是 broker 自己的 BSC 收款地址, 用户 EVM 地址此前没存; 唯一链上事实 = 入金 tx 的 from。
//   但 from 可能是合约/交易所热钱包 (退回去用户拿不到) ⇒ 自动退须先 EOA 判定 + 用户确认 DM (用户面 = Owner 域), 都不在本批 ⇒ 本批把 from 记进
//   broker_workflow_markers (不加列不动 migrate), BUY fallback 永久失败时把它作 refund_candidate_from 写进 broker_buy_fallback_refunded payload, 供人工 SOP 与下批自动退。
// 写点: broker-bsc-intake-watcher.tick 匹配到入金 ⇒ 【先】recordBuyInflow 再 _publishBrokerBuyOffer (publish 抛也不丢 sender)。
export const BUY_INFLOW_MARKER = 'broker_buy_inflow';

export function recordBuyInflow(db, { txHash, from, amountUsdt, orderId, userKasia, chain = 'bnb', now = () => new Date().toISOString() }) {
  if (!db) throw new Error('recordBuyInflow: db 缺失');
  if (!txHash || !from) return { ok: false, reason: 'missing_tx_or_from' };
  const id = `buy_inflow_${String(txHash).slice(0, 16)}`;
  const r = db.prepare(`INSERT OR IGNORE INTO broker_workflow_markers (id, event_type, src_event_id, payload, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, BUY_INFLOW_MARKER, txHash, JSON.stringify({ from: String(from).toLowerCase(), amount_usdt: amountUsdt, order_id: orderId, user_kasia: userKasia, chain }), now());
  return { ok: true, inserted: r.changes === 1, id };
}

/** 找该用户最近一笔匹配金额 (±tol) 的入金 sender; 无 ⇒ null (调用方保持 manual) */
export function findBuyInflowSender(db, { userKasia, amountUsdt, tolPct = 0.02 }) {
  if (!db || !userKasia) return null;
  const rows = db.prepare(`SELECT src_event_id, payload, created_at FROM broker_workflow_markers WHERE event_type = ? AND payload LIKE ? ORDER BY created_at DESC LIMIT 20`)
    .all(BUY_INFLOW_MARKER, `%"user_kasia":"${userKasia}"%`);
  for (const r of rows) {
    let p; try { p = JSON.parse(r.payload || '{}'); } catch { continue; }
    if (!p.from) continue;
    if (amountUsdt != null && p.amount_usdt != null) { const a = Number(p.amount_usdt), want = Number(amountUsdt); if (want > 0 && Math.abs(a - want) / want > tolPct) continue; }
    return { from: p.from, txHash: r.src_event_id, amountUsdt: p.amount_usdt, chain: p.chain || 'bnb', at: r.created_at };
  }
  return null;
}
