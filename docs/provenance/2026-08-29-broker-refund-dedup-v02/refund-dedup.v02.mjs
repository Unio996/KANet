// refund-dedup.v02.mjs — broker 退款重发守卫候选 v0.2（J2 2026-08-29; NWT L2 审注 (a) 收口; T4#1 CONFIRMED 真险有先例 87.9 KAS）
// 落地位置候选: kasia-console/src/services/broker-refund-dedup.js 的替换核心 (isOfferAlreadyRefunded 改三/四态)
//
// 原则 (NWT): "intent 已记 ≠ 该再发"; 重退比等确认坏 ⇒ 任何已记录的退款意图/txid 都拦重发, 【不 require kaspa_tx_log 确认】;
//            absence 只在 coverage 覆盖且链读无果时才算"未退", 否则 UNKNOWN ⇒ 不发 + 告警。
//
// 证据来源 (按强弱):
//   S1 chain_events 'broker_kas_refunded' payload.offer_id/order_id (v83 trigger 保证 txid 64-hex 真 hash)  —— Phase 3 写
//   S2 broker_refund_intents (本候选新增账, 期望 v199+): Phase 1 CAS 时插 (txid NULL), enqueueVerified 一 resolve 就 UPDATE txid  —— write-ahead
//   S3 kaspa_tx_log 真链行 (to_address=user, amount≈, block_time>since) —— 只作【肯定】证据(有=已退), 不作否定证据
//   S4 注入 rpcCheckLanded(txid) / rpcUtxoLookup(userAddr) —— 肯定证据 / 否定断言的必需前置
//   coverage: 注入 indexerCoverage() (L2 v199 账) —— 否定断言 (NOT_REFUNDED) 的必需前置
export const REFUND = Object.freeze({
  REFUNDED_CONFIRMED: 'REFUNDED_CONFIRMED',   // S1 或 S3 或 S4 landed 命中 ⇒ 已退 (回填 DB 即可)
  REFUNDED_INTENT: 'REFUNDED_INTENT',         // S2 有 txid 但未见落链 ⇒ 已发过, 【不重发】; 去核落地
  INFLIGHT: 'INFLIGHT',                       // S2 intent 无 txid 且未过期 ⇒ 正在发/歧义 ⇒ 不重发
  NOT_REFUNDED: 'NOT_REFUNDED',               // 无任何 intent ∧ coverage 覆盖 ∧ RPC 成功无 UTXO 匹配 ⇒ 可发
  UNKNOWN: 'UNKNOWN',                         // 其余 ⇒ 不发 + 告警
});
export const INTENT_INFLIGHT_MS = 30 * 60 * 1000;   // intent 无 txid 超 30 min = 歧义(可能已广播回执丢) ⇒ 仍不重发, 升人工

export function classifyRefundState({ db, offerId, orderId, userAddr, amountKas, sinceIso, nowMs = Date.now(), rpcUtxoLookup = null, indexerCoverage = null, network = 'testnet-12' }) {
  const ev = {};
  const q = Number(amountKas);
  if (!userAddr || !Number.isFinite(q) || q <= 0) return { state: REFUND.UNKNOWN, reason: 'bad_args', evidence: ev };
  // S1: chain_events 意图/结果 (不 join kaspa_tx_log — 这是 v0.1 fail-open 的根)
  let ce = null;
  try {
    ce = db.prepare(`SELECT txid, observed_at FROM chain_events WHERE event_type = 'broker_kas_refunded' AND (payload LIKE '%"offer_id":"' || ? || '"%' OR payload LIKE '%"order_id":"' || ? || '"%') ORDER BY observed_at DESC LIMIT 1`).get(String(offerId || ''), String(orderId || ''));
  } catch (e) { return { state: REFUND.UNKNOWN, reason: `chain_events_query_fail:${e.message}`, evidence: ev }; }
  ev.chain_event = ce || null;
  if (ce?.txid) return { state: REFUND.REFUNDED_CONFIRMED, reason: 'chain_events_broker_kas_refunded', evidence: ev };
  // S2: write-ahead intents (表可能尚未迁移 ⇒ 视为无账, 但记 evidence)
  let intent = null;
  try {
    intent = db.prepare(`SELECT id, txid, created_at, updated_at FROM broker_refund_intents WHERE (order_id = ? OR offer_id = ?) ORDER BY created_at DESC LIMIT 1`).get(String(orderId || ''), String(offerId || ''));
    ev.intent = intent || null;
  } catch (e) { ev.intent_table = `unavailable:${e.message.slice(0, 40)}`; }
  if (intent?.txid) return { state: REFUND.REFUNDED_INTENT, reason: 'intent_has_txid_unconfirmed', evidence: ev };
  if (intent && !intent.txid) {
    const age = nowMs - Date.parse(intent.created_at);
    ev.intent_age_ms = age;
    return { state: age <= INTENT_INFLIGHT_MS ? REFUND.INFLIGHT : REFUND.UNKNOWN, reason: age <= INTENT_INFLIGHT_MS ? 'intent_inflight' : 'intent_stale_ambiguous', evidence: ev };
  }
  // S3: 真链行 (肯定证据)
  let rows = [];
  try {
    const sinceUnix = sinceIso ? Math.floor(Date.parse(sinceIso) / 1000) : 0;
    rows = db.prepare(`SELECT tx_id, block_time, amount FROM kaspa_tx_log WHERE to_address = ? AND amount BETWEEN ? AND ? AND block_time > ? ORDER BY block_time ASC`).all(userAddr, q - 0.01, q + 0.01, sinceUnix);
  } catch (e) { return { state: REFUND.UNKNOWN, reason: `kaspa_tx_log_query_fail:${e.message}`, evidence: ev }; }
  ev.kaspa_tx_log_rows = rows.length;
  if (rows.length > 0) return { state: REFUND.REFUNDED_CONFIRMED, reason: 'kaspa_tx_log_match', evidence: ev, txid: rows[0].tx_id };
  // 否定断言前置: RPC + coverage 都必需
  if (typeof rpcUtxoLookup !== 'function') return { state: REFUND.UNKNOWN, reason: 'rpc_lookup_unavailable', evidence: ev };
  let utxos;
  try { utxos = rpcUtxoLookup(userAddr); } catch (e) { return { state: REFUND.UNKNOWN, reason: `rpc_lookup_fail:${e.message}`, evidence: ev }; }
  if (!Array.isArray(utxos)) return { state: REFUND.UNKNOWN, reason: 'rpc_lookup_degraded', evidence: ev };
  ev.rpc_utxos = utxos.length;
  if (utxos.some((u) => Math.abs(Number(u?.amountKas) - q) <= 0.01)) return { state: REFUND.REFUNDED_CONFIRMED, reason: 'rpc_utxo_match', evidence: ev };
  if (typeof indexerCoverage !== 'function') return { state: REFUND.UNKNOWN, reason: 'coverage_ledger_unavailable', evidence: ev };
  let cov;
  try { cov = indexerCoverage({ network, address: userAddr, fromIso: sinceIso, toIso: new Date(nowMs).toISOString() }); } catch (e) { return { state: REFUND.UNKNOWN, reason: `coverage_query_fail:${e.message}`, evidence: ev }; }
  ev.coverage = cov;
  if (!cov || cov.covered !== true || (Array.isArray(cov.holes) && cov.holes.length > 0)) return { state: REFUND.UNKNOWN, reason: 'coverage_holes', evidence: ev };
  return { state: REFUND.NOT_REFUNDED, reason: 'no_intent+coverage_attested_absence+rpc_no_match', evidence: ev };
}

/** advanceToRefunded 的动作映射: 只有 NOT_REFUNDED 才 sendKas */
export function decideRefundAction(state) {
  switch (state) {
    case REFUND.NOT_REFUNDED: return { action: 'send' };
    case REFUND.REFUNDED_CONFIRMED: return { action: 'backfill_refunded' };
    case REFUND.REFUNDED_INTENT: return { action: 'verify_landing_then_backfill', note: '不重发; relay check_utxo_landed(txid) 核落地; 未落地超窗 ⇒ held_for_review' };
    case REFUND.INFLIGHT: return { action: 'wait' };
    default: return { action: 'hold_and_alert', event_type: 'broker_refund_unknown' };
  }
}

/** 队列层规则 (enqueueVerified): tx-producing kind 的失败分两类; 歧义类【不得】重试 sendKas */
export function classifyQueueFailure(errText) {
  const s = String(errText || '');
  if (/timeout|timed out|ETIMEDOUT|socket hang up|relay returned empty result|no txId from sendCommandAsync/i.test(s)) return { kind: 'ambiguous', retry: false, reason: 'may_have_broadcast' };
  if (/insufficient|not enough|dust|invalid address|rejected transaction|is not standard|already spent|missing outpoint/i.test(s)) return { kind: 'definite_fail', retry: true, reason: 'not_broadcast' };
  return { kind: 'ambiguous', retry: false, reason: 'unclassified_treated_as_ambiguous' };
}
