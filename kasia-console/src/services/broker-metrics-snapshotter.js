/**
 * Broker Metrics Snapshotter — MN-01 (Phase 0 v6 5/15 真测 Owner 钦定).
 *
 * Hourly cron 写入 broker_metrics_hourly:
 *   - prepay_count / prepay_usdt_total / prepay_kas_total — 该 hour escrow row INSERT
 *   - expire_count — 该 hour escrow expired refund
 *   - settle_count — 该 hour offer completed (full settle)
 *   - cancel_count — 该 hour offer cancelled
 *   - active_escrow_end — hour 结尾 active escrow concurrent count
 *   - broker_k_total / broker_u_total — broker pool 现 snapshot (via /api/exchange/custody-pool)
 *   - delta_k_vs_baseline / delta_u_vs_baseline — vs config_entries.exchange_custody_baseline
 *   - top_users_heat — JSON [{user, count}] top 10 user by active escrow count
 *
 * Tick: 60 min. Boot tick 60s (启动后即 fill 当前 hour bucket).
 * Bucket: ISO truncate to hour, e.g. '2026-05-15T10:00:00Z'.
 */

import { sqlite } from '../db/client.js';

const SNAPSHOT_INTERVAL_MS = 60 * 60 * 1000;  // 1h
// KI 65 A.3.4 wave 4 (5/22): runtime helper, no module-load const.
// Historical Bug V 5/15 context (no longer hardcoded literal — see git history if Bug V details needed).
// lint-allow-broker-uuid: historical Bug V 5/15 fix annotation in deprecated literal removed by A.3.4; helper used at call sites.
import { getBrokerRelayIdOrThrow } from './broker-config-resolver.js';
let _timer = null;
let _running = false;

function currentHourBucket() {
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function prevHourRange(bucket) {
  // bucket is current hour start; return [prev_hour_start, bucket) for window queries.
  const cur = new Date(bucket);
  const prev = new Date(cur.getTime() - SNAPSHOT_INTERVAL_MS);
  return { start: prev.toISOString().replace(/\.\d{3}Z$/, 'Z'), end: bucket };
}

export async function snapshotHourlyMetrics() {
  if (_running) return { skipped: 'already running' };
  _running = true;
  try {
    const bucket = currentHourBucket();
    const { start, end } = prevHourRange(bucket);

    // 1. prepay activity in window
    const prepayRows = sqlite.prepare(`
      SELECT side, asset, amount_quoted, target_amount
      FROM user_escrow_balances
      WHERE created_at >= ? AND created_at < ?
    `).all(start, end);
    const prepay_count = prepayRows.length;
    const prepay_usdt_total = prepayRows.filter(r => r.asset !== 'KAS').reduce((s, r) => s + (parseFloat(r.amount_quoted) || 0), 0);
    const prepay_kas_total = prepayRows.filter(r => r.asset === 'KAS').reduce((s, r) => s + (parseFloat(r.amount_quoted) || 0), 0);

    // 2. expire/settle/cancel in window — status changes from updated_at
    const expire_count = sqlite.prepare(`SELECT COUNT(*) AS c FROM user_escrow_balances WHERE status='refunded' AND updated_at >= ? AND updated_at < ?`).get(start, end).c;
    const settle_count = sqlite.prepare(`SELECT COUNT(*) AS c FROM exchange_offers WHERE protocol_status='completed' AND updated_at >= ? AND updated_at < ?`).get(start, end).c;
    const cancel_count = sqlite.prepare(`SELECT COUNT(*) AS c FROM exchange_offers WHERE protocol_status='cancelled' AND updated_at >= ? AND updated_at < ?`).get(start, end).c;

    // 3. active escrow at hour end (status='active' AND expires_at > end)
    const active_escrow_end = sqlite.prepare(`SELECT COUNT(*) AS c FROM user_escrow_balances WHERE status='active' AND expires_at > ?`).get(end).c;

    // 4. broker pool snapshot — fetch via internal endpoint for consistency.
    let broker_k_total = null, broker_u_total = null, delta_k = null, delta_u = null;
    try {
      const port = process.env.PORT || 3100;
      const res = await fetch(`http://127.0.0.1:${port}/api/exchange/custody-pool`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      if (data?.ok) {
        broker_k_total = data.k_pool?.total ?? null;
        broker_u_total = data.u_pool?.total ?? null;
        delta_k = data.delta?.k ?? null;
        delta_u = data.delta?.u ?? null;
      }
    } catch (err) {
      console.warn(`[broker-metrics] custody-pool snapshot err: ${err.message}`);
    }

    // 5. top users heat — group active escrows by user_kasia_addr, top 10 by count.
    const heatRows = sqlite.prepare(`
      SELECT user_kasia_addr, COUNT(*) AS active_count
      FROM user_escrow_balances
      WHERE status='active' AND expires_at > ?
      GROUP BY user_kasia_addr
      ORDER BY active_count DESC
      LIMIT 10
    `).all(end);
    const top_users_heat = JSON.stringify(heatRows.map(r => ({ user: r.user_kasia_addr, count: r.active_count })));

    // 6. UPSERT row
    sqlite.prepare(`
      INSERT INTO broker_metrics_hourly
        (hour_bucket, prepay_count, prepay_usdt_total, prepay_kas_total,
         expire_count, settle_count, cancel_count, active_escrow_end,
         broker_k_total, broker_u_total, delta_k_vs_baseline, delta_u_vs_baseline,
         top_users_heat, snapshot_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(hour_bucket) DO UPDATE SET
        prepay_count=excluded.prepay_count,
        prepay_usdt_total=excluded.prepay_usdt_total,
        prepay_kas_total=excluded.prepay_kas_total,
        expire_count=excluded.expire_count,
        settle_count=excluded.settle_count,
        cancel_count=excluded.cancel_count,
        active_escrow_end=excluded.active_escrow_end,
        broker_k_total=excluded.broker_k_total,
        broker_u_total=excluded.broker_u_total,
        delta_k_vs_baseline=excluded.delta_k_vs_baseline,
        delta_u_vs_baseline=excluded.delta_u_vs_baseline,
        top_users_heat=excluded.top_users_heat,
        snapshot_at=datetime('now')
    `).run(
      start, prepay_count, prepay_usdt_total, prepay_kas_total,
      expire_count, settle_count, cancel_count, active_escrow_end,
      broker_k_total, broker_u_total, delta_k, delta_u,
      top_users_heat
    );

    console.log(`[broker-metrics] snapshot ${start}: prepay=${prepay_count} expire=${expire_count} settle=${settle_count} active=${active_escrow_end} K=${broker_k_total?.toFixed(2)} ΔK=${delta_k?.toFixed(4)}`);
    return { ok: true, bucket: start, prepay_count, expire_count, settle_count, cancel_count, active_escrow_end, delta_k, delta_u };
  } catch (err) {
    console.error(`[broker-metrics] snapshot error: ${err.message}`);
    return { ok: false, error: err.message };
  } finally {
    _running = false;
  }
}

export function startBrokerMetricsCron() {
  if (_timer) return;
  _timer = setInterval(() => {
    snapshotHourlyMetrics().catch(err => console.error(`[broker-metrics] cron err: ${err.message}`));
  }, SNAPSHOT_INTERVAL_MS);
  // Boot tick 60s — fill current hour bucket immediately so dashboard 不空.
  setTimeout(() => {
    snapshotHourlyMetrics().catch(err => console.error(`[broker-metrics] boot tick err: ${err.message}`));
  }, 60_000);
  console.log(`[broker-metrics] cron registered: every 1h, boot tick 60s`);
}

export function stopBrokerMetricsCron() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
