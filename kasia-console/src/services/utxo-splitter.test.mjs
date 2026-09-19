// utxo-splitter.test.mjs — two things under test:
//  (A) 账本1459(闸3阻断修复) regression guard: autoSplitAll() must never send split_utxo to the prototype-v0 relay
//      (id === PROTO_RELAY_ID, or name starting with 'proto-') — the proto-v0 canary manages its own UTXO shape via the
//      execution page (see docs/provenance/2026-09-15-j2-d020-register-append-fee-formula-fix/recompute-fixed-cost.mjs).
//      Splitting it to TARGET_UTXO_COUNT=8 would leave every UTXO too small for any real bet's fee input (first-bet minimum
//      ~0.925-0.93 KAS under the exact mass gate -- corrected 2026-09-19), permanently breaking the canary and wasting a fee.
//  (B) D-026 startup switch: autoSplitAll() is OFF unless UTXO_AUTOSPLIT_ON_START is the literal string '1'.
//      Design: docs/2026-09-19-bettor-utxo-autosplit-startup-switch-design-v0.1.md (v0.2 body + §7; NWT de2ded3d).
//
// STRUCTURE (D26-M2 — the reason this file was rewritten): with the gate closed the (A) tests would still pass, because they
// only assert "the proto relay received 0 commands" — i.e. the 1459 guard would go silently empty. So:
//   * the env switch is set to '1' at FILE scope (restored in test.after, try/finally around every per-test change);
//   * every proto-skip test carries a POSITIVE CONTROL: an ordinary relay in the same tick must receive exactly 1 command
//     (proves the gate is open and the guard is really filtering);
//   * the closed state has its own tests (V1/V2) with every value NWT listed, plus a "sqlite.prepare never called" spy.
// Mutation checks are documented at the bottom of this file and were run for real (see the delivery receipt).
//
// Uses node:test's mock.module to replace relay-manager.js's sendCommandAsync with a call-recording stub (same technique as
// pbs8-signreq-byzantine-handler.test.mjs) — real DB (temp SQLite via DB_PATH, migrated fresh), real autoSplitAll()/splitUtxos()
// code, only the relay IPC boundary is stubbed.
//
// Run: cd kasia-console && node --experimental-test-module-mocks --test src/services/utxo-splitter.test.mjs

import { test, mock } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = mkdtempSync(join(tmpdir(), 'j2-utxo-splitter-test-'));
const DB_PATH = join(tmpDir, 'console.db');
process.env.DB_PATH = DB_PATH;
execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH }, stdio: 'pipe' });

const calls = [];
async function mockSendCommandAsync(relayId, cmd) {
  calls.push({ relayId, cmd });
  return { ok: true, split: true, utxosBefore: 1, utxosAfter: 8, fee: '0.0001' };
}
mock.module('./relay-manager.js', { namedExports: { sendCommandAsync: mockSendCommandAsync } });

const { sqlite } = await import('../db/client.js');
const { autoSplitAll, UTXO_AUTOSPLIT_ON_START_ENV } = await import('./utxo-splitter.js');

// ── file-scope env: the switch is ON for the (A) tests; restored to whatever it was when the file ends ──
const ENV = UTXO_AUTOSPLIT_ON_START_ENV;
assert.strictEqual(ENV, 'UTXO_AUTOSPLIT_ON_START', 'env key name is part of the D-026 contract');
const ENV_BEFORE_FILE = Object.prototype.hasOwnProperty.call(process.env, ENV) ? process.env[ENV] : undefined;
process.env[ENV] = '1';

function setEnv(v) { if (v === undefined) delete process.env[ENV]; else process.env[ENV] = v; }

function insertRelay({ id, name }) {
  const now = new Date().toISOString();
  // relay_nodes.address 有 UNIQUE 部分索引(v144) — 每行必须给不同地址, 否则第二行 INSERT 撞约束。
  sqlite.prepare(`INSERT INTO relay_nodes (id, name, mnemonic_encrypted, address, network, created_at, updated_at)
    VALUES (?, ?, 'enc-blob', ?, 'mainnet', ?, ?)`).run(id, name, `kaspatest:fake-${id.slice(0, 8)}`, now, now);
}

// capture console.log lines during fn (restores even if fn throws)
async function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => { lines.push(a.map(String).join(' ')); };
  try { const ret = await fn(); return { ret, lines }; } finally { console.log = orig; }
}

// ───────────────────────────── (A) 1459 guard — gate OPEN (env='1'), each with a positive control ─────────────────────────────

test('(A1) autoSplitAll: PROTO_RELAY_ID (by id, ordinary name) is skipped; an ordinary relay in the same tick IS split (positive control)', async () => {
  calls.length = 0;
  sqlite.prepare('DELETE FROM relay_nodes').run();
  const protoId = randomUUID();
  const controlId = randomUUID();
  process.env.PROTO_RELAY_ID = protoId;
  try {
    insertRelay({ id: protoId, name: 'Canary-Proto-Relay' }); // name deliberately does NOT start with 'proto-'
    insertRelay({ id: controlId, name: 'FaucetRelay-control' });
    await captureLogs(() => autoSplitAll());
    assert.strictEqual(calls.filter(c => c.relayId === controlId).length, 1, 'POSITIVE CONTROL: the ordinary relay must receive exactly 1 split_utxo (proves the gate is open and the loop ran)');
    assert.strictEqual(calls.filter(c => c.relayId === protoId).length, 0, 'PROTO_RELAY_ID must receive zero split_utxo commands even when its name does not carry the proto- prefix');
  } finally { delete process.env.PROTO_RELAY_ID; }
});

test('(A2) autoSplitAll: name starting with "proto-" is skipped; an ordinary relay in the same tick IS split (positive control)', async () => {
  calls.length = 0;
  sqlite.prepare('DELETE FROM relay_nodes').run();
  delete process.env.PROTO_RELAY_ID; // no env override — must be caught by the name prefix alone
  const id = randomUUID();
  const controlId = randomUUID();
  insertRelay({ id, name: 'proto-canary-relay' });
  insertRelay({ id: controlId, name: 'FaucetRelay-control' });
  await captureLogs(() => autoSplitAll());
  assert.strictEqual(calls.filter(c => c.relayId === controlId).length, 1, 'POSITIVE CONTROL: the ordinary relay must receive exactly 1 split_utxo');
  assert.strictEqual(calls.filter(c => c.relayId === id).length, 0, 'a relay named proto-* must receive zero split_utxo commands even with PROTO_RELAY_ID unset');
});

test('(A3) autoSplitAll: an ordinary relay (neither PROTO_RELAY_ID nor proto- prefixed) still gets split_utxo — behavior unchanged', async () => {
  calls.length = 0;
  sqlite.prepare('DELETE FROM relay_nodes').run();
  delete process.env.PROTO_RELAY_ID;
  const id = randomUUID();
  insertRelay({ id, name: 'FaucetRelay-ordinary' });
  await captureLogs(() => autoSplitAll());
  assert.strictEqual(calls.filter(c => c.relayId === id).length, 1, 'an ordinary relay must still receive exactly one split_utxo command (no regression to existing behavior)');
});

test('(A4) autoSplitAll: mixed set — proto relay (by id) skipped, ordinary relay still split, in the same tick', async () => {
  calls.length = 0;
  sqlite.prepare('DELETE FROM relay_nodes').run();
  const protoId = randomUUID();
  const ordinaryId = randomUUID();
  process.env.PROTO_RELAY_ID = protoId;
  try {
    insertRelay({ id: protoId, name: 'Canary-Proto-Relay' });
    insertRelay({ id: ordinaryId, name: 'FaucetRelay-ordinary' });
    await captureLogs(() => autoSplitAll());
    assert.strictEqual(calls.filter(c => c.relayId === protoId).length, 0, 'proto relay still zero calls when mixed with an ordinary relay in the same tick');
    assert.strictEqual(calls.filter(c => c.relayId === ordinaryId).length, 1, 'ordinary relay unaffected by the proto exclusion of a sibling row');
  } finally { delete process.env.PROTO_RELAY_ID; }
});

test("(V3) env='1': enabled line is logged, existing behaviour is unchanged, and the return object reports the split", async () => {
  calls.length = 0;
  sqlite.prepare('DELETE FROM relay_nodes').run();
  insertRelay({ id: randomUUID(), name: 'FaucetRelay-ordinary' });
  const { ret, lines } = await captureLogs(() => autoSplitAll());
  assert.ok(lines.includes(`[utxo-splitter] startup autosplit enabled (${ENV}=1)`), `expected the enabled line, got: ${JSON.stringify(lines)}`);
  assert.ok(!lines.some(l => l.includes('] disabled (')), 'no disabled line when enabled');
  assert.ok(lines.includes('[utxo-splitter] 1/1 accounts split'), 'the pre-existing summary line is still printed unchanged');
  assert.deepStrictEqual(ret, { ok: true, disabled: false, split: 1, total: 1 });
});

// ───────────────────────────── (B) D-026 gate CLOSED — V1 / V2 ─────────────────────────────
// Every non-'1' value must leave the splitter OFF: no relay IPC, no sqlite.prepare at all, exactly one log line carrying raw=.
// (V2 list from NWT: '0' 'true' ' 1' 'yes' '' '01' full-width '１' '1\n', plus unset.  Also '"1"' from the .ps1 injection note.)
const CLOSED_VALUES = [undefined, '0', 'true', ' 1', 'yes', '', '01', '１', '1\n', '"1"', 'TRUE', '1 '];

for (const v of CLOSED_VALUES) {
  test(`(V1/V2) gate closed for ${v === undefined ? 'UNSET' : JSON.stringify(v)}: zero relay IPC, zero sqlite.prepare, exactly one disabled line with raw=`, async () => {
    calls.length = 0;
    sqlite.prepare('DELETE FROM relay_nodes').run();
    insertRelay({ id: randomUUID(), name: 'FaucetRelay-would-be-split-if-open' }); // real candidate: only the gate keeps it out
    const prep = mock.method(sqlite, 'prepare');
    try {
      setEnv(v);
      const { ret, lines } = await captureLogs(() => autoSplitAll());
      assert.strictEqual(calls.length, 0, 'gate closed ⇒ sendCommandAsync must not be called at all');
      assert.strictEqual(prep.mock.calls.length, 0, 'gate closed ⇒ the early return is BEFORE sqlite.prepare (zero DB access)');
      assert.deepStrictEqual(lines, [`[utxo-splitter] disabled (${ENV}!=1, raw=${JSON.stringify(v)})`], 'exactly one line, with the raw value');
      assert.deepStrictEqual(ret, { ok: true, disabled: true, split: 0, total: 0 });
    } finally { prep.mock.restore(); process.env[ENV] = '1'; }
  });
}

test('(V2-control) the same fixture DOES split when env is exactly "1" — the closed-state tests are not vacuous', async () => {
  calls.length = 0;
  sqlite.prepare('DELETE FROM relay_nodes').run();
  const id = randomUUID();
  insertRelay({ id, name: 'FaucetRelay-would-be-split-if-open' });
  process.env[ENV] = '1';
  await captureLogs(() => autoSplitAll());
  assert.strictEqual(calls.filter(c => c.relayId === id).length, 1);
});

test.after(() => {
  if (ENV_BEFORE_FILE === undefined) delete process.env[ENV]; else process.env[ENV] = ENV_BEFORE_FILE;   // do not leak the file-scope '1' to anything else in this process
  try { sqlite.close(); } catch {}
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

// ───────────────────────────── mutation checks (run by hand; each must turn the named tests red, then be reverted) ─────────────────────────────
//  M1  delete the early-return block in autoSplitAll()                    ⇒ every (V1/V2) closed-value test RED
//  M2  gate written loosely (`if (!process.env[ENV])`)                    ⇒ (V1/V2) 'true' ' 1' 'yes' '01' '１' '1\n' '"1"' 'TRUE' '1 ' RED
//  M3  gate condition inverted (`=== '1'` returns disabled)                ⇒ (A1)-(A4) + (V3) RED (gate closed under env '1')
//  M4  with env='1', delete the _isProtoRelay early-`continue` block       ⇒ (A1) (A2) (A4) RED  ← proves the 1459 guard is not swallowed by the gate
//  M5  move the early return AFTER the sqlite.prepare(...)                 ⇒ (V1/V2) RED on `prep.mock.calls.length === 0`
