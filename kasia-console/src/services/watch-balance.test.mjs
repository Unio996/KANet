// watch-balance.test.mjs — D-026-style structure for D-028: 纯逻辑,全部依赖注入桩(无 DB、无网络、无 wasm)。
// 验收对应(设计 docs/2026-09-20-kanetui-d028-watch-only-accounts-design-v0.2.md §6 + NWT a74c7a6a):
//   A7 读数诚实(①..⑥)含 S4-1 两半("全部对照 0/缺 ⇒ unavailable"与"只有部分为 0 ⇒ 不影响") · A11 LOCAL_ONLY 零外发 + 字面 '1' + 不同批 ·
//   S4-2 ok_public 自己的失败处理(绝不 0) · A12 按 entry.address 匹配不按下标 · 缓存只缓存 ok。
// Run: cd kasia-console && node --test src/services/watch-balance.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import { readWatchBalances, sumWatchKas, sompiToKas, publicFallbackEnabled, WATCH_STATUS } from './watch-balance.js';

// 假地址,行为照抄本机 kaspa-wasm 的实测: 只接受小写规范形式(大写 / 无前缀 / 带空白 validate=false,构造对非法输入会 wasm panic,所以生产代码先 validate 再构造)。
class FakeAddress {
  static validate(s) { return /^kaspa:[a-z0-9]{8,}$/.test(String(s)); }
  constructor(s) { if (!FakeAddress.validate(s)) throw new Error('unreachable'); this._s = String(s); }
  toString() { return this._s; }
}
const C1 = 'kaspa:qqcold00000000000000000000000000000001', C2 = 'kaspa:qqcold00000000000000000000000000000002';
const H1 = 'kaspa:qqhot000000000000000000000000000000001', H2 = 'kaspa:qqhot000000000000000000000000000000002', H3 = 'kaspa:qqhot000000000000000000000000000000003';
const rows = [{ id: 'w1', name: 'cold-1', address: C1, chain: 'kaspa', custody: 'cold_no_key' }, { id: 'w2', name: 'cold-2', address: C2, chain: 'kaspa', custody: 'cold_no_key' }];
const KAS = 100000000n;

function makeEnv({ balances = {}, synced = [true, true], networkId = 'mainnet', entriesOverride = null, wr = { url: 'ws://127.0.0.1:17110', isLocal: true }, env = { KASPA_RPC_LOCAL_ONLY: '1' }, hot = [H1, H2], fetchImpl = null, throwOn = null } = {}) {
  const log = { getBalances: [], serverInfo: 0, fetches: [], sharedRpc: 0 };
  const rpc = {
    async getServerInfo() { const i = log.serverInfo++; return { isSynced: Array.isArray(synced) ? synced[Math.min(i, synced.length - 1)] : synced, networkId }; },
    async getBalancesByAddresses(addrs) {
      if (throwOn === 'balances') throw new Error('rpc exploded');
      log.getBalances.push(addrs.map(String));
      return { entries: entriesOverride ? entriesOverride(addrs) : addrs.map((a) => ({ address: a, balance: balances[String(a)] ?? 0n })) };
    },
  };
  const deps = {
    env, hotAddresses: hot, AddressCtor: FakeAddress, cache: new Map(), now: (() => { let t = 1_000_000; return () => t; })(),
    getWorkingRpc: async () => { if (throwOn === 'workingRpc') throw new Error('no rpc'); return wr; },
    getSharedRpc: async () => { log.sharedRpc++; return rpc; },
    fetchFn: async (url, opts) => { log.fetches.push(String(url)); if (!fetchImpl) throw new Error('fetch must not be called'); return fetchImpl(url, opts); },
  };
  return { deps, log };
}
const GOOD = { [C1]: 12345n * KAS + 67890123n, [C2]: 678n * KAS + 12345678n, [H1]: 40n * KAS, [H2]: 0n };

test('ok path: one batched read (cold + hot control), local_node source, both cold balances exact, zero REST', async () => {
  const { deps, log } = makeEnv({ balances: GOOD });
  const r = await readWatchBalances(rows, deps);
  assert.deepStrictEqual(r.map((x) => x.status), ['ok', 'ok']);
  assert.strictEqual(r[0].balanceKas, 12345.67890123); assert.strictEqual(r[1].balanceKas, 678.12345678);
  assert.strictEqual(r[0].source, 'local_node'); assert.strictEqual(r[0].custody, 'cold_no_key'); assert.ok(r[0].readAt);
  assert.strictEqual(log.getBalances.length, 1, 'ONE getBalancesByAddresses call for the whole batch');
  assert.deepStrictEqual(log.getBalances[0], [C1, C2, H1, H2]);
  assert.strictEqual(log.fetches.length, 0);
});
test('a REAL zero on a cold account is shown as 0 (status ok) when the batch is certified -- unavailable is not the same thing as zero', async () => {
  const { deps } = makeEnv({ balances: { ...GOOD, [C2]: 0n } });
  const r = await readWatchBalances(rows, deps);
  assert.strictEqual(r[1].status, 'ok'); assert.strictEqual(r[1].balanceKas, 0);
});

// ---- A7 读数诚实
test('A7① node not synced (isSynced=false) => unavailable/node_not_synced, balance null, and no balance call at all', async () => {
  const { deps, log } = makeEnv({ balances: GOOD, synced: false });
  const r = await readWatchBalances(rows, deps);
  assert.ok(r.every((x) => x.status === 'unavailable' && x.reason === 'node_not_synced' && x.balanceKas === null));
  assert.strictEqual(log.getBalances.length, 0);
});
test('A7② synced BEFORE the read but not AFTER (fell behind during the read) => unavailable', async () => {
  const { deps, log } = makeEnv({ balances: GOOD, synced: [true, false] });
  const r = await readWatchBalances(rows, deps);
  assert.ok(r.every((x) => x.status === 'unavailable' && x.reason === 'node_not_synced' && x.balanceKas === null));
  assert.strictEqual(log.getBalances.length, 1); assert.strictEqual(log.serverInfo, 2, 'isSynced is read twice, uncached');
});
test('A7③a positive control: ALL hot addresses 0 => the whole batch is unavailable/no_positive_control, cold zeros are NOT rendered as 0', async () => {
  const { deps } = makeEnv({ balances: { [C1]: 0n, [C2]: 0n, [H1]: 0n, [H2]: 0n } });
  const r = await readWatchBalances(rows, deps);
  assert.ok(r.every((x) => x.status === 'unavailable' && x.reason === 'no_positive_control' && x.balanceKas === null));
});
test('A7③b (S4-1 second half) only SOME hot addresses at 0 does NOT matter: one positive hot balance certifies the batch (a hot relay that spent all its money is normal)', async () => {
  const { deps } = makeEnv({ balances: { ...GOOD, [H1]: 0n, [H2]: 7n * KAS }, hot: [H1, H2, H3] });
  const r = await readWatchBalances(rows, deps);
  assert.deepStrictEqual(r.map((x) => x.status), ['ok', 'ok']);
});
test('A7③c control entries MISSING from the result (only cold entries came back) => no_positive_control', async () => {
  const { deps } = makeEnv({ balances: GOOD, entriesOverride: (addrs) => addrs.filter((a) => [C1, C2].includes(String(a))).map((a) => ({ address: a, balance: GOOD[String(a)] })) });
  const r = await readWatchBalances(rows, deps);
  assert.ok(r.every((x) => x.status === 'unavailable' && x.reason === 'no_positive_control'));
});
test('A7③d no hot address to certify with => fail closed (no_positive_control)', async () => {
  const { deps, log } = makeEnv({ balances: GOOD, hot: [] });
  const r = await readWatchBalances(rows, deps);
  assert.ok(r.every((x) => x.status === 'unavailable' && x.reason === 'no_positive_control'));
  assert.strictEqual(log.getBalances.length, 0, 'not even read: nothing could certify it');
});
test('A7④ a cold entry missing while the control is fine => THAT account is unavailable/entry_missing, the other is ok (never 0)', async () => {
  const { deps } = makeEnv({ balances: GOOD, entriesOverride: (addrs) => addrs.filter((a) => String(a) !== C2).map((a) => ({ address: a, balance: GOOD[String(a)] ?? 0n })) });
  const r = await readWatchBalances(rows, deps);
  assert.deepStrictEqual(r.map((x) => [x.status, x.reason]), [['ok', null], ['unavailable', 'entry_missing']]);
  assert.strictEqual(r[1].balanceKas, null);
});
test('A7⑤ getWorkingRpc().isLocal === false or url null => unavailable (LOCAL_ONLY: local_node_unavailable), never read through a non-local node', async () => {
  let m = makeEnv({ balances: GOOD, wr: { url: 'ws://203.0.113.9:17110', isLocal: false } });
  let r = await readWatchBalances(rows, m.deps);
  assert.ok(r.every((x) => x.status === 'unavailable' && x.reason === 'rpc_not_local')); assert.strictEqual(m.log.sharedRpc, 0);
  m = makeEnv({ balances: GOOD, wr: { url: null, isLocal: false } });
  r = await readWatchBalances(rows, m.deps);
  assert.ok(r.every((x) => x.status === 'unavailable' && x.reason === 'local_node_unavailable'));
  m = makeEnv({ balances: GOOD, wr: { url: null, isLocal: false }, env: {} });
  r = await readWatchBalances(rows, m.deps);
  assert.ok(r.every((x) => x.reason === 'no_local_node'));
});
test('A7 network mismatch (a testnet node) => unavailable/network_mismatch', async () => {
  const { deps } = makeEnv({ balances: GOOD, networkId: 'testnet-10' });
  const r = await readWatchBalances(rows, deps);
  assert.ok(r.every((x) => x.status === 'unavailable' && x.reason === 'network_mismatch'));
});
test('a HUNG rpc (getServerInfo / getBalancesByAddresses / getSharedRpc never settle) becomes unavailable within the timeout instead of hanging the caller', async () => {
  const never = new Promise(() => {});
  for (const hang of ['serverInfo', 'balances', 'sharedRpc']) {
    const m = makeEnv({ balances: GOOD }); m.deps.timeoutMs = 30;
    if (hang === 'sharedRpc') m.deps.getSharedRpc = () => never;
    else { const orig = m.deps.getSharedRpc; m.deps.getSharedRpc = async (a) => { const rpc = await orig(a); return { getServerInfo: hang === 'serverInfo' ? () => never : rpc.getServerInfo, getBalancesByAddresses: hang === 'balances' ? () => never : rpc.getBalancesByAddresses }; }; }
    const t0 = Date.now(); const r = await readWatchBalances(rows, m.deps);
    assert.ok(Date.now() - t0 < 2000, `${hang}: returned in ${Date.now() - t0} ms`);
    assert.ok(r.every((x) => x.status === 'unavailable' && x.balanceKas === null), hang);
  }
});
test('never throws: a throwing getWorkingRpc / getBalancesByAddresses becomes unavailable, not an exception and not 0', async () => {
  let m = makeEnv({ balances: GOOD, throwOn: 'workingRpc' });
  let r = await readWatchBalances(rows, m.deps);
  assert.ok(r.every((x) => x.status === 'unavailable' && x.reason === 'rpc_lookup_failed' && x.balanceKas === null));
  m = makeEnv({ balances: GOOD, throwOn: 'balances' });
  r = await readWatchBalances(rows, m.deps);
  assert.ok(r.every((x) => x.status === 'unavailable' && /^read_failed:/.test(x.reason) && x.balanceKas === null));
});

// ---- A11 LOCAL_ONLY 无外发
test('A11 KASPA_RPC_LOCAL_ONLY=1 and the local node down: ZERO fetch calls, even with WATCH_PUBLIC_FALLBACK=1', async () => {
  const { deps, log } = makeEnv({ wr: { url: null, isLocal: false }, env: { KASPA_RPC_LOCAL_ONLY: '1', WATCH_PUBLIC_FALLBACK: '1' } });
  const r = await readWatchBalances(rows, deps);
  assert.ok(r.every((x) => x.status === 'unavailable')); assert.strictEqual(log.fetches.length, 0);
});
test('A11 only the literal "1" enables the opt-in ("true", "1 ", "01", "", " 1", "yes" do not); LOCAL_ONLY=1 always wins', async () => {
  for (const v of ['true', '1 ', '01', '', ' 1', 'yes', 'TRUE', '0']) assert.strictEqual(publicFallbackEnabled({ WATCH_PUBLIC_FALLBACK: v }), false, JSON.stringify(v));
  assert.strictEqual(publicFallbackEnabled({ WATCH_PUBLIC_FALLBACK: '1' }), true);
  assert.strictEqual(publicFallbackEnabled({ WATCH_PUBLIC_FALLBACK: '1', KASPA_RPC_LOCAL_ONLY: '1' }), false);
  for (const v of ['true', '1 ', '01']) {
    const { deps, log } = makeEnv({ wr: { url: null, isLocal: false }, env: { WATCH_PUBLIC_FALLBACK: v } });
    await readWatchBalances(rows, deps); assert.strictEqual(log.fetches.length, 0, `fallback flag ${JSON.stringify(v)} must not enable REST`);
  }
});
test('A11 with the opt-in on: REST per COLD address only (never batched with a hot address), status ok_public, source public_rest', async () => {
  const { deps, log } = makeEnv({ wr: { url: null, isLocal: false }, env: { WATCH_PUBLIC_FALLBACK: '1' }, fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => ({ balance: decodeURIComponent(url).includes(C1) ? 1234567890123 : 67812345678 }) }) });
  const r = await readWatchBalances(rows, deps);
  assert.deepStrictEqual(r.map((x) => [x.status, x.source]), [['ok_public', 'public_rest'], ['ok_public', 'public_rest']]);
  assert.strictEqual(r[0].balanceKas, 12345.67890123);
  assert.strictEqual(log.fetches.length, 2);
  for (const raw of log.fetches) { const u = decodeURIComponent(raw); assert.ok(u.includes(C1) !== u.includes(C2), 'each request carries exactly ONE cold address'); assert.ok(![H1, H2, H3].some((h) => u.includes(h)), 'no hot address is ever sent'); }
});
// ---- S4-2 ok_public 自己的失败处理
test('S4-2 the ok_public path has its OWN failure handling: HTTP non-200 / timeout / bad structure / negative / non-integer / string => unavailable, never 0', async () => {
  const cases = [
    ['http_500', async () => ({ ok: false, status: 500, json: async () => ({}) })],
    ['timeout', async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); }],
    ['bad json', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } })],
    ['missing balance', async () => ({ ok: true, status: 200, json: async () => ({}) })],
    ['negative', async () => ({ ok: true, status: 200, json: async () => ({ balance: -5 }) })],
    ['fractional', async () => ({ ok: true, status: 200, json: async () => ({ balance: 1.5 }) })],
    ['string', async () => ({ ok: true, status: 200, json: async () => ({ balance: '123' }) })],
    ['NaN', async () => ({ ok: true, status: 200, json: async () => ({ balance: NaN }) })],
  ];
  for (const [label, impl] of cases) {
    const { deps } = makeEnv({ wr: { url: null, isLocal: false }, env: { WATCH_PUBLIC_FALLBACK: '1' }, fetchImpl: impl });
    const r = await readWatchBalances(rows, deps);
    assert.ok(r.every((x) => x.status === 'unavailable' && x.balanceKas === null), `${label}: ${JSON.stringify(r[0])}`);
  }
});
test('opt-in on but the LOCAL read succeeds: no REST at all (REST is only a fallback)', async () => {
  const { deps, log } = makeEnv({ balances: GOOD, env: { WATCH_PUBLIC_FALLBACK: '1' } });
  const r = await readWatchBalances(rows, deps);
  assert.ok(r.every((x) => x.status === 'ok')); assert.strictEqual(log.fetches.length, 0);
});

// ---- A12 按地址匹配
test('A12 entries returned OUT OF ORDER, as Address objects and as strings, still map to the right account (no index dependence)', async () => {
  const { deps } = makeEnv({ balances: GOOD, entriesOverride: (addrs) => {
    const mk = (a, i) => ({ address: i % 2 ? new FakeAddress(String(a)) : String(a), balance: GOOD[String(a)] ?? 0n });
    return addrs.map(mk).reverse();
  } });
  const r = await readWatchBalances(rows, deps);
  assert.deepStrictEqual(r.map((x) => [x.id, x.balanceKas]), [['w1', 12345.67890123], ['w2', 678.12345678]]);
});
test('rows keep their order and identity; an unparseable stored address is unavailable/invalid_address and does not break the others', async () => {
  const { deps } = makeEnv({ balances: GOOD });
  const r = await readWatchBalances([rows[0], { id: 'bad', name: 'x', address: 'not-an-address' }, rows[1]], deps);
  assert.deepStrictEqual(r.map((x) => [x.id, x.status]), [['w1', 'ok'], ['bad', 'unavailable'], ['w2', 'ok']]);
  assert.strictEqual(r[1].reason, 'invalid_address'); assert.strictEqual(r[1].balanceKas, null);
});
test('a stored address the library rejects (upper-case / padded) is unavailable/invalid_address and is NEVER handed to the Address constructor (a wasm panic on invalid input would poison the shared instance)', async () => {
  const { deps, log } = makeEnv({ balances: GOOD });
  let constructed = 0; const Spy = class extends FakeAddress { constructor(s) { constructed++; super(s); } }; Spy.validate = FakeAddress.validate;
  deps.AddressCtor = Spy;
  const r = await readWatchBalances([{ id: 'w1', name: 'c', address: C1.toUpperCase() }, { id: 'w2', name: 'd', address: ' ' + C2 + ' ' }], deps);
  assert.ok(r.every((x) => x.status === 'unavailable' && x.reason === 'invalid_address' && x.balanceKas === null));
  assert.strictEqual(constructed, 0, 'validate() gates the constructor'); assert.strictEqual(log.getBalances.length, 0);
});

// ---- 缓存
test('only settled-ok results are cached (30 s): a second read reuses them without calling the node; unavailable is never cached; TTL expiry re-reads', async () => {
  const m = makeEnv({ balances: GOOD }); let t = 5_000_000; m.deps.now = () => t;
  await readWatchBalances(rows, m.deps); await readWatchBalances(rows, m.deps);
  assert.strictEqual(m.log.getBalances.length, 1, 'second read served from cache');
  t += 31_000; await readWatchBalances(rows, m.deps);
  assert.strictEqual(m.log.getBalances.length, 2, 'expired => re-read');
  const bad = makeEnv({ synced: false }); await readWatchBalances(rows, bad.deps); await readWatchBalances(rows, bad.deps);
  assert.strictEqual(bad.log.serverInfo, 2, 'an unavailable result is NOT cached: each call re-checks the node');
});

// ---- 汇总 / 精度
test('sumWatchKas counts only ok/ok_public and reports how many accounts are unreadable (the "total is incomplete" marker)', () => {
  const s = sumWatchKas([{ status: 'ok', balanceKas: 10.5 }, { status: 'ok_public', balanceKas: 0.25 }, { status: 'unavailable', balanceKas: null }, { status: 'unavailable', balanceKas: null }]);
  assert.deepStrictEqual(s, { watchKas: 10.75, watchUnreadable: 2 });
  assert.deepStrictEqual(sumWatchKas([]), { watchKas: 0, watchUnreadable: 0 });
});
test('sompiToKas is exact to 8 decimals', () => {
  assert.strictEqual(sompiToKas(1n), 1e-8); assert.strictEqual(sompiToKas(100000000n), 1); assert.strictEqual(sompiToKas(1234567890123n), 12345.67890123);
  assert.strictEqual(WATCH_STATUS.UNAVAILABLE, 'unavailable');
});
