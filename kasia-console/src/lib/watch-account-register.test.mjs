// watch-account-register.test.mjs — D-028: 登记只读(冷存)账户的逻辑 + 表 schema + CLI 的拒绝路径。
// 真实库: 临时 SQLite(DB_PATH)+ 真实迁移(scripts/run-migrations.mjs)+ import client.js(M0a 门: 测试拿库走 DB_PATH 临时库 + client.js,不裸 import better-sqlite3)。
// 验收对应: A2(去重含规范化)· A8(schema 不持钥)· A10(登记脚本卫生: 无命令行地址/名字、回执不含完整地址与名字、本地地址语义列只警告)。
// Run: cd kasia-console && node --test src/lib/watch-account-register.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = mkdtempSync(join(tmpdir(), 'd028-register-test-'));
const DB_PATH = join(tmpDir, 'console.db');
process.env.DB_PATH = DB_PATH;
execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH }, stdio: 'pipe' });
const { sqlite } = await import('../db/client.js');
const { parseInput, registerWatchAccounts, shortForm, LOCAL_ADDRESS_COLUMNS } = await import('./watch-account-register.mjs');
test.after(() => { try { sqlite.close(); } catch { /* */ } rmSync(tmpDir, { recursive: true, force: true }); });

// 行为照抄本机 kaspa-wasm 的实测: 只接受小写规范形式(大写 / 无前缀 / 带空白 validate=false);构造非法输入会 wasm panic。
class FakeAddress {
  static validate(s) { return /^(kaspa|kaspatest):[a-z0-9]{8,}$/.test(String(s)); }
  constructor(s) { if (!FakeAddress.validate(s)) throw new Error('unreachable'); this._s = String(s); }
  toString() { return this._s; }
}
const A1 = 'kaspa:qqwatch0000000000000000000000000000000001', A2 = 'kaspa:qqwatch0000000000000000000000000000000002', A3 = 'kaspa:qqwatch0000000000000000000000000000000003';
const HOT = 'kaspa:qqhotrelay00000000000000000000000000000001';
const count = (t) => sqlite.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
// 通用插行: 按 PRAGMA table_info 给 NOT NULL 无默认的列填占位值,再覆盖指定列
function insertLoose(table, over) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all();
  const row = {};
  for (const c of cols) if (c.notnull && c.dflt_value === null && !c.pk) row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : 'x';
  Object.assign(row, over);
  const names = Object.keys(row);
  sqlite.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...Object.values(row));
}
const reset = () => { sqlite.exec('DELETE FROM watch_accounts'); };
const entries = (...pairs) => pairs.map(([name, address, note], i) => ({ line: i + 1, name, address, note: note || null }));

// ---- A8 schema
test('A8 watch_accounts has NO key-bearing column and custody is pinned to cold_no_key by a CHECK', () => {
  const cols = sqlite.prepare('PRAGMA table_info(watch_accounts)').all().map((c) => c.name);
  assert.deepStrictEqual(cols.sort(), ['address', 'chain', 'created_at', 'custody', 'id', 'name', 'network', 'note', 'updated_at']);
  assert.ok(!cols.some((c) => /mnemonic|privkey|private|secret|seed|hint|key/i.test(c)), `no key-like column: ${cols}`);
  const ts = new Date().toISOString();
  assert.throws(() => sqlite.prepare("INSERT INTO watch_accounts (id,name,address,custody,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(randomUUID(), 'x', A1, 'hot', ts, ts), /CHECK/i);
  sqlite.prepare("INSERT INTO watch_accounts (id,name,address,created_at,updated_at) VALUES (?,?,?,?,?)").run(randomUUID(), 'x', A1, ts, ts);
  assert.strictEqual(sqlite.prepare('SELECT custody FROM watch_accounts').get().custody, 'cold_no_key');
  assert.throws(() => sqlite.prepare("INSERT INTO watch_accounts (id,name,address,created_at,updated_at) VALUES (?,?,?,?,?)").run(randomUUID(), 'y', A1, ts, ts), /UNIQUE/i);
  reset();
});

// ---- parseInput
test('parseInput: name<TAB>address[<TAB>note], comments/blank lines skipped, CRLF and lone CR handled, malformed lines reported by line number (never echoed)', () => {
  const r = parseInput(`# comment\r\ncold one\t${A1}\tfrom the old console\r\n\r\ncold two\t${A2}\rbroken line without tab\n\t${A3}\n`);
  assert.deepStrictEqual(r.map((x) => [x.line, x.name || null, x.address || null, x.note || null, x.error ? 'ERR' : '']), [[2, 'cold one', A1, 'from the old console', ''], [4, 'cold two', A2, null, ''], [5, null, null, null, 'ERR'], [6, null, null, null, 'ERR']]);
});

// ---- A10 回执 / dry-run / apply
test('dry-run (the default) writes NOTHING; the report has counts and short forms only — no full address, no name', () => {
  reset();
  const rep = registerWatchAccounts({ db: sqlite, entries: entries(['Secret Name One', A1], ['Secret Name Two', A2]), Address: FakeAddress });
  assert.strictEqual(rep.mode, 'dry-run'); assert.strictEqual(rep.applied, 0); assert.strictEqual(count('watch_accounts'), 0);
  assert.strictEqual(rep.accepted.length, 2); assert.strictEqual(rep.rejected.length, 0);
  const text = JSON.stringify(rep);
  assert.ok(!text.includes(A1) && !text.includes(A2) && !text.includes('Secret Name'), 'the report must not carry a full address or a name');
  assert.strictEqual(rep.accepted[0].short, shortForm(A1)); assert.match(rep.accepted[0].short, /^kaspa:qqwa\.\.\.000001$/);
});
test('apply writes the accepted rows: canonical address, custody cold_no_key, network mainnet, note kept', () => {
  reset();
  const rep = registerWatchAccounts({ db: sqlite, entries: entries(['one', A1, 'legacy cold storage'], ['two', A2]), apply: true, Address: FakeAddress });
  assert.strictEqual(rep.applied, 2); assert.strictEqual(count('watch_accounts'), 2);
  const rows = sqlite.prepare('SELECT name, chain, network, address, custody, note FROM watch_accounts ORDER BY name').all();
  assert.deepStrictEqual(rows, [{ name: 'one', chain: 'kaspa', network: 'mainnet', address: A1, custody: 'cold_no_key', note: 'legacy cold storage' }, { name: 'two', chain: 'kaspa', network: 'mainnet', address: A2, custody: 'cold_no_key', note: null }]);
});

// ---- A2 去重
test('A2 duplicate of a row already in watch_accounts is rejected (already_in_watch_accounts), and the rerun writes nothing', () => {
  const rep = registerWatchAccounts({ db: sqlite, entries: entries(['again', A1]), apply: true, Address: FakeAddress });
  assert.deepStrictEqual(rep.rejected.map((r) => r.reason), ['already_in_watch_accounts']); assert.strictEqual(rep.applied, 0); assert.strictEqual(count('watch_accounts'), 2);
});
test('A2 a HOT relay address (relay_nodes) and an agent_wallets address are rejected so hot money is never counted twice', () => {
  reset();
  insertLoose('relay_nodes', { id: 'r-hot', name: 'HotOne', address: HOT });
  insertLoose('agent_wallets', { id: 'aw1', relay_node_id: 'r-hot', chain: 'kaspa', address: A3 });
  const rep = registerWatchAccounts({ db: sqlite, entries: entries(['dup hot', HOT], ['dup wallet', A3], ['fine', A1]), apply: true, Address: FakeAddress });
  assert.deepStrictEqual(rep.rejected.map((r) => r.reason).sort(), ['already_in_agent_wallets', 'already_in_relay_nodes']);
  assert.strictEqual(rep.applied, 0, 'all-or-nothing: the fine line was NOT written either'); assert.strictEqual(count('watch_accounts'), 0);
});
test('A2 case/prefix/padding variants are rejected as invalid_address (kaspa-wasm accepts only the lower-case canonical form) — never handed to the constructor', () => {
  reset();
  const seen = []; const Spy = class extends FakeAddress { constructor(s) { seen.push(String(s)); super(s); } }; Spy.validate = FakeAddress.validate;
  const variants = [A1.toUpperCase(), A1.slice(6), ' ' + A1];
  const rep = registerWatchAccounts({ db: sqlite, entries: entries(['upper', variants[0]], ['noprefix', variants[1]], ['padded', variants[2]]), Address: Spy });
  assert.deepStrictEqual(rep.rejected.map((r) => r.reason), ['invalid_address', 'invalid_address', 'invalid_address']);
  assert.ok(!seen.some((x) => variants.includes(x)), `an invalid variant reached the constructor: ${JSON.stringify(seen)}`);   // (rows already in the DB are legitimately constructed; only the INPUT variants must never be)
});
test('A2 the same address twice in one input, a testnet prefix, and a bad line are all rejected; nothing is written', () => {
  reset();
  const rep = registerWatchAccounts({ db: sqlite, entries: [...entries(['a', A1], ['b', A1], ['t', 'kaspatest:qqtestnet000000000000000000000000000000001']), { line: 9, error: 'expected: name<TAB>address[<TAB>note]' }], apply: true, Address: FakeAddress });
  assert.deepStrictEqual(rep.rejected.map((r) => r.reason).sort(), ['bad_line: expected: name<TAB>address[<TAB>note]', 'duplicate_in_input', 'not_mainnet_kaspa_prefix'].sort());
  assert.strictEqual(rep.applied, 0); assert.strictEqual(count('watch_accounts'), 0);
});
test('unparseable addresses ALREADY in relay_nodes are skipped in the duplicate check but COUNTED and reported (not silently ignored)', () => {
  reset();
  insertLoose('relay_nodes', { id: 'r-old', name: 'OldStyle', address: 'KASPA:UPPERCASE00000000000000000000000000000001' });
  const rep = registerWatchAccounts({ db: sqlite, entries: entries(['ok', A1]), Address: FakeAddress });
  assert.ok(rep.skippedUnparseable.relay_nodes >= 1); assert.strictEqual(rep.accepted.length, 1);
});

// ---- A10 本地地址语义列: 只警告
test('A10 an address that appears in a local-address-semantic column is WARNED about (table.column + hit count, no address printed) and still accepted', () => {
  reset();
  insertLoose('reputation_summary', { address: A2 });
  const rep = registerWatchAccounts({ db: sqlite, entries: entries(['was a relay once', A2]), apply: true, Address: FakeAddress });
  assert.deepStrictEqual(rep.warnings.map((w) => [w.table, w.column, w.hits]), [['reputation_summary', 'address', 1]]);
  assert.strictEqual(rep.rejected.length, 0); assert.strictEqual(rep.applied, 1);
  assert.ok(!JSON.stringify(rep).includes(A2));
  assert.ok(LOCAL_ADDRESS_COLUMNS.some(([t, c]) => t === 'oracle_stake_enrollments' && c === 'relay_address'));
});
test('a missing table or column in the local-address list is skipped, not an error', () => {
  reset();
  const fake = { prepare: (sql) => ({ get: (...a) => sqlite.prepare(sql).get(...a), all: (...a) => sqlite.prepare(sql).all(...a) }), transaction: (f) => f };
  const rep = registerWatchAccounts({ db: fake, entries: entries(['x', A1]), Address: FakeAddress });
  assert.strictEqual(rep.accepted.length, 1);
});

// ---- CLI: 拒绝路径(全部在触库之前退出;真实 Address 的正路径由上面的库函数测试覆盖)
const CLI = join(process.cwd(), 'scripts', 'watch-account-register.mjs');
function cli(args, { env = {}, input = undefined } = {}) {
  const base = { ...process.env }; delete base.DB_PATH;
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...base, ...env }, input });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
test('A10 CLI: any address/name/positional argument is refused with exit 2 and the value is NEVER echoed', () => {
  for (const args of [['--address', A1], ['--name', 'Secret Name', '--from-file', 'x'], [A1], ['--from-file', join(tmpDir, 'in.txt'), '--address=' + A1]]) {
    const r = cli(args, { env: { DB_PATH } });
    assert.strictEqual(r.code, 2, args.join(' ')); assert.ok(!r.out.includes(A1) && !r.out.includes('Secret Name'), `echoed a value: ${r.out}`);
  }
});
test('A10 CLI: exactly one of --from-file / --stdin; DB_PATH required; the input file must live OUTSIDE the repository; --help exits 0', () => {
  assert.strictEqual(cli([], { env: { DB_PATH } }).code, 2);
  assert.strictEqual(cli(['--stdin', '--from-file', join(tmpDir, 'in.txt')], { env: { DB_PATH } }).code, 2);
  assert.strictEqual(cli(['--from-file', join(tmpDir, 'in.txt')]).code, 2, 'no DB_PATH');
  const inRepo = cli(['--from-file', CLI], { env: { DB_PATH } });
  assert.strictEqual(inRepo.code, 2); assert.match(inRepo.out, /OUTSIDE the repository/);
  assert.strictEqual(cli(['--help']).code, 0);
});
test('A10 CLI: the script contains no code path that prints a name or a full address (static)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(CLI, 'utf8');
  assert.ok(!/console\.log\([^)]*\b(e|entry|entries)\.(name|address)\b/.test(src), 'no print of entry name/address');
  assert.ok(/short/.test(src) && !/report\.accepted[^;]*\.(address|name|canon)/.test(src));
});

// ---- 真实 kaspa-wasm(可加载时): 假 Address 的行为声明不能漂离真库
test('real kaspa-wasm Address: only the lower-case canonical form validates; the register logic works end to end with it (skipped when kaspa-wasm cannot be loaded)', async (t) => {
  let wasm; try { wasm = await import('kaspa-wasm'); } catch { t.skip('kaspa-wasm not loadable here'); return; }
  const addr = new wasm.PrivateKey('0000000000000000000000000000000000000000000000000000000000000001').toKeypair().toAddress('mainnet').toString();   // the public well-known test key #1: not a holder
  assert.strictEqual(wasm.Address.validate(addr), true);
  for (const bad of [addr.toUpperCase(), 'kaspa:' + addr.slice(6).toUpperCase(), 'KASPA:' + addr.slice(6), addr.slice(6), ' ' + addr + ' ']) assert.strictEqual(wasm.Address.validate(bad), false, bad.slice(0, 12));
  assert.strictEqual(new wasm.Address(addr).toString(), addr);
  reset();
  const rep = registerWatchAccounts({ db: sqlite, entries: entries(['real-format', addr], ['upper', addr.toUpperCase()]), Address: wasm.Address });
  assert.deepStrictEqual([rep.accepted.length, rep.rejected.map((r) => r.reason)], [1, ['invalid_address']]);
});
