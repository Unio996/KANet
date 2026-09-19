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

// ── NWT D-026 SHOULD (de2ded3d review of 9c86a049): pin "the ONLY caller of ensureBroadcasterUtxos() is the same-file cron tick" ──
// ensureBroadcasterUtxos() is exported but NOT covered by the BROADCASTER_UTXO_MAINTAIN switch (it is caller-driven). If a
// future second caller appears — e.g. a pool-settle path "warming up" broadcasters — it would send `split_utxo force:true`
// (consolidate + resplit, real fees) while everyone believes the switch keeps this module quiet. This scan makes that a
// red test instead of a surprise. Non-test source only (tests legitimately call it); comment lines are ignored.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative, sep } from 'node:path';   // `join` is already imported at the top of this file

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');   // kasia-console/src/lib → repo root
const SKIP_DIRS = new Set(['node_modules', '.git', 'scratch', '.claude', 'logs', 'data', 'docs', 'dist', 'build']);
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(mjs|cjs|js|ts)$/.test(name)) yield p;
  }
}
function codeLinesMentioning(file, needle) {
  const hits = [];
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;   // comments do not count
    if (line.includes(needle)) hits.push({ line: i + 1, text: t });
  });
  return hits;
}

test('(D26-scan) ensureBroadcasterUtxos has exactly one caller: broadcasterUtxoTick() in broadcaster-utxo.mjs itself; no other non-test source references it', () => {
  const selfPath = join(REPO_ROOT, 'kasia-console', 'src', 'lib', 'broadcaster-utxo.mjs');
  const others = [];
  let scanned = 0;
  for (const f of walk(REPO_ROOT)) {
    scanned++;
    if (f === selfPath) continue;
    if (/\.test\.(mjs|cjs|js|ts)$/.test(f) || f.split(sep).includes('test') || f.split(sep).includes('test-framework')) continue;   // tests may call it
    const h = codeLinesMentioning(f, 'ensureBroadcasterUtxos');
    if (h.length) others.push(`${relative(REPO_ROOT, f)}:${h.map(x => x.line).join(',')}`);
  }
  assert.ok(scanned > 50, `the scan must actually have walked the repo (scanned ${scanned} files)`);
  assert.deepStrictEqual(others, [], `ensureBroadcasterUtxos referenced outside broadcaster-utxo.mjs — it is NOT covered by the ${ENV} switch, so a new caller needs its own gate (D-026): ${others.join(' | ')}`);
  // inside the module: the definition (export) + exactly one call, and the call sits inside broadcasterUtxoTick
  const src = readFileSync(selfPath, 'utf8');
  const hits = codeLinesMentioning(selfPath, 'ensureBroadcasterUtxos');
  assert.strictEqual(hits.length, 2, `expected exactly 2 code references (the export + the tick call), got: ${JSON.stringify(hits)}`);
  assert.ok(/export\s+async\s+function\s+ensureBroadcasterUtxos\s*\(/.test(src), 'the definition is the exported function');
  const tickBody = src.slice(src.indexOf('export async function broadcasterUtxoTick'), src.indexOf('export function startBroadcasterUtxoMaintainerCron'));
  assert.ok(/await\s+ensureBroadcasterUtxos\s*\(/.test(tickBody), 'the single call is inside broadcasterUtxoTick()');
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
