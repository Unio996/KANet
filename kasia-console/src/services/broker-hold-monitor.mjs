// broker-hold-monitor.mjs — broker 钱路 hold 队列监控 (J2 2026-08-29, broker-money-path 阶段 3; NWT (c) + Bettor ③)
//
// 只读 · 60 min tick · 四个数 (KANet-UI 小时汇总接):
//   held           = retail_dex_orders.state = 'held_for_review' (选项 B; v200 前恒 0)
//   stuck_refunding = state = 'refunding' 且 updated_at 超 30 min (Phase 2/3 之间崩 / 歧义广播)
//   intent_stale   = broker_refund_intents 无 txid 且 created_at 超 30 min (歧义: 可能已广播回执丢)
//   coverage_lag   = spc_tip_heartbeat.daa_score − max(kaspa_tx_log_coverage.end_daa)  (NWT false-hole-sea: 账追不上 tip ⇒ 全 UNKNOWN ⇒ broker stall)
//                    无账/无心跳 ⇒ null (阶段 3 relay 推进未落前为 null, 不当 0)
// 阈值超 ⇒ events 一次性告警 (每小时最多一条/指标, 按 hour bucket 去重)。绝不改任何钱路状态。
// tick 函数具名 (brokerHoldMonitorTick) ⇒ L0 tick-registry 自动包装计同步前缀; 若 L0 未装, 也照常跑。
import { sqlite } from '../db/client.js';

export const HOLD_MONITOR_TICK_MS = 60 * 60 * 1000;
export const THRESHOLDS = Object.freeze({
  held: 1,                         // 任何 held 单都值得人看一眼
  stuck_refunding: 1,
  intent_stale: 1,
  coverage_lag_daa: 3600,          // ≈ 6 min @ 10 bps; 与 gate (d) N_claim 同量级 (调查稿 §4)
  unknown_1h: 3,                   // 一小时内 ≥3 单判 UNKNOWN = 不 rare (RPC/coverage/配置有系统性问题), 告警
  manual_refund_pending: 1,        // 任何一单 BUY fallback 待人工退款都值得人看 (它是用户的 USDT 卡在 broker 手里)
});
const STALE_MIN = 30;

/** 纯查询 (可离线测): 四个数 + 明细 id 列表 (各最多 20 条) */
export function computeHoldMetrics(db = sqlite, nowIso = new Date().toISOString()) {
  const q = (sql, ...args) => { try { return db.prepare(sql).all(...args); } catch (e) { return { error: e.message }; } };
  const held = q(`SELECT id, updated_at FROM retail_dex_orders WHERE state = 'held_for_review' ORDER BY updated_at ASC LIMIT 20`);
  // 🔴 时间比较一律 julianday(): 存储是 ISO 'T…Z' 形, datetime() 返回空格形, 字符串比较 'T' > ' ' 会全错 (memory reference-sqlite-iso-timestamp-string-compare-trap)
  const stuck = q(`SELECT id, updated_at FROM retail_dex_orders WHERE state = 'refunding' AND julianday(updated_at) < julianday(?, '-${STALE_MIN} minutes') ORDER BY updated_at ASC LIMIT 20`, nowIso);
  const intents = q(`SELECT id, order_id, offer_id, created_at FROM broker_refund_intents WHERE txid IS NULL AND julianday(created_at) < julianday(?, '-${STALE_MIN} minutes') ORDER BY created_at ASC LIMIT 20`, nowIso);
  let coverage_lag = null, tip = null, maxEnd = null;
  try {
    tip = db.prepare(`SELECT daa_score FROM spc_tip_heartbeat WHERE id = 1`).get()?.daa_score ?? null;
    maxEnd = db.prepare(`SELECT MAX(end_daa) AS m FROM kaspa_tx_log_coverage`).get()?.m ?? null;
    if (tip != null && maxEnd != null) coverage_lag = Number(tip) - Number(maxEnd);
  } catch { /* 表缺 ⇒ null */ }
  // 第五个数 (NWT 运营前置 (c): UNKNOWN 须 rare): 最近 60 min 内 refund/escrow 判 UNKNOWN 的告警条数 (events 表, 各去重后一单一条)
  const unknown = q(`SELECT event_type, count(*) AS n FROM events WHERE event_type IN ('refund_unknown_hold','broker_escrow_unknown') AND julianday(created_at) > julianday(?, '-60 minutes') GROUP BY event_type`, nowIso);
  const unknown_1h = Array.isArray(unknown) ? unknown.reduce((a, r) => a + Number(r.n || 0), 0) : null;
  // 第六个数 (batch-2 ①, Bettor 2026-08-29; race 盘点 DEFECT2 NWT P2): BUY fallback 永久失败后"待人工退款"的 offer 数 —— 唯一痕迹是
  // chain_events broker_buy_fallback_refunded{manual_refund_pending:true} (broker-intake-watcher.js:1023-1027), operator 侧此前无聚合无告警;
  // 解除 = 同 offer_id 出现 broker_buy_fallback_refund_resolved (人工退完/自动退款路落地后写)。held-for-review 必被监控原则。
  const manualPending = q(`SELECT json_extract(e.payload, '$.offer_id') AS offer_id, e.observed_at FROM chain_events e
    WHERE e.event_type = 'broker_buy_fallback_refunded' AND json_extract(e.payload, '$.manual_refund_pending') = 1
      AND NOT EXISTS (SELECT 1 FROM chain_events r WHERE r.event_type = 'broker_buy_fallback_refund_resolved' AND json_extract(r.payload, '$.offer_id') = json_extract(e.payload, '$.offer_id'))
    ORDER BY e.observed_at ASC LIMIT 20`);
  const count = (r) => (Array.isArray(r) ? r.length : null);
  return {
    at: nowIso,
    held: count(held), stuck_refunding: count(stuck), intent_stale: count(intents), coverage_lag_daa: coverage_lag, unknown_1h,
    manual_refund_pending: count(manualPending),
    detail: { held: Array.isArray(held) ? held : [], stuck_refunding: Array.isArray(stuck) ? stuck : [], intent_stale: Array.isArray(intents) ? intents : [], tip_daa: tip, coverage_max_end_daa: maxEnd, unknown_by_type: Array.isArray(unknown) ? unknown : [] },
    manual_refund_pending_detail: Array.isArray(manualPending) ? manualPending : [],
    errors: [held, stuck, intents, unknown, manualPending].filter((r) => r && r.error).map((r) => r.error),
  };
}

/** 超阈判定 (纯函数) */
export function breaches(m, th = THRESHOLDS) {
  const out = [];
  if ((m.held ?? 0) >= th.held) out.push({ metric: 'held', value: m.held });
  if ((m.stuck_refunding ?? 0) >= th.stuck_refunding) out.push({ metric: 'stuck_refunding', value: m.stuck_refunding });
  if ((m.intent_stale ?? 0) >= th.intent_stale) out.push({ metric: 'intent_stale', value: m.intent_stale });
  if (m.coverage_lag_daa != null && m.coverage_lag_daa >= th.coverage_lag_daa) out.push({ metric: 'coverage_lag_daa', value: m.coverage_lag_daa });
  if ((m.unknown_1h ?? 0) >= th.unknown_1h) out.push({ metric: 'unknown_1h', value: m.unknown_1h });
  if ((m.manual_refund_pending ?? 0) >= th.manual_refund_pending) out.push({ metric: 'manual_refund_pending', value: m.manual_refund_pending });
  return out;
}

/** 一次性告警 (按 metric + hour bucket 去重) */
export function alertBreachesOnce(db, list, nowIso = new Date().toISOString()) {
  const bucket = nowIso.slice(0, 13);   // YYYY-MM-DDTHH
  let written = 0;
  for (const b of list) {
    try {
      const type = `broker_hold_${b.metric}`;
      const exists = db.prepare(`SELECT 1 FROM events WHERE event_type = ? AND json_extract(payload_json, '$.bucket') = ? LIMIT 1`).get(type, bucket);
      if (exists) continue;
      db.prepare(`INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at) VALUES (lower(hex(randomblob(16))), 'system', ?, 'broker-hold-monitor', 'warn', ?, ?, datetime('now'))`)
        .run(type, `${b.metric}=${b.value} (bucket ${bucket})`, JSON.stringify({ bucket, metric: b.metric, value: b.value }));
      written++;
    } catch (e) { console.warn(`[broker-hold-monitor] alert write failed: ${e.message}`); }
  }
  return written;
}

let _timer = null;
export function brokerHoldMonitorTick() {
  try {
    const m = computeHoldMetrics(sqlite);
    const br = breaches(m);
    console.log(`[broker-hold-monitor] held=${m.held ?? 'n/a'} stuck_refunding=${m.stuck_refunding ?? 'n/a'} intent_stale=${m.intent_stale ?? 'n/a'} coverage_lag_daa=${m.coverage_lag_daa ?? 'null(no ledger/heartbeat)'} unknown_1h=${m.unknown_1h ?? 'n/a'} breaches=${br.length}${m.errors.length ? ' errors=' + m.errors.join('|') : ''}`);
    console.log(`[broker-hold-monitor] manual_refund_pending=${m.manual_refund_pending ?? 'n/a'} (第六数: BUY fallback 待人工退款 offer 数)`);
    if (br.length) alertBreachesOnce(sqlite, br);
  } catch (e) { console.warn(`[broker-hold-monitor] tick error (read-only, non-fatal): ${e.message}`); }
}
export function startBrokerHoldMonitor() {
  if (_timer) return;
  console.log(`[broker-hold-monitor] start, tick=${HOLD_MONITOR_TICK_MS}ms (read-only; 6 metrics; thresholds ${JSON.stringify(THRESHOLDS)})`);
  _timer = setInterval(brokerHoldMonitorTick, HOLD_MONITOR_TICK_MS);
  setTimeout(brokerHoldMonitorTick, 30_000);   // 首行 30 s 后 (部署单 §1 ⑥ 验收锚)
}
export function stopBrokerHoldMonitor() { if (_timer) { clearInterval(_timer); _timer = null; } }
