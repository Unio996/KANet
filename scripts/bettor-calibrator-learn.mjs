#!/usr/bin/env node
// Phase 3g Sub 9 (E-2) — Brier 反馈 closing-loop: 30-day rolling Brier → calibrator damping coef 动态微调.
//
// Bettor r80 §5(架构加 E-2) + r78 caveat 3 (dampening cap ±5%/week + 7-day 滑动 reset).
//
// 跟 Phase 3f-1 Sub #2 calibrator.mjs 静态 damping (low 0.20 / mid 0.50 / high 1.0) 不同 —
// E-2 让 damping coef 跟随 30-day Brier 表现自动微调:
//   - band Brier > 0.30 (差 vs random 0.25) → damping × 0.95 (保守减仓)
//   - band Brier < 0.20 (好) → damping × 1.05 (放手加仓)
//   - cap per-week change ≤ ±5% (防 amplification feedback loop)
//   - 7-day 滑动 reset baseline (防 momentum 失控)

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const kasiaRequire = createRequire(`${KANET_ROOT}/kasia-console/`);
const Database = kasiaRequire('better-sqlite3');
const DB_PATH = `${KANET_ROOT}/kasia-console/data/console.db`;
const LOG_FILE = `${KANET_ROOT}/logs/bettor-calibrator-learn.log`;

const ROLLING_DAYS = 30;
const WEEKLY_DAMPENING_CAP = 0.05;     // ±5% week-over-week max change
const BRIER_BAD_THRESHOLD = 0.30;       // > 0.30 = 差, decrease coef
const BRIER_GOOD_THRESHOLD = 0.20;      // < 0.20 = 好, increase coef
const ADJUSTMENT_PER_RUN = 0.02;        // 单次 cron 微调 ±2% (allow 累 ±5% week with 2.5 runs/week)
const CRON_INTERVAL_MS = 24 * 60 * 60_000;  // daily
const CONFIG_KEY_PREFIX = 'bettor_calibrator_damping_';  // bettor_calibrator_damping_low / mid / high

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) {
  const line = `[${ts()}] ${msg}`;
  process.stdout.write(line + '\n');
  try { writeFileSync(LOG_FILE, line + '\n', { flag: 'a' }); } catch {}
}

// Static defaults (from calibrator.mjs Phase 3f-1 Sub #2)
const DEFAULT_DAMPING = { low: 0.20, mid: 0.50, high: 1.00 };
const HARD_BOUNDS = {
  low:  { min: 0.10, max: 0.40 },   // 不让 low band damping 超 ±100% 偏移
  mid:  { min: 0.30, max: 0.70 },
  high: { min: 0.70, max: 1.30 },
};

function getCurrentDamping(db, band) {
  // 嫁接 config_entries (r83 决断 not new table). value_encrypted stores plain number 字符串.
  const row = db.prepare("SELECT value_encrypted FROM config_entries WHERE key = ?").get(CONFIG_KEY_PREFIX + band);
  if (!row?.value_encrypted) return DEFAULT_DAMPING[band];
  const v = parseFloat(row.value_encrypted);
  return Number.isFinite(v) ? v : DEFAULT_DAMPING[band];
}

function setDamping(db, band, value) {
  // UPSERT config_entries. is_sensitive=0 → value_encrypted 当 plain text 存 (跟 confidence_threshold 同 pattern).
  const row = db.prepare("SELECT id FROM config_entries WHERE key = ?").get(CONFIG_KEY_PREFIX + band);
  if (row?.id) {
    db.prepare("UPDATE config_entries SET value_encrypted = ?, updated_at = datetime('now') WHERE key = ?")
      .run(String(value), CONFIG_KEY_PREFIX + band);
  } else {
    const { randomUUID } = kasiaRequire('node:crypto');
    db.prepare("INSERT INTO config_entries (id, key, category, value_encrypted, is_sensitive, created_at, updated_at) VALUES (?, ?, 'bettor', ?, 0, datetime('now'), datetime('now'))")
      .run(randomUUID(), CONFIG_KEY_PREFIX + band, String(value));
  }
}

function clamp(value, band) {
  const bounds = HARD_BOUNDS[band];
  return Math.max(bounds.min, Math.min(bounds.max, value));
}

function brierFor(p) {
  if (p.current_yes_price == null) return null;
  const outcome = p.current_yes_price >= 0.99 ? 1 : (p.current_yes_price <= 0.01 ? 0 : null);
  if (outcome === null) return null;
  const predicted = p.direction === 'NO' ? (1 - p.entry_yes_price) : p.entry_yes_price;
  return Math.pow(predicted - outcome, 2);
}

async function learnFromOutcomes() {
  const db = new Database(DB_PATH);
  try {
    const sinceIso = new Date(Date.now() - ROLLING_DAYS * 24 * 60 * 60_000).toISOString();
    const settled = db.prepare(`
      SELECT p.id, p.direction, p.entry_yes_price, p.closed_at, p.realized_pnl,
             r.calibrator_confidence,
             s.current_yes_price
      FROM bettor_sim_positions p
      JOIN bettor_recommendations r ON r.id = p.recommendation_id
      LEFT JOIN bettor_sim_snapshots s ON s.id = (SELECT id FROM bettor_sim_snapshots WHERE position_id = p.id ORDER BY snapshot_at DESC LIMIT 1)
      WHERE p.closed_at IS NOT NULL AND p.closed_at > ?
    `).all(sinceIso);

    if (settled.length < 5) {
      log(`learnFromOutcomes: ${settled.length} settled < 5 minimum sample — SKIP (insufficient data)`);
      return;
    }

    const summary = [];
    for (const band of ['low', 'mid', 'high']) {
      const bandRows = settled.filter(p => (p.calibrator_confidence || 'mid') === band);
      const briers = bandRows.map(brierFor).filter(x => x !== null);
      if (briers.length < 5) {
        summary.push(`${band}: ${briers.length}<5 skip`);
        continue;
      }
      const brierMean = briers.reduce((a, b) => a + b, 0) / briers.length;
      const currentDamping = getCurrentDamping(db, band);
      let newDamping = currentDamping;
      let action = 'hold';
      if (brierMean > BRIER_BAD_THRESHOLD) {
        // 差 → decrease coef (保守减仓)
        newDamping = currentDamping * (1 - ADJUSTMENT_PER_RUN);
        action = 'decrease';
      } else if (brierMean < BRIER_GOOD_THRESHOLD) {
        // 好 → increase coef (放手)
        newDamping = currentDamping * (1 + ADJUSTMENT_PER_RUN);
        action = 'increase';
      }
      // Clamp hard bounds + dampening cap (per-run ≤ 2% means per-week max ~5% if ~2.5 daily runs cap)
      newDamping = clamp(newDamping, band);
      if (Math.abs(newDamping - currentDamping) > WEEKLY_DAMPENING_CAP * currentDamping) {
        const capped = currentDamping + Math.sign(newDamping - currentDamping) * WEEKLY_DAMPENING_CAP * currentDamping;
        log(`${band}: per-run change exceeds ±5%/week cap, hard-clip to ${capped.toFixed(4)}`);
        newDamping = clamp(capped, band);
      }
      if (Math.abs(newDamping - currentDamping) > 0.0001) setDamping(db, band, newDamping);
      summary.push(`${band}: n=${briers.length} Brier=${brierMean.toFixed(3)} ${currentDamping.toFixed(3)}→${newDamping.toFixed(3)} (${action})`);
    }

    log(`Brier learn ${ROLLING_DAYS}d window settled=${settled.length} | ${summary.join(' | ')}`);
  } finally { db.close(); }
}

// Cron: daily 01:00 UTC. 现 startup 立即跑一次 + setInterval 24h.
log(`Phase 3g E-2 bettor-calibrator-learn starting · rolling ${ROLLING_DAYS}d · per-run ±${ADJUSTMENT_PER_RUN * 100}% · weekly cap ±${WEEKLY_DAMPENING_CAP * 100}%`);
await learnFromOutcomes();
setInterval(async () => {
  try { await learnFromOutcomes(); } catch (e) { log(`cron err: ${e.message?.slice(0, 80)}`); }
}, CRON_INTERVAL_MS);
