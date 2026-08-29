// broker-fallback-intent.mjs — T2.5c CEX 兜底的 write-ahead 意图 (J2 2026-08-29, race 盘点 P2)
// 病 (afc63057, 修 12fcc48b 只修了一半): claim `broker_fallback_claim` 在 placeCexOrder【成功后】写 ⇒ `await placeCexOrder` 期间 Z20 看不到任何痕迹;
//   若 tick 叠跑 (无重入闸) 或将来拆成独立 timer, Z20 会在 CEX 卖出在飞时退款 = 双出口。
// 修: placeCexOrder【之前】先落 `broker_fallback_intent` (txid = cancel_tx, 已是 64-hex 真链 txid, 过 v83 trigger), Z20 与 fallback 自身的 NOT EXISTS 都看 intent∪claim。
//   结局三态:
//     claimed           — CEX 单确定成功: 写 claim (原逻辑), intent 留着 (历史痕迹, 不删)
//     failed_definitive — CEX 明确回 ok:false (有 error 文本、无 orderId): 删 intent (只删【无 cex_order_id】的 intent 行), 允许原 permanent/transient 路继续
//     ambiguous         — placeCexOrder 抛 (超时/网络): intent 留 + payload 标 ambiguous + events 告警 ⇒ Z20 继续 skip 该 offer (fail-closed: 宁可卡住进人工 SOP, 不双出口)
// 只依赖 chain_events (recordChainEvent) 与 events 表; 不发链、不动状态机。
import { randomUUID } from 'node:crypto';

export const FALLBACK_INTENT_EVENT = 'broker_fallback_intent';
export const FALLBACK_CLAIM_EVENT = 'broker_fallback_claim';

export function writeFallbackIntent({ db, recordChainEvent, offerId, cancelTx, qty, midPrice, now = () => new Date().toISOString() }) {
  if (!db || !recordChainEvent) throw new Error('writeFallbackIntent: db/recordChainEvent 缺失');
  if (!offerId || !cancelTx) throw new Error('writeFallbackIntent: offerId/cancelTx 缺失 (intent 必须绑真链 cancel_tx)');
  const before = db.prepare(`SELECT count(*) AS n FROM chain_events WHERE txid = ? AND event_type = ?`).get(cancelTx, FALLBACK_INTENT_EVENT).n;
  recordChainEvent({ txid: cancelTx, eventType: FALLBACK_INTENT_EVENT, fromAddress: null, toAddress: null, observedBy: 'system',
    payload: { offer_id: offerId, cancel_tx: cancelTx, qty, mid_price: midPrice, intent_at: now() } });
  const after = db.prepare(`SELECT id FROM chain_events WHERE txid = ? AND event_type = ?`).get(cancelTx, FALLBACK_INTENT_EVENT);
  // 🔴 write-ahead 的前提是"写成功"——recordChainEvent 吞错只打日志, 所以这里回读核实; 没落库 = 不许继续下 CEX 单
  if (!after) throw new Error(`writeFallbackIntent: intent 未落库 (offer=${offerId.slice(0, 8)} cancel_tx=${String(cancelTx).slice(0, 12)}), 拒绝继续 placeCexOrder`);
  return { intentId: after.id, existedBefore: before > 0 };
}

export function resolveFallbackIntent({ db, recordChainEvent, offerId, cancelTx, outcome, cexOrderId = null, error = null, qty = null, midPrice = null, now = () => new Date().toISOString() }) {
  if (!['claimed', 'failed_definitive', 'ambiguous'].includes(outcome)) throw new Error(`resolveFallbackIntent: outcome 非法 ${String(outcome)}`);
  if (outcome === 'claimed') {
    recordChainEvent({ txid: cancelTx, eventType: FALLBACK_CLAIM_EVENT, fromAddress: null, toAddress: null, observedBy: 'system',
      payload: { offer_id: offerId, cex_order_id: cexOrderId, cancel_tx: cancelTx, qty, mid_price: midPrice } });
    return { kept: true, claimed: true };
  }
  if (outcome === 'failed_definitive') {
    // 只删无 cex_order_id 的 intent 行 (有 orderId = 曾经成功过, 绝不删)
    const r = db.prepare(`DELETE FROM chain_events WHERE txid = ? AND event_type = ? AND (payload IS NULL OR payload NOT LIKE '%"cex_order_id":"%')`).run(cancelTx, FALLBACK_INTENT_EVENT);
    return { kept: r.changes === 0, deleted: r.changes };
  }
  // ambiguous: 留 intent, 标注, 告警 (fail-closed)
  db.prepare(`UPDATE chain_events SET payload = json_set(COALESCE(payload, '{}'), '$.ambiguous', 1, '$.ambiguous_error', ?, '$.ambiguous_at', ?) WHERE txid = ? AND event_type = ?`)
    .run(String(error || 'unknown').slice(0, 200), now(), cancelTx, FALLBACK_INTENT_EVENT);
  try {
    db.prepare(`INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at) VALUES (?, 'system', 'broker_fallback_ambiguous', 'broker-intake-watcher', 'warn', ?, ?, ?)`)
      .run(randomUUID(), `🔴 T2.5c CEX 下单结果不明 offer=${offerId.slice(0, 8)}: intent 保留 ⇒ Z20 继续 skip; 人工核 CEX 后按 SOP 解 (${String(error || '').slice(0, 80)})`, JSON.stringify({ offer_id: offerId, cancel_tx: cancelTx, error: String(error || '').slice(0, 200) }), now());
  } catch {}
  return { kept: true, ambiguous: true };
}

/** Z20 / fallback 扫描共用的排除片段 (字符串拼进 SQL; 调用方保证 alias 指向 exchange_offers 行) */
export const FALLBACK_INTENT_OR_CLAIM_NOT_EXISTS = `AND NOT EXISTS (
      SELECT 1 FROM chain_events ce2
      WHERE ce2.event_type IN ('broker_fallback_claim', 'broker_fallback_intent')
      AND ce2.payload LIKE '%"offer_id":"' || exchange_offers.id || '"%'
    )`;
