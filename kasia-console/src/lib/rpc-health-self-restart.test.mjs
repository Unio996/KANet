// rpc-health-self-restart.test.mjs — regression guard for the wasm-trap self-restart addition
// (2026-08-22, KANet-UI, Bettor (612) P1 scoping + P1 diff sign-off).
//
// Scope: does NOT exercise the actual process.exit(1) call itself (killing the test runner proves
// nothing useful and would need its own re-exec sandbox). Covers the two gating conditions with
// REAL (non-mocked) evidence — a stubbed "supervisor alive" check would only prove the stub works,
// not that the actual Get-CimInstance predicate this module runs does (memory:
// feedback-real-adversarial-review-no-form-no-shortcuts).
//
// SELF_RESTART_ENABLED and SELF_RESTART_CONFIRM_MS are module-level consts read once at import —
// toggling process.env mid-process after import has no effect. Each configuration under test
// therefore gets its own child-process re-exec with its own env + its own throwaway migrated DB
// (same bootstrap pattern as the sibling rpc-health-degradation-alert.test.mjs, split into stages).
import { execSync, spawnSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const STAGE = process.env._RPCSELFRESTART_STAGE || '';

if (STAGE === '') {
  // Orchestrator: run each stage as its own child process with its own env + own temp DB, then
  // aggregate exit codes. No module under test is imported in this outer process.
  function runStage(stage, extraEnv) {
    const tmpDb = `${process.env.TEMP || '/tmp'}/_kanetui_rpcselfrestart_${stage}_${process.pid}.db`;
    try { fs.unlinkSync(tmpDb); } catch {}
    execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
    const r = spawnSync(process.execPath, [process.argv[1]], {
      cwd: process.cwd(), stdio: 'inherit',
      env: { ...process.env, DB_PATH: tmpDb, _RPCSELFRESTART_STAGE: stage, ...extraEnv },
    });
    try { fs.unlinkSync(tmpDb); } catch {}
    return r.status ?? 1;
  }

  const results = [
    runStage('oscheck', {}),                                                          // (a)
    runStage('disabled', {}),                                                          // (b) SELF_RESTART unset
    runStage('withheld', { RPC_HEALTH_SELF_RESTART: '1', RPC_HEALTH_SELF_RESTART_CONFIRM_MS: '1000' }), // (c)
  ];
  process.exit(results.every((c) => c === 0) ? 0 : 1);
}

const { sqlite } = await import('../db/client.js');
const { randomUUID } = await import('node:crypto');
const { rpcHealthAlertTick, _resetAlertStateForTest, _isSupervisorAlive } = await import('./rpc-health-degradation-alert.mjs');

let fails = 0;
function check(label, cond) {
  console.log(`  ${cond ? '✅' : '❌'} ${label}`);
  if (!cond) fails++;
}

function insertFailEvent(minutesAgo = 0) {
  sqlite.prepare(`
    INSERT INTO events (id, event_scope, event_type, source, level, summary, payload_json, created_at)
    VALUES (?, 'system', 'rpc_health_check_failed', 'rpc-health', 'warn', 'test', '{}', datetime('now', ?))
  `).run(randomUUID(), `-${minutesAgo} minutes`);
}

let fetchCalls = [];
globalThis.fetch = async (url, opts) => {
  fetchCalls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
  return { ok: true, json: async () => ({ ok: true, txId: 'mock-tx' }) };
};

if (STAGE === 'oscheck') {
  // ---------- (a) _isSupervisorAlive real positive+negative control ----------
  console.log('[test] _isSupervisorAlive real OS-process control (no mocking — genuine Get-CimInstance query):');
  const before = await _isSupervisorAlive();
  check('before spawning a matching process: not confirmed alive', before === false);

  // Spawn a real bash.exe whose full command line contains the exact substrings the predicate
  // looks for ('kanet-console-supervisor.sh' + '_run'), indistinguishable to the query from the
  // real supervisor's own invocation shape (nohup bash "$0" _run).
  const fakeScript = path.join(process.env.TEMP || '/tmp', `kanet-console-supervisor.sh`);
  fs.writeFileSync(fakeScript, '#!/bin/bash\nsleep 6\n');
  const child = spawn('C:\\Program Files\\Git\\bin\\bash.exe', [fakeScript, '_run'], { stdio: 'ignore', detached: false });

  await new Promise((r) => setTimeout(r, 800)); // let WMI register the new process
  const during = await _isSupervisorAlive();
  check('while the matching process is alive: confirmed alive', during === true);

  // child.kill() (SIGTERM) does not reliably terminate a spawned bash.exe on Windows (matches
  // in-project lesson on Windows process-tree behavior — a plain kill() is not enough); use a
  // forceful native taskkill on the whole tree, then POLL _isSupervisorAlive() to confirm actual
  // death instead of trusting a single fixed-delay check (an earlier version of this test used one
  // fixed 1500ms wait and it was flaky/wrong: the process was still alive at that point and — worse
  // — leaked into the next stage's "supervisor absent" assumption, which is exactly the kind of
  // silent test-isolation bug this discipline exists to catch).
  try { execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' }); } catch {}
  let after = true;
  for (let i = 0; i < 10 && after; i++) {
    await new Promise((r) => setTimeout(r, 500));
    after = await _isSupervisorAlive();
  }
  check('after force-killing the matching process: no longer confirmed alive', after === false);
  try { fs.unlinkSync(fakeScript); } catch {}
}

if (STAGE === 'disabled') {
  // ---------- (b) self-restart disabled by default (RPC_HEALTH_SELF_RESTART unset) ----------
  console.log('[test] self-restart default OFF — sustained degradation never attempts it:');
  _resetAlertStateForTest();
  for (let i = 0; i < 6; i++) insertFailEvent(1); // over threshold, ~1min "old" episode
  await rpcHealthAlertTick();
  const selfRestartRelated = fetchCalls.some((c) => /自退/.test(c.body?.message || ''));
  check('onset alert fired (baseline sanity)', fetchCalls.length === 1);
  check('no self-restart-related post when SELF_RESTART_ENABLED unset', !selfRestartRelated);
}

if (STAGE === 'withheld') {
  // ---------- (c) ENABLED + confirm threshold elapsed + supervisor genuinely NOT running ----------
  // RPC_HEALTH_SELF_RESTART_CONFIRM_MS=1000 (set by the orchestrator) makes the ~1min-old episode
  // below trivially exceed the confirm threshold on the very first tick. No process matching the
  // supervisor predicate exists in this sandbox (real absence, not a stub) → must fail-closed.
  console.log('[test] self-restart ENABLED + confirm threshold elapsed + supervisor genuinely absent → withhold, no exit:');
  _resetAlertStateForTest();
  for (let i = 0; i < 6; i++) insertFailEvent(1);
  await rpcHealthAlertTick();
  const withheld = fetchCalls.some((c) => /supervisor 未确认活着/.test(c.body?.message || ''));
  const selfRestarted = fetchCalls.some((c) => /即将 process\.exit/.test(c.body?.message || ''));
  check('withholding alert fired (supervisor absent, real not mocked)', withheld);
  check('did NOT claim self-restart was performed', !selfRestarted);
  check('process did not exit (still executing this line)', true);
}

console.log(fails === 0 ? `✅ all checks passed [stage=${STAGE}]` : `❌ ${fails} check(s) failed [stage=${STAGE}]`);
process.exit(fails === 0 ? 0 : 1);
