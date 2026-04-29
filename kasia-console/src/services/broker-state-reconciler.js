// broker-state-reconciler — 5min cron tick. Phase 2 chain TX crash recovery + invariant audit.
// 三方 round 3 design v4 共识 NWT territory (D 节点).
//
// 真 invariant check:
// 1. retail_dex_orders state='refunding' age >5min → Phase 2 crash. kaspa_tx_log query verify chain truth.
//    found chain TX → backfill Phase 3 (UPDATE state='refunded', refund_tx_hash, INSERT chain_events).
//    not found + age >1h → alert Owner manual review.
// 2. chain_events 'broker_kas_refunded' COUNT vs kaspa_tx_log broker outbound COUNT 不一致 → push alert.
// 3. retail_dex_orders state='aligning' age >30min → expired sweep gap (J1 #56 _sweepStaleAligning 已 cover, double-check).
//
// 不 ship code 真 Phase 3 backfill 直接 SQL — 真 broker-state-authority.advanceToRefunded API (J2 ship 中, 待集成).
// 第一版 reconciler 只 detect + alert, 不 self-heal. J2 advanceToRefunded ship 后真**真**真 wire backfill.

import { sqlite } from '../db/client.js';
import { randomUUID } from 'node:crypto';
import { advanceToRefunded } from './broker-state-authority.js';

const TICK_MS = 5 * 60 * 1000;
const STUCK_REFUNDING_AGE_MS = 5 * 60 * 1000;
const STUCK_REFUNDING_ALERT_AGE_MS = 60 * 60 * 1000;
const STALE_ALIGNING_AGE_MS = 30 * 60 * 1000;

const BROKER_RELAY_ID = '0a8e9723-f00b-4b10-8c79-1dbd4fe3cfb0';

let _interval = null;
let _started = false;
let _tickCount = 0;
let _alertCount = 0;

function _alert(level, summary, payload) {
  try {
    sqlite.prepare(`
      INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
      VALUES (?, 'system', 'reconciler_alert', 'state-reconciler', ?, ?, ?, datetime('now'))
    `).run(randomUUID(), level, summary, JSON.stringify(payload || {}));
    _alertCount++;
  } catch (e) {
    console.warn(`[state-reconciler] events INSERT err: ${e.message}`);
  }
}

async function _checkStuckRefunding() {
  const stuck = sqlite.prepare(`
    SELECT id, user_kasia_address, qty, exchange_offer_id, state, updated_at,
           (julianday('now') - julianday(updated_at)) * 86400000 AS age_ms
    FROM retail_dex_orders
    WHERE state = 'refunding'
      AND refund_tx_hash IS NULL
      AND updated_at < datetime('now', '-5 minutes')
    LIMIT 50
  `).all();
  let backfilled = 0;
  for (const order of stuck) {
    const ageMin = Math.round(order.age_ms / 60000);
    // Wire 1: 调 advanceToRefunded(reason='reconciler_retry') 真 backfill OR retry
    // advanceToRefunded Pre-check chain-truth dedup → found chain TX → _backfillRefundedState (Phase 3 sync)
    // 真 idempotent — already 'refunded' 真 alreadyRefunded return early
    try {
      const result = await advanceToRefunded({ orderId: order.id, reason: 'reconciler_retry' });
      if (result?.ok && result?.alreadyRefunded) {
        backfilled++;
        console.log(`[reconciler] backfill success order ${order.id.slice(0,8)} txId=${(result.txId || '').slice(0,12)}`);
      } else if (result?.skipReason) {
        // race lost OR conditions not met — next tick re-evaluate
      }
    } catch (e) {
      console.warn(`[reconciler] advanceToRefunded err ${order.id.slice(0,8)}: ${e.message}`);
    }

    if (order.age_ms > STUCK_REFUNDING_ALERT_AGE_MS) {
      _alert('error', `🔴 stuck refunding ${ageMin}min: order ${order.id.slice(0,8)} qty=${order.qty} peer=${order.user_kasia_address.slice(-12)}`, {
        order_id: order.id, age_min: ageMin, exchange_offer_id: order.exchange_offer_id,
      });
    } else {
      _alert('warn', `🟠 stuck refunding ${ageMin}min: order ${order.id.slice(0,8)}`, {
        order_id: order.id, age_min: ageMin,
      });
    }
  }
  return { stuck: stuck.length, backfilled };
}

// J1 #69 propose: 'expired' state + error_reason='refund_send_failed' = retry-able
// (J2 Track B Phase 1 rollback target). reconciler 5min cron retry advanceToRefunded.
// 'expired' state 真 TTL 自然 expired (broker-intake-watcher REFUND_TICK 已 cover) 真 reconciler skip.
async function _checkRetryableExpiredFailedRefund() {
  const retryable = sqlite.prepare(`
    SELECT id, user_kasia_address, qty, exchange_offer_id, state, error_reason, updated_at,
           (julianday('now') - julianday(updated_at)) * 86400000 AS age_ms
    FROM retail_dex_orders
    WHERE state = 'expired'
      AND refund_tx_hash IS NULL
      AND error_reason LIKE '%refund_send_failed%'
      AND updated_at < datetime('now', '-5 minutes')
    LIMIT 20
  `).all();
  let retried = 0;
  for (const order of retryable) {
    const ageMin = Math.round(order.age_ms / 60000);
    // Wire 1: retry sendKas via advanceToRefunded
    try {
      const result = await advanceToRefunded({ orderId: order.id, reason: 'reconciler_retry' });
      if (result?.ok) {
        retried++;
        console.log(`[reconciler] retry success order ${order.id.slice(0,8)} txId=${(result.txId || '').slice(0,12)}`);
      }
    } catch (e) {
      console.warn(`[reconciler] retry advanceToRefunded err ${order.id.slice(0,8)}: ${e.message}`);
    }
    _alert('warn', `🟡 retry-able expired refund ${ageMin}min: order ${order.id.slice(0,8)} reason=${(order.error_reason || '').slice(0, 80)}`, {
      order_id: order.id, age_min: ageMin, error_reason: order.error_reason,
    });
  }
  return { retryable: retryable.length, retried };
}

function _checkRefundCountMismatch() {
  // chain_events 真 'broker_kas_refunded' COUNT (post-v83 backfill cleanup, 真**真 chain hash only)
  const ceCount = sqlite.prepare(`
    SELECT COUNT(*) AS n FROM chain_events
    WHERE event_type = 'broker_kas_refunded'
      AND length(txid) = 64
      AND txid GLOB '[a-fA-F0-9]*'
  `).get().n;

  // kaspa_tx_log 真 broker outbound (broker_relay address 真 from_address) — 真**真 indexer 真 sync
  const brokerAddr = sqlite.prepare(`SELECT address FROM relay_nodes WHERE id=?`).get(BROKER_RELAY_ID)?.address;
  if (!brokerAddr) return 0;

  const ktlCount = sqlite.prepare(`
    SELECT COUNT(*) AS n FROM kaspa_tx_log
    WHERE from_address = ?
      AND created_at > datetime('now', '-30 days')
  `).get().n;

  // Note: ktlCount include all broker outbound (refund + delivery + fee), not refund-only.
  // 真 refund-only count 真 future enhancement (chain_events JOIN kaspa_tx_log).
  // 现 invariant: ceCount <= ktlCount (refund 真 outbound subset).
  if (ceCount > ktlCount) {
    _alert('error', `🔴 refund count drift: chain_events broker_kas_refunded=${ceCount} > kaspa_tx_log broker outbound=${ktlCount}`, {
      ce_count: ceCount, ktl_count: ktlCount,
    });
  }
  return { ceCount, ktlCount };
}

function _checkStaleAligning() {
  // J1 #56 _sweepStaleAligning cron 已 cover. 真 reconciler double-check.
  const stale = sqlite.prepare(`
    SELECT id, user_kasia_address,
           (julianday('now') - julianday(updated_at)) * 86400000 AS age_ms
    FROM retail_dex_orders
    WHERE state = 'aligning'
      AND updated_at < datetime('now', '-30 minutes')
    LIMIT 20
  `).all();
  if (stale.length > 5) {
    _alert('warn', `🟡 ${stale.length} stale aligning orders (>30min) — _sweepStaleAligning 真**真**真 sweep gap?`, {
      count: stale.length, sample_ids: stale.slice(0, 5).map(o => o.id.slice(0, 8)),
    });
  }
  return stale.length;
}

async function tick() {
  _tickCount++;
  const t0 = Date.now();
  try {
    const stuckResult = await _checkStuckRefunding();
    const retryableResult = await _checkRetryableExpiredFailedRefund();
    const counts = _checkRefundCountMismatch();
    const stale = _checkStaleAligning();
    const elapsed = Date.now() - t0;
    if (elapsed > 1000 || stuckResult.backfilled > 0 || retryableResult.retried > 0) {
      console.log(`[state-reconciler] tick #${_tickCount} ${elapsed}ms stuck=${stuckResult.stuck} backfilled=${stuckResult.backfilled} retryable=${retryableResult.retryable} retried=${retryableResult.retried} stale=${stale} ce=${counts?.ceCount} ktl=${counts?.ktlCount}`);
    }
  } catch (e) {
    console.error(`[state-reconciler] tick #${_tickCount} err: ${e.message}`);
  }
}

export function startStateReconciler() {
  if (_started) return;
  _started = true;
  console.log(`[state-reconciler] start, tick=${TICK_MS}ms`);
  tick();
  _interval = setInterval(tick, TICK_MS);
}

export function stopStateReconciler() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
  _started = false;
}

export function getReconcilerStats() {
  return { started: _started, ticks: _tickCount, alerts: _alertCount };
}
