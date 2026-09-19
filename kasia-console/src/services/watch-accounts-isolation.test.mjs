// watch-accounts-isolation.test.mjs — D-028 A3/A4: 冷存(只读)账户【不进】任何"有钥集合"。真实临时库(真实迁移)+ 真实 autoSplitAll(),只桩 relay IPC 边界:
//   · autoSplitAll: sendCommandAsync 桩成"记录调用"(同 utxo-splitter.test.mjs 的既有技法;M0a 门禁止新增裸 relay-manager import,所以这里只 mock、不 import);
//   · startAll: 从 relay-manager.js 源码里取出它【真正执行】的账户列表 SQL 文本,在同一个临时库上跑——断言返回集合恰为有钥 relay(不 import relay-manager,不起任何进程)。
// 每条都带阳性对照(有钥 relay 恰好被选中),否则"冷存被选中 0 次"可能只是闸没开/循环没跑。
// Run: cd kasia-console && node --experimental-test-module-mocks --test src/services/watch-accounts-isolation.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

if (typeof mock.module !== 'function') { console.error('mock.module unavailable: run with --experimental-test-module-mocks'); process.exit(1); }
const tmpDir = mkdtempSync(join(tmpdir(), 'd028-isolation-test-'));
const DB_PATH = join(tmpDir, 'console.db');
process.env.DB_PATH = DB_PATH;
execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH }, stdio: 'pipe' });

const ipcCalls = [];
async function mockSendCommandAsync(relayId, cmd) { ipcCalls.push({ relayId, cmd }); return { ok: true, split: true, utxosBefore: 1, utxosAfter: 8, fee: '0.0001' }; }
mock.module('./relay-manager.js', { namedExports: { sendCommandAsync: mockSendCommandAsync } });
const { sqlite } = await import('../db/client.js');
const { autoSplitAll, UTXO_AUTOSPLIT_ON_START_ENV } = await import('./utxo-splitter.js');
test.after(() => { try { sqlite.close(); } catch { /* */ } rmSync(tmpDir, { recursive: true, force: true }); });

const ts = new Date().toISOString();
const keyed = ['k1', 'k2', 'k3'].map((n, i) => ({ id: randomUUID(), name: `Keyed-${n}`, address: `kaspa:qqkeyed${'0'.repeat(30)}${i}` }));
const cold = ['c1', 'c2'].map((n, i) => ({ id: randomUUID(), name: `Cold-${n}`, address: `kaspa:qqcoldwatch${'0'.repeat(25)}${i}` }));
for (const k of keyed) sqlite.prepare("INSERT INTO relay_nodes (id, name, mnemonic_encrypted, address, network, created_at, updated_at) VALUES (?, ?, 'enc-blob', ?, 'mainnet', ?, ?)").run(k.id, k.name, k.address, ts, ts);
// 一个"有地址但无钥"的 relay_nodes 行(今天的 relay_nodes 里不该有;放它是为证明有钥过滤真在起作用,是对照臂)
const keyless = { id: randomUUID(), name: 'Keyless-row', address: 'kaspa:qqkeyless00000000000000000000000000000000' };
sqlite.prepare("INSERT INTO relay_nodes (id, name, address, network, created_at, updated_at) VALUES (?, ?, ?, 'mainnet', ?, ?)").run(keyless.id, keyless.name, keyless.address, ts, ts);
for (const c of cold) sqlite.prepare("INSERT INTO watch_accounts (id, name, address, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(c.id, c.name, c.address, ts, ts);

test('A4 autoSplitAll (switch open): split_utxo goes to EXACTLY the keyed relays (positive control 3/3); never to a cold account or the keyless row, never with a cold address in any command', async () => {
  process.env[UTXO_AUTOSPLIT_ON_START_ENV] = '1'; ipcCalls.length = 0;
  const orig = console.log; console.log = () => {};
  try { await autoSplitAll(); } finally { console.log = orig; delete process.env[UTXO_AUTOSPLIT_ON_START_ENV]; }
  assert.deepStrictEqual(ipcCalls.map((c) => c.relayId).sort(), keyed.map((k) => k.id).sort(), 'exactly the keyed relays');
  const blob = JSON.stringify(ipcCalls);
  for (const c of cold) assert.ok(!blob.includes(c.id) && !blob.includes(c.address), 'a cold id/address must never appear in an IPC command');
});

// 取出 startAll 里 `sqlite.prepare(\`...\`)` 的真实 SQL 文本(源码文本,不 import relay-manager)
function startAllAccountSql() {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'relay-manager.js'), 'utf8');
  const fn = src.slice(src.indexOf('export async function startAll()'));
  const m = /const accounts = sqlite\.prepare\(\s*`([\s\S]*?)`\s*\)\.all\(\)/.exec(fn);
  assert.ok(m, 'could not locate the account-list query inside startAll (the source shape changed: update this extractor, do not delete the test)');
  return m[1];
}
test('A3 startAll: the account-list SQL it really runs selects EXACTLY the keyed relays (3 of 3) — not the keyless relay_nodes row, not the cold accounts', () => {
  const sql = startAllAccountSql();
  assert.ok(/mnemonic_encrypted IS NOT NULL/i.test(sql) && /privkey_encrypted IS NOT NULL/i.test(sql), 'the key filter is present');
  assert.ok(!/watch_accounts/i.test(sql), 'startAll never reads watch_accounts');
  const ids = sqlite.prepare(sql).all().map((r) => r.id).sort();
  assert.deepStrictEqual(ids, keyed.map((k) => k.id).sort());
  assert.ok(!ids.includes(keyless.id)); for (const c of cold) assert.ok(!ids.includes(c.id));
});
test('A4 no SQL run by autoSplitAll ever mentions watch_accounts (the table is unreachable from the spend path)', async () => {
  const stmts = [];
  const origPrepare = sqlite.prepare.bind(sqlite);
  sqlite.prepare = (sql) => { stmts.push(String(sql)); return origPrepare(sql); };
  process.env[UTXO_AUTOSPLIT_ON_START_ENV] = '1'; const orig = console.log; console.log = () => {};
  try { await autoSplitAll(); } finally { console.log = orig; delete process.env[UTXO_AUTOSPLIT_ON_START_ENV]; sqlite.prepare = origPrepare; }
  assert.ok(stmts.length > 0); assert.ok(!stmts.some((s) => /watch_accounts/i.test(s)));
});
