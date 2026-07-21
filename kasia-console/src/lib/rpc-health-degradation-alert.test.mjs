// rpc-health-degradation-alert.test.mjs — regression guard for the RPC health edge-trigger alert
// (docs/2026-07-21-rpc-health-degradation-alert-design.md, Bettor #utf9ze① / NWT GREEN-with-2-notes).
//
// Bootstrap pattern matches established precedent (bshard-payout-family-coherence.test.mjs): real schema
// via scripts/run-migrations.mjs against a throwaway temp DB, re-exec self in a child process with that
// DB_PATH so `sqlite` from db/client.js points at it — no hand-rolled fake schema (memory lesson:
// offline测试必须用带实实trigger的完整schema).
//
// fetch is mocked (globalThis.fetch override) so the test never makes a real network call to /api/chat/send —
// we assert the alert module CALLED fetch with the right body, not that a live console answered it.
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';

if (!process.env._RPCALERT_TEST_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_kanetui_rpcalert_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], {
    cwd: process.cwd(), stdio: 'inherit',
    env: { ...process.env, DB_PATH: tmpDb, _RPCALERT_TEST_BOOTSTRAPPED: '1' },
  });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}

const { sqlite } = await import('../db/client.js');
const { randomUUID } = await import('node:crypto');
const { rpcHealthAlertTick, _resetAlertStateForTest } = await import('./rpc-health-degradation-alert.mjs');

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

// mock fetch: capture calls, never hit network
let fetchCalls = [];
globalThis.fetch = async (url, opts) => {
  fetchCalls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
  return { ok: true, json: async () => ({ ok: true, txId: 'mock-tx' }) };
};

console.log('[test] below threshold — no alert, no fetch call:');
_resetAlertStateForTest();
fetchCalls = [];
for (let i = 0; i < 2; i++) insertFailEvent(1); // 2 events, default threshold=5
{
  const r = await rpcHealthAlertTick();
  check('tick reports degraded:false when below threshold', r.degraded === false);
  check('no channel post fired below threshold', fetchCalls.length === 0);
}

console.log('\n[test] crosses threshold — fires exactly once (edge-trigger, not every tick):');
sqlite.prepare("DELETE FROM events WHERE event_type='rpc_health_check_failed'").run();
_resetAlertStateForTest();
fetchCalls = [];
for (let i = 0; i < 5; i++) insertFailEvent(1); // 5 events == default threshold
{
  const r1 = await rpcHealthAlertTick();
  check('first tick over threshold reports degraded:true', r1.degraded === true);
  check('first tick over threshold fires exactly one channel post', fetchCalls.length === 1);
  check('posted message hits /api/chat/send with dev-coord-testnet channel', fetchCalls[0]?.body?.channel === 'dev-coord-testnet');
  check('posted message mentions RPC degradation', /RPC/.test(fetchCalls[0]?.body?.message || ''));

  const r2 = await rpcHealthAlertTick(); // still degraded, same episode — should NOT re-post
  check('second tick still degraded reports alreadyAlerted:true (no duplicate)', r2.alreadyAlerted === true);
  check('second tick does NOT fire another channel post', fetchCalls.length === 1);
}

console.log('\n[test] recovery resets edge-trigger, next degradation alerts again:');
sqlite.prepare("DELETE FROM events WHERE event_type='rpc_health_check_failed'").run();
{
  const rRecovered = await rpcHealthAlertTick(); // 0 events now → recovered
  check('tick after recovery reports degraded:false', rRecovered.degraded === false);
}
for (let i = 0; i < 5; i++) insertFailEvent(1); // degrade again
{
  const r3 = await rpcHealthAlertTick();
  check('re-degradation after recovery fires a NEW alert (edge re-armed)', fetchCalls.length === 2);
  check('re-degradation tick reports degraded:true', r3.degraded === true);
}

console.log('\n[test] events table actually persisted the onset event (not just in-memory):');
{
  const row = sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE event_type='rpc_health_degraded_onset'").get();
  check('rpc_health_degraded_onset events were written to the events table', row.n === 2); // one per episode above
}

console.log('\n[test] channel-post failure does not crash the tick (non-fatal, same discipline as settle-failed-alert):');
sqlite.prepare("DELETE FROM events WHERE event_type='rpc_health_check_failed'").run();
_resetAlertStateForTest();
globalThis.fetch = async () => { throw new Error('simulated network failure'); };
for (let i = 0; i < 5; i++) insertFailEvent(1);
{
  const r = await rpcHealthAlertTick();
  check('tick still returns ok:true even when the channel post itself throws', r.ok === true && r.degraded === true);
}

console.log(fails === 0 ? '\n✅ all checks passed' : `\n❌ ${fails} check(s) failed`);
process.exit(fails === 0 ? 0 : 1);
