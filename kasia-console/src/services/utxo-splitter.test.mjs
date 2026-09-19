// utxo-splitter.test.mjs — regression guard for 账本1459(闸3阻断修复): autoSplitAll() must never send
// split_utxo to the prototype-v0 relay (id === PROTO_RELAY_ID, or name starting with 'proto-') — the
// proto-v0 canary manages its own UTXO shape via the execution page (see docs/provenance/2026-09-15-j2-
// d020-register-append-fee-formula-fix/recompute-fixed-cost.mjs for the real minimum-viable fee-input
// thresholds this shape depends on). Splitting it to TARGET_UTXO_COUNT=8 would leave every UTXO too
// small for any real bet's fee input (first-bet minimum ~0.925-0.93 KAS under the exact mass gate -- corrected 2026-09-19; the original "~0.56-0.82 KAS" came from an older local estimate), permanently breaking the canary and
// wasting a split fee, and it is guaranteed to fire because gate-3 (opening PROTO_DRIVER_ENABLED)
// requires a console restart, which is exactly when autoSplitAll() runs.
//
// Uses node:test's mock.module to replace relay-manager.js's sendCommandAsync with a call-recording
// stub (same technique already proven in pbs8-signreq-byzantine-handler.test.mjs) — real DB (temp
// SQLite via DB_PATH, migrated fresh), real autoSplitAll()/splitUtxos() code, only the relay IPC boundary
// is stubbed (Console never talks to a real relay process in a unit test).
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
const { autoSplitAll } = await import('./utxo-splitter.js');

function insertRelay({ id, name }) {
  const now = new Date().toISOString();
  // relay_nodes.address 有 UNIQUE 部分索引(v144) — 每行必须给不同地址, 否则第二行 INSERT 撞约束。
  sqlite.prepare(`INSERT INTO relay_nodes (id, name, mnemonic_encrypted, address, network, created_at, updated_at)
    VALUES (?, ?, 'enc-blob', ?, 'mainnet', ?, ?)`).run(id, name, `kaspatest:fake-${id.slice(0, 8)}`, now, now);
}

test('autoSplitAll: PROTO_RELAY_ID (by id, ordinary name) is skipped, zero sendCommandAsync calls for it', async () => {
  calls.length = 0;
  sqlite.prepare('DELETE FROM relay_nodes').run();
  const protoId = randomUUID();
  process.env.PROTO_RELAY_ID = protoId;
  insertRelay({ id: protoId, name: 'Canary-Proto-Relay' }); // name deliberately does NOT start with 'proto-'
  await autoSplitAll();
  assert.strictEqual(calls.filter(c => c.relayId === protoId).length, 0, 'PROTO_RELAY_ID must receive zero split_utxo commands even when its name does not carry the proto- prefix');
  delete process.env.PROTO_RELAY_ID;
});

test('autoSplitAll: name starting with "proto-" is skipped, zero sendCommandAsync calls for it', async () => {
  calls.length = 0;
  sqlite.prepare('DELETE FROM relay_nodes').run();
  delete process.env.PROTO_RELAY_ID; // no env override — must be caught by the name prefix alone
  const id = randomUUID();
  insertRelay({ id, name: 'proto-canary-relay' });
  await autoSplitAll();
  assert.strictEqual(calls.filter(c => c.relayId === id).length, 0, 'a relay named proto-* must receive zero split_utxo commands even with PROTO_RELAY_ID unset');
});

test('autoSplitAll: an ordinary relay (neither PROTO_RELAY_ID nor proto- prefixed) still gets split_utxo — behavior unchanged', async () => {
  calls.length = 0;
  sqlite.prepare('DELETE FROM relay_nodes').run();
  delete process.env.PROTO_RELAY_ID;
  const id = randomUUID();
  insertRelay({ id, name: 'FaucetRelay-ordinary' });
  await autoSplitAll();
  assert.strictEqual(calls.filter(c => c.relayId === id).length, 1, 'an ordinary relay must still receive exactly one split_utxo command (no regression to existing behavior)');
});

test('autoSplitAll: mixed set — proto relay (by id) skipped, ordinary relay still split, in the same tick', async () => {
  calls.length = 0;
  sqlite.prepare('DELETE FROM relay_nodes').run();
  const protoId = randomUUID();
  const ordinaryId = randomUUID();
  process.env.PROTO_RELAY_ID = protoId;
  insertRelay({ id: protoId, name: 'Canary-Proto-Relay' });
  insertRelay({ id: ordinaryId, name: 'FaucetRelay-ordinary' });
  await autoSplitAll();
  assert.strictEqual(calls.filter(c => c.relayId === protoId).length, 0, 'proto relay still zero calls when mixed with an ordinary relay in the same tick');
  assert.strictEqual(calls.filter(c => c.relayId === ordinaryId).length, 1, 'ordinary relay unaffected by the proto exclusion of a sibling row');
  delete process.env.PROTO_RELAY_ID;
});

test.after(() => {
  try { sqlite.close(); } catch {}
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});
