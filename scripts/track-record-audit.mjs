#!/usr/bin/env node
// Phase 3g Sub 4 (C-2) — bettor_track_record daily snapshot audit cron.
//
// Bettor r79 architect spec PASS + 3 决断:
//   1. Brier source: outcome (硬数学, 0/1 resolution, 不依赖 was_correct flag)
//   2. 30-day rolling window (老 LLM calibrator damping noise 大, 近期信号准)
//   3. per_event_type minimum >= 5 settled 才报 ('insufficient_data' 否则)
//
// architect 加 3 字段:
//   - total_unsettled: settled vs pending 实际分布 (信号 "市场不结算" / "long-tail 押法")
//   - avg_holding_hours: 长/短持仓不同 calibrator (Phase 3g E 模块 Brier 反馈分桶)
//   - GET /api/bettor/track-record/today: 实时 accumulating (跟 daily snapshot 区分)
//
// cron: daily 00:30 UTC (避 daily reset 30min buffer). 跑完 UPSERT bettor_track_record + log.

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const kasiaRequire = createRequire(`${KANET_ROOT}/kasia-console/`);
const Database = kasiaRequire('better-sqlite3');
const DB_PATH = `${KANET_ROOT}/kasia-console/data/console.db`;
const LOG_FILE = `${KANET_ROOT}/logs/track-record-audit.log`;
const ROLLING_DAYS = 30;
const MIN_SAMPLE_PER_BUCKET = 5;
const CRON_INTERVAL_MS = 24 * 60 * 60_000;  // 24h (daily)

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) {
  const line = `[${ts()}] ${msg}`;
  process.stdout.write(line + '\n');
  try { writeFileSync(LOG_FILE, line + '\n', { flag: 'a' }); } catch {}
}

// Brier per settled position: predicted = LLM's p_mid (forecast of yes_outcome).
// Sub 9.6 hotfix per Bettor r86 + audit实证: 原公式用 entry_yes_price (market price) 错 — Brier 测 LLM
// forecast accuracy 不是 market accuracy. direction (NO/YES) 是决策不是预测. 改 p_mid.
// 实证 J1 host: 旧 Brier=0.244 (buggy) → 真 Brier=0.222 (略胜 random 0.25).
function brierForPosition(pos) {
  if (pos.current_yes_price == null) return null;
  const outcome = pos.current_yes_price >= 0.99 ? 1 : (pos.current_yes_price <= 0.01 ? 0 : null);
  if (outcome === null) return null;
  const predicted = pos.p_mid;  // LLM forecast of yes_outcome (不 flip by direction)
  if (predicted == null) return null;
  return Math.pow(predicted - outcome, 2);
}

function bucketStats(rows) {
  if (rows.length < MIN_SAMPLE_PER_BUCKET) return { sample: rows.length, status: 'insufficient_data' };
  const briers = rows.map(brierForPosition).filter(x => x !== null);
  const wins = rows.filter(r => (r.realized_pnl || 0) > 0).length;
  const totalPnl = rows.reduce((s, r) => s + (r.realized_pnl || 0), 0);
  return {
    sample: rows.length,
    brier_mean: briers.length > 0 ? briers.reduce((a, b) => a + b, 0) / briers.length : null,
    win_rate: rows.length > 0 ? wins / rows.length : null,
    total_pnl_usd: Number(totalPnl.toFixed(2)),
  };
}

async function runAudit(targetDate) {
  const db = new Database(DB_PATH);
  try {
    const sinceIso = new Date(Date.now() - ROLLING_DAYS * 24 * 60 * 60_000).toISOString();

    // settled positions: closed_at NOT NULL + 30-day rolling window
    const settled = db.prepare(`
      SELECT p.id, p.direction, p.entry_yes_price, p.size_usd, p.opened_at, p.closed_at, p.realized_pnl, r.p_mid,
             r.calibrator_confidence, s.current_yes_price,
             (SELECT event_type FROM event_calendar ec WHERE ec.market_id = r.market_id LIMIT 1) AS event_type
      FROM bettor_sim_positions p
      JOIN bettor_recommendations r ON r.id = p.recommendation_id
      LEFT JOIN bettor_sim_snapshots s ON s.id = (
        SELECT id FROM bettor_sim_snapshots WHERE position_id = p.id ORDER BY snapshot_at DESC LIMIT 1
      )
      WHERE p.closed_at IS NOT NULL AND p.closed_at > ?
    `).all(sinceIso);

    const unsettled = db.prepare("SELECT COUNT(*) AS c FROM bettor_sim_positions WHERE closed_at IS NULL").get();

    // Holding hours
    const holdingHours = settled
      .filter(p => p.opened_at && p.closed_at)
      .map(p => (new Date(p.closed_at) - new Date(p.opened_at)) / 3_600_000);
    const avgHolding = holdingHours.length > 0 ? holdingHours.reduce((a, b) => a + b, 0) / holdingHours.length : null;

    // Overall stats
    const overall = bucketStats(settled);

    // Per event_type breakdown
    const perEventType = {};
    const eventTypes = [...new Set(settled.map(p => p.event_type || 'default'))];
    for (const et of eventTypes) {
      perEventType[et] = bucketStats(settled.filter(p => (p.event_type || 'default') === et));
    }

    // Per confidence_band breakdown (Phase 3g A 后才有 real data)
    const perBand = {};
    const bands = [...new Set(settled.map(p => p.calibrator_confidence || 'null'))];
    for (const b of bands) {
      perBand[b] = bucketStats(settled.filter(p => (p.calibrator_confidence || 'null') === b));
    }

    // UPSERT bettor_track_record
    db.prepare(`
      INSERT INTO bettor_track_record
        (date_utc, brier_mean, win_rate, total_settled, total_unsettled, total_pnl_usd, avg_holding_hours,
         per_event_type_json, per_confidence_band_json, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(date_utc) DO UPDATE SET
        brier_mean = excluded.brier_mean, win_rate = excluded.win_rate,
        total_settled = excluded.total_settled, total_unsettled = excluded.total_unsettled,
        total_pnl_usd = excluded.total_pnl_usd, avg_holding_hours = excluded.avg_holding_hours,
        per_event_type_json = excluded.per_event_type_json,
        per_confidence_band_json = excluded.per_confidence_band_json,
        computed_at = excluded.computed_at
    `).run(
      targetDate,
      overall.brier_mean,
      overall.win_rate,
      settled.length,
      unsettled?.c || 0,
      overall.total_pnl_usd || 0,
      avgHolding,
      JSON.stringify(perEventType),
      JSON.stringify(perBand),
    );

    log(`track-record snapshot date=${targetDate} brier=${overall.brier_mean?.toFixed(3) ?? 'n/a'} ` +
        `win=${overall.win_rate ? (overall.win_rate * 100).toFixed(1) + '%' : 'n/a'} ` +
        `settled=${settled.length} unsettled=${unsettled?.c || 0} ` +
        `pnl=$${(overall.total_pnl_usd || 0).toFixed(2)} ` +
        `avgHold=${avgHolding ? avgHolding.toFixed(1) + 'h' : 'n/a'} ` +
        `events=[${eventTypes.join(',')}] bands=[${bands.join(',')}]`);
  } finally { db.close(); }
}

// Cron: daily 00:30 UTC. 现 start 立即跑一次 + setInterval 24h.
const today = new Date().toISOString().slice(0, 10);
log(`Phase 3g C-2 track-record-audit starting · rolling ${ROLLING_DAYS}d · min sample ${MIN_SAMPLE_PER_BUCKET} · cron 24h`);
await runAudit(today);
setInterval(async () => {
  try { await runAudit(new Date().toISOString().slice(0, 10)); } catch (e) { log(`audit err: ${e.message?.slice(0, 80)}`); }
}, CRON_INTERVAL_MS);
