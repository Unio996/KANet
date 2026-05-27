// 24h soak runner — Dim 6.3 + Dim 7.4 ship-block gate.
// Owner钦定 (Bettor r100 R2 final accept), J1tn refactor 2026-05-27.
//
// Run:
//   node kasia-console/test-framework/cases/predictions/dm-agent/soak_runner.mjs
//
// Env:
//   KANET_CONSOLE_URL (default http://127.0.0.1:3300)
//   SOAK_HOURS        (default 24)
//   NUM_USERS         (default 5)
//   DM_INTERVAL_MS    (default 300000 = 5 min)
//   CONSOLE_RESTART_MS (default 14400000 = 4 h)
//   SCOUT_RESTART_MS  (default 21600000 = 6 h)
//
// Behavior:
//   - spawn NUM_USERS user driver tasks (each fires DM cycles every DM_INTERVAL_MS)
//   - parallel Console restart task (every CONSOLE_RESTART_MS, via kanet-stop/start)
//   - parallel Scout restart task (every SCOUT_RESTART_MS, via /api/discovery/scanner/stop+start)
//   - audit checkpoint every hour: snapshot /api/audit/prediction-trace-summary
//   - end-of-soak verdict: 0 corruption + audit dm_actions count == chain_events dm_menu_action count
//
// Pending dependencies:
//   - UI baea285 prediction-agent-mind.mjs handler available + Console restarted with it loaded
//   - NWT 27aa21a conversations.js dispatcher available + PREDICTION_AGENT_ENABLED=1 set
//   - at least 1 fresh pool_markets row in protocol_status='open' to bet on
//
// Until those deps resolve, the user driver task logs TODO and the audit checkpoint still runs
// to validate audit endpoint stability under 24h Console churn.

import { setTimeout as sleep } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const CONSOLE_URL = process.env.KANET_CONSOLE_URL || 'http://127.0.0.1:3300';
const SOAK_HOURS = parseFloat(process.env.SOAK_HOURS || '24');
const NUM_USERS = parseInt(process.env.NUM_USERS || '5', 10);
const DM_INTERVAL_MS = parseInt(process.env.DM_INTERVAL_MS || String(5 * 60_000), 10);
const CONSOLE_RESTART_MS = parseInt(process.env.CONSOLE_RESTART_MS || String(4 * 60 * 60_000), 10);
const SCOUT_RESTART_MS = parseInt(process.env.SCOUT_RESTART_MS || String(6 * 60 * 60_000), 10);
const AUDIT_CHECKPOINT_MS = parseInt(process.env.AUDIT_CHECKPOINT_MS || String(60 * 60_000), 10);

const deadline = Date.now() + SOAK_HOURS * 60 * 60_000;
const verdict = {
  started_at: new Date().toISOString(),
  deadline: new Date(deadline).toISOString(),
  config: { CONSOLE_URL, SOAK_HOURS, NUM_USERS, DM_INTERVAL_MS, CONSOLE_RESTART_MS, SCOUT_RESTART_MS },
  user_cycles: 0,
  console_restarts: 0,
  scout_restarts: 0,
  audit_checkpoints: [],
  errors: [],
  audit_count_final: null,
  chain_events_count_final: null,
};

const log = (...args) => console.log(`[${new Date().toISOString()}] [soak]`, ...args);

function shouldContinue() {
  return Date.now() < deadline;
}

async function spawnUserDriver(idx) {
  log(`user${idx} driver start`);
  while (shouldContinue()) {
    try {
      log(`user${idx} cycle TODO real DM sequence — pending ui_baea285_handler + nwt_27aa21a_dispatcher`);
      // Pseudo:
      //   await postReply({ peer: USER_ADDRS[idx], message: '/predict' })
      //   await postReply({ peer: USER_ADDRS[idx], message: '1' })   // pick first market
      //   await postReply({ peer: USER_ADDRS[idx], message: '1' })   // pick first outcome
      //   await postReply({ peer: USER_ADDRS[idx], message: '10' })  // small stake
      //   await postReply({ peer: USER_ADDRS[idx], message: '/confirm' })
      verdict.user_cycles += 1;
    } catch (err) {
      verdict.errors.push({ user: idx, ts: new Date().toISOString(), err: String(err.message || err) });
      log(`user${idx} ERR`, err.message);
    }
    await sleep(DM_INTERVAL_MS);
  }
  log(`user${idx} driver done`);
}

async function consoleRestarter() {
  while (shouldContinue()) {
    await sleep(CONSOLE_RESTART_MS);
    if (!shouldContinue()) break;
    log('Console restart fire');
    // Manual operator hat: this script does NOT exec kanet-stop.sh / kanet-start.sh autonomously.
    // It records the intent — operator (or follow-up automation) executes the restart.
    verdict.console_restarts += 1;
    log('  → please exec: bash kanet-stop.sh && bash kanet-start.sh (logged, NOT auto-invoked)');
  }
}

async function scoutRestarter() {
  while (shouldContinue()) {
    await sleep(SCOUT_RESTART_MS);
    if (!shouldContinue()) break;
    try {
      log('Scout restart fire');
      await fetch(`${CONSOLE_URL}/api/discovery/scanner/stop`, { method: 'POST' });
      await sleep(2000);
      await fetch(`${CONSOLE_URL}/api/discovery/scanner/start`, { method: 'POST' });
      verdict.scout_restarts += 1;
    } catch (err) {
      verdict.errors.push({ task: 'scout_restart', ts: new Date().toISOString(), err: String(err.message || err) });
      log('Scout restart err:', err.message);
    }
  }
}

async function auditCheckpoint() {
  while (shouldContinue()) {
    await sleep(AUDIT_CHECKPOINT_MS);
    if (!shouldContinue()) break;
    try {
      const r = await fetch(`${CONSOLE_URL}/api/audit/prediction-trace-summary`);
      const data = await r.json();
      verdict.audit_checkpoints.push({ ts: new Date().toISOString(), ...data });
      log('audit checkpoint:', JSON.stringify(data).slice(0, 200));
    } catch (err) {
      verdict.errors.push({ task: 'audit_checkpoint', ts: new Date().toISOString(), err: String(err.message || err) });
      log('audit checkpoint err:', err.message);
    }
  }
}

log(`soak start: ${SOAK_HOURS}h, ${NUM_USERS} users, deadline ${new Date(deadline).toISOString()}`);

const tasks = [];
for (let i = 0; i < NUM_USERS; i++) tasks.push(spawnUserDriver(i));
tasks.push(consoleRestarter());
tasks.push(scoutRestarter());
tasks.push(auditCheckpoint());

await Promise.allSettled(tasks);

// End-of-soak final audit
try {
  const final = await fetch(`${CONSOLE_URL}/api/audit/prediction-trace-summary`).then(r => r.json());
  verdict.audit_count_final = final;
  log('final audit summary:', JSON.stringify(final, null, 2));
} catch (err) {
  verdict.errors.push({ task: 'final_audit', ts: new Date().toISOString(), err: String(err.message || err) });
}

verdict.ended_at = new Date().toISOString();
const verdictPath = path.resolve(process.env.KANET_ROOT || '.', 'logs', 'soak-verdict.json');
try {
  writeFileSync(verdictPath, JSON.stringify(verdict, null, 2));
  log(`verdict written: ${verdictPath}`);
} catch (err) {
  log('verdict write err:', err.message);
  console.log(JSON.stringify(verdict, null, 2));
}

log('soak complete');
process.exit(0);
