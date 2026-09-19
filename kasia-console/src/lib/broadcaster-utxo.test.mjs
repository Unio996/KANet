// broadcaster-utxo.test.mjs — D-026 M1 (NWT de2ded3d / design v0.2 §7.1, acceptance V8).
// startBroadcasterUtxoMaintainerCron() is OFF unless BROADCASTER_UTXO_MAINTAIN is the literal string '1'.
// Off ⇒ no timer registered, no DB access, no relay IPC, exactly one `[broadcaster-utxo] disabled (...)` line with raw=.
// On  ⇒ the pre-existing `started — tick=180000ms target=30 ...` line appears and the cron behaves as before
//        (first tick after the 90 s grace forces a split_utxo targetCount=30 on an is_oracle=1 relay). That positive control
//        is what stops the closed-state tests from being vacuous.
// The on-demand export ensureBroadcasterUtxos() is a caller-driven path and is deliberately NOT gated (asserted below).
//
// Real DB (temp SQLite via DB_PATH, migrated fresh) + node:test mock timers; only the relay IPC boundary is stubbed.
// Run: cd kasia-console && node --experimental-test-module-mocks --test src/lib/broadcaster-utxo.test.mjs

import { test, mock } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// 前提(NWT 合入审 S3 / J2 2026-09-20): 本测试用 node:test 的 mock.module, 它只在 `--experimental-test-module-mocks` 下存在。
// 没带 flag 时下面第一次用到 mock.module 会得到裸的 `TypeError: mock.module is not a function`——上面 Run 行写了 flag, 但读的人不一定读到。
// 所以在做任何有副作用的事(建临时目录、跑迁移)之前先检查: 缺前提就说明缺什么、怎么跑, exit 1。
// ⟦PREREQ-CHECK-BEGIN⟧
if (typeof mock.module !== 'function') {
  console.error('[broadcaster-utxo.test] 前提不满足: node:test 的 mock.module 不可用——本测试必须带 --experimental-test-module-mocks 运行。');
  console.error('  正确运行: cd kasia-console && node --experimental-test-module-mocks --test src/lib/broadcaster-utxo.test.mjs');
  process.exit(1);
}
// ⟦PREREQ-CHECK-END⟧

const tmpDir = mkdtempSync(join(tmpdir(), 'kanetui-broadcaster-utxo-test-'));
const DB_PATH = join(tmpDir, 'console.db');
process.env.DB_PATH = DB_PATH;
execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH }, stdio: 'pipe' });
// this file must not depend on ambient env for the target set
delete process.env.BROADCASTER_RELAY_IDS; delete process.env.POOL_SEEDER_MAKER_RELAY; delete process.env.PROTO_RELAY_ID;

const calls = [];
async function mockSendCommandAsync(relayId, cmd) {
  calls.push({ relayId, cmd });
  return { ok: true, split: true, utxosBefore: 1, utxosAfter: 30, txId: 'deadbeefdeadbeef' };
}
mock.module('../services/relay-manager.js', { namedExports: { sendCommandAsync: mockSendCommandAsync } });

const { sqlite } = await import('../db/client.js');
const { startBroadcasterUtxoMaintainerCron, stopBroadcasterUtxoMaintainerCron, ensureBroadcasterUtxos, BROADCASTER_UTXO_MAINTAIN_ENV } = await import('./broadcaster-utxo.mjs');

const ENV = BROADCASTER_UTXO_MAINTAIN_ENV;
assert.strictEqual(ENV, 'BROADCASTER_UTXO_MAINTAIN', 'env key name is part of the D-026 contract');
const ENV_BEFORE_FILE = Object.prototype.hasOwnProperty.call(process.env, ENV) ? process.env[ENV] : undefined;
function setEnv(v) { if (v === undefined) delete process.env[ENV]; else process.env[ENV] = v; }

function insertOracleRelay({ id, name }) {
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO relay_nodes (id, name, mnemonic_encrypted, address, network, created_at, updated_at, is_oracle)
    VALUES (?, ?, 'enc-blob', ?, 'mainnet', ?, ?, 1)`).run(id, name, `kaspatest:fake-${id.slice(0, 8)}`, now, now);
}
async function captureLogs(fn) {
  const lines = []; const orig = console.log;
  console.log = (...a) => { lines.push(a.map(String).join(' ')); };
  try { const ret = await fn(); return { ret, lines }; } finally { console.log = orig; }
}
const flush = () => new Promise((r) => setImmediate(r));

const CLOSED_VALUES = [undefined, '0', 'true', ' 1', 'yes', '', '01', '１', '1\n', '"1"', 'TRUE', '1 '];

for (const v of CLOSED_VALUES) {
  test(`(V8) gate closed for ${v === undefined ? 'UNSET' : JSON.stringify(v)}: no timer, zero IPC, zero DB access, exactly one disabled line with raw=`, async (t) => {
    calls.length = 0;
    sqlite.prepare('DELETE FROM relay_nodes').run();
    insertOracleRelay({ id: randomUUID(), name: 'OracleRelay-would-be-rebalanced-if-open' }); // a real target: only the gate keeps it out
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    const setI = mock.method(globalThis, 'setInterval');
    const setT = mock.method(globalThis, 'setTimeout');
    const prep = mock.method(sqlite, 'prepare');
    try {
      setEnv(v);
      const { lines } = await captureLogs(() => startBroadcasterUtxoMaintainerCron());
      t.mock.timers.tick(10 * 60 * 1000); await flush();   // ten minutes of mock time: a leaked timer would have fired by now
      assert.strictEqual(setI.mock.calls.length, 0, 'no setInterval registered');
      assert.strictEqual(setT.mock.calls.length, 0, 'no setTimeout registered');
      assert.strictEqual(calls.length, 0, 'zero relay IPC');
      assert.strictEqual(prep.mock.calls.length, 0, 'zero sqlite.prepare');
      assert.deepStrictEqual(lines, [`[broadcaster-utxo] disabled (${ENV}!=1, raw=${JSON.stringify(v)})`]);
    } finally { stopBroadcasterUtxoMaintainerCron(); prep.mock.restore(); setI.mock.restore(); setT.mock.restore(); setEnv(ENV_BEFORE_FILE); }
  });
}

test("(V8-control) env='1': started line appears unchanged, timers are registered, and the first tick after 90 s forces split_utxo target 30 on the is_oracle relay", async (t) => {
  calls.length = 0;
  sqlite.prepare('DELETE FROM relay_nodes').run();
  const id = randomUUID();
  insertOracleRelay({ id, name: 'OracleRelay-target' });
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try {
    process.env[ENV] = '1';
    const { lines } = await captureLogs(() => startBroadcasterUtxoMaintainerCron());
    assert.ok(lines.some(l => l.startsWith('[broadcaster-utxo] started — tick=180000ms target=30 UTXOs/broadcaster')), `expected the pre-existing started line, got ${JSON.stringify(lines)}`);
    assert.ok(!lines.some(l => l.includes('] disabled (')), 'no disabled line when enabled');
    assert.strictEqual(calls.length, 0, 'nothing sent before the 90 s grace');
    t.mock.timers.tick(90_000); await flush(); await flush();
    const mine = calls.filter(c => c.relayId === id);
    assert.strictEqual(mine.length, 1, 'exactly one split_utxo on the first tick');
    assert.deepStrictEqual(mine[0].cmd, { type: 'split_utxo', targetCount: 30, force: true }, 'the forced rebalance command shape is unchanged');
  } finally { stopBroadcasterUtxoMaintainerCron(); setEnv(ENV_BEFORE_FILE); }
});

test('(V8-ondemand) ensureBroadcasterUtxos() is a caller-driven path and is NOT affected by the cron switch', async () => {
  calls.length = 0;
  setEnv(undefined);
  const id = randomUUID();
  const r = await ensureBroadcasterUtxos(id, 30);
  assert.strictEqual(calls.filter(c => c.relayId === id).length, 1, 'the on-demand export still sends when the cron switch is off');
  assert.strictEqual(r.split, true);
  setEnv(ENV_BEFORE_FILE);
});

test.after(() => {
  setEnv(ENV_BEFORE_FILE);
  try { sqlite.close(); } catch {}
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// mutation checks (run by hand, then reverted):
//  M6  delete the early-return block in startBroadcasterUtxoMaintainerCron()  ⇒ every (V8) closed-value test RED (timers registered, IPC after 90 s)
//  M7  gate written loosely (`if (!process.env[ENV])`)                        ⇒ (V8) 'true' ' 1' 'yes' '01' '１' '1\n' '"1"' 'TRUE' '1 ' RED
//  M8  gate condition inverted                                                ⇒ (V8-control) RED
