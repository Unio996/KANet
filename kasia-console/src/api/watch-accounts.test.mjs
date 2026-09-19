// watch-accounts.test.mjs — D-028: 只 GET 的接口 + /api/portfolio/unified 的并入口径。真实临时库(真实迁移)+ fastify.inject;余额读取用注入的桩(不碰网络/RPC)。
// 验收对应: A1(20 = 热 + 冷)· A2(总额口径、既有口径不变)· A5(无写/发路径)· O4-1(?relayId=X 不含冷存)· 读数不可用 ⇒ 不进 watchKas、计入 watchUnreadable(绝不当 0)。
// Run: cd kasia-console && node --test src/api/watch-accounts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const tmpDir = mkdtempSync(join(tmpdir(), 'd028-api-test-'));
const DB_PATH = join(tmpDir, 'console.db');
process.env.DB_PATH = DB_PATH;
process.env.PORT = '9';   // a closed port: portfolio's per-relay loopback fetches fail fast instead of reaching a real console
execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH }, stdio: 'pipe' });
const { sqlite } = await import('../db/client.js');
const { default: Fastify } = await import('fastify');
const { registerWatchAccountRoutes, loadWatchAccountsView } = await import('./watch-accounts.js');
const { registerPortfolioRoutes } = await import('./portfolio.js');
test.after(() => { try { sqlite.close(); } catch { /* */ } rmSync(tmpDir, { recursive: true, force: true }); });

class FakeAddress {
  static validate(s) { return /^kaspa:[a-z0-9]{8,}$/.test(String(s)); }
  constructor(s) { if (!FakeAddress.validate(s)) throw new Error('unreachable'); this._s = String(s); }
  toString() { return this._s; }
}
const W1 = 'kaspa:qqwatch0000000000000000000000000000000001', W2 = 'kaspa:qqwatch0000000000000000000000000000000002';
const H1 = 'kaspa:qqhotone000000000000000000000000000000001', H2 = 'kaspa:qqhottwo000000000000000000000000000000002';
const KAS = 100000000n;
function insertLoose(table, over) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all();
  const row = {}; for (const c of cols) if (c.notnull && c.dflt_value === null && !c.pk) row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : 'x';
  Object.assign(row, over);
  const names = Object.keys(row); sqlite.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...Object.values(row));
}
const ts = new Date().toISOString();
insertLoose('relay_nodes', { id: 'hot-1', name: 'HotOne', address: H1, network: 'mainnet' });
insertLoose('relay_nodes', { id: 'hot-2', name: 'HotTwo', address: H2, network: 'mainnet' });
const wid1 = randomUUID(), wid2 = randomUUID();
sqlite.prepare('INSERT INTO watch_accounts (id,name,address,note,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(wid1, 'cold-one', W1, 'legacy', ts, ts);
sqlite.prepare('INSERT INTO watch_accounts (id,name,address,created_at,updated_at) VALUES (?,?,?,?,?)').run(wid2, 'cold-two', W2, ts, ts);

// 注入的节点: 同步、热地址 H1 有余额(阳性对照)、冷存 W1/W2 各有余额
function depsFor({ balances, synced = true } = {}) {
  const b = balances || { [W1]: 500n * KAS, [W2]: 25n * KAS + 50000000n, [H1]: 9n * KAS, [H2]: 0n };
  const rpc = { getServerInfo: async () => ({ isSynced: synced, networkId: 'mainnet' }), getBalancesByAddresses: async (addrs) => ({ entries: addrs.map((a) => ({ address: a, balance: b[String(a)] ?? 0n })) }) };
  return { env: { KASPA_RPC_LOCAL_ONLY: '1' }, AddressCtor: FakeAddress, cache: new Map(), hotAddresses: [H1, H2], getWorkingRpc: async () => ({ url: 'ws://127.0.0.1:17110', isLocal: true }), getSharedRpc: async () => rpc };
}
async function appWith(depsProvider) {
  const app = Fastify(); const routes = [];
  app.addHook('onRoute', (r) => routes.push([[].concat(r.method).join(','), r.url]));
  await registerWatchAccountRoutes(app, { depsProvider });
  await registerPortfolioRoutes(app, { loadWatch: async () => loadWatchAccountsView(await depsProvider()) });
  await app.ready();
  return { app, routes };
}

test('A5 the watch routes are GET-only; POST/PUT/PATCH/DELETE on them are 404; no send/transfer/split/privkey path exists under them', async () => {
  const { app, routes } = await appWith(async () => depsFor());
  const watchRoutes = routes.filter(([, url]) => url.startsWith('/api/watch-accounts'));
  assert.ok(watchRoutes.length >= 2);
  for (const [method] of watchRoutes) assert.ok(/^(GET|HEAD)(,(GET|HEAD))*$/.test(method), `non-GET method on a watch route: ${method}`);
  assert.ok(!watchRoutes.some(([, url]) => /send|transfer|split|privkey|mnemonic|export/i.test(url)));
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) for (const url of ['/api/watch-accounts', `/api/watch-accounts/${wid1}`, `/api/watch-accounts/${wid1}/send`]) {
    const r = await app.inject({ method, url, payload: { x: 1 } });
    assert.strictEqual(r.statusCode, 404, `${method} ${url}`);
  }
  await app.close();
});
test('GET /api/watch-accounts: both cold accounts, status ok, exact balances, custody cold_no_key, note kept, no key-like fields', async () => {
  const { app } = await appWith(async () => depsFor());
  const r = await app.inject({ method: 'GET', url: '/api/watch-accounts' });
  const j = r.json();
  assert.strictEqual(r.statusCode, 200); assert.strictEqual(j.ok, true); assert.strictEqual(j.accounts.length, 2);
  assert.deepStrictEqual(j.accounts.map((a) => [a.name, a.status, a.balanceKas, a.custody, a.note]), [['cold-one', 'ok', 500, 'cold_no_key', 'legacy'], ['cold-two', 'ok', 25.5, 'cold_no_key', null]]);
  assert.strictEqual(j.watchKas, 525.5); assert.strictEqual(j.watchUnreadable, 0);
  assert.ok(!/mnemonic|privkey|private_key|secret/i.test(r.body), 'no key material in the payload');
  const one = await app.inject({ method: 'GET', url: `/api/watch-accounts/${wid2}` });
  assert.strictEqual(one.statusCode, 200); assert.strictEqual(one.json().account.name, 'cold-two');
  assert.strictEqual((await app.inject({ method: 'GET', url: '/api/watch-accounts/nope' })).statusCode, 404);
  await app.close();
});
test('A1/A2 GET /api/portfolio/unified (all agents): 2 hot + 2 cold; totals.kas / grandTotalKas keep their HOT-only meaning; kasAll and grandTotalKasWithWatch add the cold KAS exactly once', async () => {
  const { app } = await appWith(async () => depsFor());
  const j = (await app.inject({ method: 'GET', url: '/api/portfolio/unified' })).json();
  assert.strictEqual(j.ok, true); assert.strictEqual(j.agents.length, 2); assert.strictEqual(j.watchAccounts.length, 2);
  assert.strictEqual(j.totals.watchKas, 525.5); assert.strictEqual(j.totals.watchUnreadable, 0);
  assert.strictEqual(j.totals.kasAll, j.totals.kas + j.totals.watchKas);
  assert.strictEqual(j.totals.grandTotalKasWithWatch, j.totals.grandTotalKas + j.totals.watchKas);
  assert.ok(!j.agents.some((a) => [W1, W2].includes(a.address)), 'a cold address is never an agent card');
  // the hot-side totals are identical to a run WITHOUT any watch rows (the existing meaning is unchanged)
  const hotOnly = await appWith(async () => depsFor()); sqlite.exec('DELETE FROM watch_accounts');
  const k = (await hotOnly.app.inject({ method: 'GET', url: '/api/portfolio/unified' })).json();
  assert.strictEqual(k.totals.kas, j.totals.kas); assert.strictEqual(k.totals.grandTotalKas, j.totals.grandTotalKas);
  assert.ok(!('watchAccounts' in k) || k.watchAccounts.length === 0);
  sqlite.prepare('INSERT INTO watch_accounts (id,name,address,note,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(wid1, 'cold-one', W1, 'legacy', ts, ts);
  sqlite.prepare('INSERT INTO watch_accounts (id,name,address,created_at,updated_at) VALUES (?,?,?,?,?)').run(wid2, 'cold-two', W2, ts, ts);
  await app.close(); await hotOnly.app.close();
});
test('O4-1 GET /api/portfolio/unified?relayId=X (single-agent view) carries NO cold accounts and no watch totals', async () => {
  const { app } = await appWith(async () => depsFor());
  const j = (await app.inject({ method: 'GET', url: '/api/portfolio/unified?relayId=hot-1' })).json();
  assert.strictEqual(j.ok, true); assert.strictEqual(j.agents.length, 1);
  assert.ok(!('watchAccounts' in j)); for (const k of ['watchKas', 'kasAll', 'grandTotalKasWithWatch', 'watchUnreadable']) assert.ok(!(k in j.totals), `${k} must be absent`);
  await app.close();
});
test('unreadable cold accounts (node not synced): status unavailable, balanceKas null, NOT in watchKas, counted in watchUnreadable, hot totals untouched', async () => {
  const { app } = await appWith(async () => depsFor({ synced: false }));
  const j = (await app.inject({ method: 'GET', url: '/api/portfolio/unified' })).json();
  assert.deepStrictEqual(j.watchAccounts.map((a) => [a.status, a.balanceKas, a.reason]), [['unavailable', null, 'node_not_synced'], ['unavailable', null, 'node_not_synced']]);
  assert.strictEqual(j.totals.watchKas, 0); assert.strictEqual(j.totals.watchUnreadable, 2);
  assert.strictEqual(j.totals.kasAll, j.totals.kas);
  await app.close();
});
test('positive control failing (all hot balances 0) makes the cold accounts unavailable, never 0', async () => {
  const { app } = await appWith(async () => depsFor({ balances: { [W1]: 0n, [W2]: 0n, [H1]: 0n, [H2]: 0n } }));
  const j = (await app.inject({ method: 'GET', url: '/api/watch-accounts' })).json();
  assert.ok(j.accounts.every((a) => a.status === 'unavailable' && a.reason === 'no_positive_control' && a.balanceKas === null)); assert.strictEqual(j.watchUnreadable, 2);
  await app.close();
});
test('a throwing watch loader never breaks the portfolio: hot data is served, the cold section is simply absent', async () => {
  const app = Fastify(); await registerPortfolioRoutes(app, { loadWatch: async () => { throw new Error('boom'); } }); await app.ready();
  const r = await app.inject({ method: 'GET', url: '/api/portfolio/unified' }); const j = r.json();
  assert.strictEqual(r.statusCode, 200); assert.strictEqual(j.ok, true); assert.strictEqual(j.agents.length, 2); assert.ok(!('watchAccounts' in j));
  await app.close();
});
test('loadWatchAccountsView never throws: an internal failure in the reader becomes unavailable/internal_error rows', async () => {
  const v = await loadWatchAccountsView({ get getWorkingRpc() { throw new Error('bad deps'); } });
  assert.strictEqual(v.accounts.length, 2); assert.ok(v.accounts.every((a) => a.status === 'unavailable' && a.balanceKas === null));
});
test('an empty watch_accounts table => no cold section at all (the rollback path: DELETE FROM watch_accounts changes nothing else)', async () => {
  sqlite.exec('DELETE FROM watch_accounts');
  const v = await loadWatchAccountsView(depsFor()); assert.deepStrictEqual(v, { accounts: [], watchKas: 0, watchUnreadable: 0 });
});
