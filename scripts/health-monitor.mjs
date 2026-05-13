#!/usr/bin/env node
// Phase 3g Sub 3 (C-1) — health monitor: heartbeat watch + cooldown + severity-based alert dispatch
//
// Bettor r78 architect spec PASS. 5/12-5/13 silent fail 13h 实证根因 = 无 alerting 路径.
// 修法: 5 watch keys 1min cron, alert dispatch 走 severity (DEBUG→log / WARN→log+stdout /
// CRITICAL→log+stdout+broadcast dev-coord), cooldown 1h/issue + 5/h hard + 50/d total
// 持久化 health_alert_log (v102).
//
// 不发 every tick, 只发 transitions (status FAIL→OK / OK→FAIL / 2 连续 FAIL → CRITICAL alert).

import { createRequire } from 'node:module';
const KANET_ROOT = process.env.KANET_ROOT || 'D:/Anthropic';
const kasiaRequire = createRequire(`${KANET_ROOT}/kasia-console/`);
const Database = kasiaRequire('better-sqlite3');

const DB_PATH = `${KANET_ROOT}/kasia-console/data/console.db`;
const LOG_FILE = `${KANET_ROOT}/logs/health-monitor.log`;
const TICK_MS = 60_000;                  // 1min cron
const CRITICAL_FAIL_THRESHOLD = 2;       // 2 连续 fail → CRITICAL alert
const COOLDOWN_SAME_ALERT_MS = 60 * 60_000;  // 1h same alert_key cap
const HARD_CAP_PER_HOUR = 5;             // 5/h total alerts
const HARD_CAP_PER_DAY = 50;             // 50/d total
const BROADCAST_RELAY = '3765cc82-5e20-4e61-bb0a-697277287223';  // Martin J1
const CONSOLE_URL = 'http://127.0.0.1:3100';

import { writeFileSync } from 'node:fs';

function ts() { return new Date().toISOString().slice(11, 19); }
function log(msg) {
  const line = `[${ts()}] ${msg}`;
  process.stdout.write(line + '\n');
  try { writeFileSync(LOG_FILE, line + '\n', { flag: 'a' }); } catch {}
}

// ── Watch keys + check funcs (5 J1 propose) ────────────────────────────────────
// Sub 3.5 hotfix (Bettor r79 audit): 删原误导 "+2 architect 加" 注释 (实际 0 architect 加).
// TODO Phase 3h dev hardening: eval-success-rate (reactor cross-module instrument) +
// monitor-subscribe-alive (dev-coord-monitor-local heartbeat write).

const WATCH_KEYS = [
  // key, severity-on-fail, expected_interval_ms, check_fn
  { key: 'bettor-reactor',  severityOnFail: 'CRITICAL', intervalMs: 60 * 60_000,  check: checkReactorCron },
  { key: 'bettor-scanner',  severityOnFail: 'WARN',     intervalMs: 6 * 60 * 60_000, check: checkScannerCron },
  { key: 'lan-ip-health',   severityOnFail: 'WARN',     intervalMs: 10 * 60_000,  check: checkLanIpHealth },
  { key: 'adapter-3018',    severityOnFail: 'CRITICAL', intervalMs: 30_000,        check: checkAdapter3018 },
  { key: 'console-db',      severityOnFail: 'WARN',     intervalMs: 5 * 60_000,    check: checkConsoleDbLatency },
];

// Sub 9.7 hotfix: SQLite datetime('now') 返回 UTC 无时区标志 ("YYYY-MM-DD HH:MM:SS"),
// Node new Date() 当 LOCAL time parse 导致 J1 host (UTC+7 Bangkok) +7h false offset.
// 修: 用 julianday('now') - julianday(created_at) 算 ageMs (SQLite 内部 UTC ✓).
async function checkReactorCron(db) {
  const latest = db.prepare(`
    SELECT created_at, (julianday('now') - julianday(MAX(created_at))) * 86400000 AS age_ms
    FROM bettor_adjustments
  `).get();
  if (!latest?.created_at) return { ok: true, detail: 'no adj rows yet (boot scenario)' };
  // Also gate by OPEN positions — 0 OPEN = reactor 不该有 adj, 不 alert
  const openCount = db.prepare("SELECT COUNT(*) c FROM bettor_sim_positions WHERE closed_at IS NULL AND direction != 'SKIP' AND size_usd > 0").get();
  if ((openCount?.c || 0) === 0) return { ok: true, detail: '0 OPEN positions — reactor idle by design' };
  const ageMin = Math.round((latest.age_ms || 0) / 60_000);
  if (ageMin > 90) return { ok: false, detail: `reactor adj 最新 ${ageMin}min ago > 90min threshold (OPEN=${openCount.c})` };
  return { ok: true, detail: `latest adj ${ageMin}min ago (OPEN=${openCount.c})` };
}

async function checkScannerCron(db) {
  const latest = db.prepare(`
    SELECT MAX(scanned_at) AS t, (julianday('now') - julianday(MAX(scanned_at))) * 86400000 AS age_ms
    FROM bettor_recommendations
  `).get();
  if (!latest?.t) return { ok: true, detail: 'no rec rows yet' };
  const ageH = (latest.age_ms || 0) / 3_600_000;
  if (ageH > 7) return { ok: false, detail: `scanner rec 最新 ${ageH.toFixed(1)}h ago > 7h threshold` };
  return { ok: true, detail: `latest rec ${ageH.toFixed(1)}h ago` };
}

async function checkLanIpHealth(db) {
  // 看 lan-ip-health.log 最新 mtime
  try {
    const { statSync } = await import('node:fs');
    const stat = statSync(`${KANET_ROOT}/logs/lan-ip-health.log`);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > 25 * 60_000) return { ok: false, detail: `lan-ip log mtime ${Math.round(ageMs/60000)}min ago > 25min threshold` };
    return { ok: true, detail: `mtime ${Math.round(ageMs/60000)}min ago` };
  } catch (e) {
    return { ok: false, detail: `lan-ip log missing: ${e.message?.slice(0, 50)}` };
  }
}

async function checkAdapter3018() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch('http://127.0.0.1:3018/health', { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false, detail: `HTTP ${r.status}` };
    return { ok: true, detail: 'health 200' };
  } catch (e) { return { ok: false, detail: e.message?.slice(0, 60) }; }
}

async function checkConsoleDbLatency(db) {
  // Sub 9.7 hotfix: 原查 agents 表不存在 (实际 schema 是 agent_wallets/agent_connections).
  // 改 query sqlite_master (always exists, 测 SQLite engine latency).
  const start = Date.now();
  try {
    db.prepare("SELECT COUNT(*) FROM sqlite_master").get();
    const elapsed = Date.now() - start;
    if (elapsed > 500) return { ok: false, detail: `DB query ${elapsed}ms > 500ms threshold` };
    return { ok: true, detail: `${elapsed}ms` };
  } catch (e) { return { ok: false, detail: e.message?.slice(0, 60) }; }
}

// ── cooldown + dispatch ─────────────────────────────────────────────────────────

function inCooldown(db, alertKey) {
  const r = db.prepare("SELECT MAX(created_at) AS t FROM health_alert_log WHERE alert_key = ? AND created_at > datetime('now', '-1 hour')").get(alertKey);
  return !!r?.t;
}

function hardCapHit(db) {
  const hourCount = db.prepare("SELECT COUNT(*) AS c FROM health_alert_log WHERE created_at > datetime('now', '-1 hour')").get();
  if ((hourCount?.c || 0) >= HARD_CAP_PER_HOUR) return 'hour';
  const dayCount = db.prepare("SELECT COUNT(*) AS c FROM health_alert_log WHERE created_at > datetime('now', '-24 hours')").get();
  if ((dayCount?.c || 0) >= HARD_CAP_PER_DAY) return 'day';
  return null;
}

async function dispatchAlert(db, alertKey, severity, detail) {
  if (inCooldown(db, alertKey)) { log(`alert SUPPRESSED (1h cooldown): ${alertKey} - ${detail}`); return; }
  const cap = hardCapHit(db);
  if (cap) { log(`alert SUPPRESSED (hard cap ${cap}): ${alertKey} - ${detail}`); return; }

  let dispatchedTo = 'log';
  let broadcastTxId = null;

  if (severity === 'WARN') {
    dispatchedTo = 'log+stdout';
    log(`⚠ WARN [${alertKey}] ${detail}`);
  } else if (severity === 'CRITICAL') {
    dispatchedTo = 'log+stdout+broadcast';
    log(`🚨 CRITICAL [${alertKey}] ${detail} — broadcasting dev-coord`);
    try {
      const res = await fetch(`${CONSOLE_URL}/api/chat/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relayId: BROADCAST_RELAY,
          channel: 'dev-coord',
          message: `🚨 [health-alert] CRITICAL ${alertKey} — ${detail} (Phase 3g C-1 watch)`,
        }),
      });
      const j = await res.json().catch(() => ({}));
      broadcastTxId = j?.txId || null;
      log(`broadcast ${res.status} ${broadcastTxId ? `TX ${broadcastTxId.slice(0, 12)}` : '(no tx)'}`);
    } catch (e) { log(`broadcast err: ${e.message?.slice(0, 80)}`); }
  } else { log(`[${alertKey}] ${detail}`); }

  db.prepare(`INSERT INTO health_alert_log (alert_key, severity, detail_json, dispatched_to, broadcast_tx_id) VALUES (?, ?, ?, ?, ?)`)
    .run(alertKey, severity, JSON.stringify({ detail }), dispatchedTo, broadcastTxId);
}

// ── tick ────────────────────────────────────────────────────────────────────────

async function tick() {
  const db = new Database(DB_PATH);
  try {
    for (const w of WATCH_KEYS) {
      let result;
      try { result = await w.check(db); } catch (e) { result = { ok: false, detail: `check err: ${e.message?.slice(0, 60)}` }; }
      const existing = db.prepare("SELECT consecutive_fails FROM health_heartbeats WHERE key = ?").get(w.key);
      const prevFails = existing?.consecutive_fails || 0;
      const newFails = result.ok ? 0 : prevFails + 1;
      db.prepare(`INSERT INTO health_heartbeats (key, last_ts, last_status, expected_interval_ms, consecutive_fails, updated_at)
                  VALUES (?, datetime('now'), ?, ?, ?, datetime('now'))
                  ON CONFLICT(key) DO UPDATE SET last_ts = excluded.last_ts, last_status = excluded.last_status,
                  expected_interval_ms = excluded.expected_interval_ms, consecutive_fails = excluded.consecutive_fails, updated_at = excluded.updated_at`)
        .run(w.key, result.ok ? 'OK' : 'FAIL', w.intervalMs, newFails);

      if (!result.ok && newFails >= CRITICAL_FAIL_THRESHOLD) {
        await dispatchAlert(db, w.key, w.severityOnFail, `${newFails} 连续 fail: ${result.detail}`);
      } else if (result.ok && prevFails >= CRITICAL_FAIL_THRESHOLD) {
        log(`✓ RECOVERY [${w.key}] after ${prevFails} fails: ${result.detail}`);
      }
    }
  } finally { db.close(); }
}

log(`Phase 3g C-1 health-monitor starting · 5 watch keys · 1min cron · cooldown 1h/${HARD_CAP_PER_HOUR}h/${HARD_CAP_PER_DAY}d`);
await tick();
setInterval(async () => { try { await tick(); } catch (e) { log(`tick err: ${e.message?.slice(0, 80)}`); } }, TICK_MS);
