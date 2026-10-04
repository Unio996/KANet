// pool-market-seeder.test.mjs — 账本1855 A/B: 种子器在不收 KAS 模式下的 live 计数/上限/403-409 干净退出/网关回退/deadline 夹紧。
// Run: cd kasia-console && node src/services/pool-market-seeder.test.mjs   (自举: 临时 migration 库; gamma 与 create-v07 都用 fetch 桩, 零网络)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
if (!process.env._SEEDER_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_seeder_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'simnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _SEEDER_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
process.env.KASPA_NETWORK = 'simnet'; process.env.KANET_NO_KAS_STAKE_MODE = '1';
delete process.env.GATEWAY_RELAY_ID; delete process.env.ZK_MAX_LIVE_MARKETS; delete process.env.POOL_SEED_MAX_DAY; delete process.env.POOL_SEED_TARGET;
process.env.POOL_SEEDER_MAKER_RELAY = 'maker-r';
const { sqlite } = await import('../db/client.js');
const { tick, pickGammaMarkets } = await import('./pool-market-seeder.js');
let fails = 0; const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const minfo = sqlite.prepare('PRAGMA table_info(pool_markets)').all();
const seedMarket = (id, over = {}) => { const row = { id, maker_relay_id: 'maker-r', protocol_version: 'v0.7', protocol_status: 'pending_bettors', spine_p2sh: null, spine_lock_tx: null, maker_stake_amount: 0, deadline: Math.floor(Date.now() / 1000) + 7200, pool_merkle_root: 'ab'.repeat(32), oracle_relay_ids: '[]', resolution_rule_spec: JSON.stringify({ title: 't', zk_native: true }), metadata: '{}', market_metadata_hash: 'cd'.repeat(32), ...over }; for (const c of minfo) if (!(c.name in row)) row[c.name] = /INT/i.test(c.type) ? 1 : 'x'; sqlite.prepare(`INSERT OR REPLACE INTO pool_markets (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row)); };
const clear = () => sqlite.prepare('DELETE FROM pool_markets').run();

const day = 86400e3;
const gammaRows = (n, daysOut = 5, prefix = '0xc0') => Array.from({ length: n }, (_, i) => ({ conditionId: prefix + String(i).padStart(2, '0').repeat(31).slice(0, 62), question: `Will event ${prefix}${i} happen?`, description: 'd', endDate: new Date(Date.now() + daysOut * day).toISOString(), volume24hr: 1000 - i, events: [{ id: String(100 + i), title: 'E' }] }));
let posts = [], createMode = 'ok', gamma = gammaRows(6);
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('gamma') || u.includes('polymarket')) return { ok: true, status: 200, json: async () => gamma };
  if (u.includes('/api/pool/market/create-v07')) {
    const body = JSON.parse(init.body); posts.push(body);
    if (createMode === 'cap') return { ok: false, status: 409, json: async () => ({ ok: false, code: 'live_market_cap_reached', live: 3, cap: 3, error: 'cap' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true, market_id: 'new-' + posts.length }) };
  }
  throw new Error('unexpected fetch ' + u);
};
const quiet = async (f) => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {}; try { return await f(); } finally { console.log = l; console.warn = w; } };
const reset = () => { posts = []; createMode = 'ok'; gamma = gammaRows(6); clear(); };

console.log('[test] 无 KAS 模式: live 计数 = 未完结 ZK 原生盘(含 attested_v2), 目标被 ZK_MAX_LIVE_MARKETS 夹住');
reset(); process.env.ZK_MAX_LIVE_MARKETS = '3'; process.env.POOL_SEED_TARGET = '5';
seedMarket('m-live-1', { protocol_status: 'attested_v2', metadata: JSON.stringify({ zk_continuation: { exhausted: false } }) });   // 旧口径(只数 pending_bettors)看不见它
await quiet(() => tick());
ok(posts.length === 2, `cap=3, 已有 1(attested_v2) ⇒ 补 2 个(目标 5 被夹到 3; 实 POST ${posts.length})`);
ok(posts.every((b) => b.broker_relay_id === undefined), '无 KAS 模式未配 GATEWAY_RELAY_ID ⇒ 不传 15593e10(主网库无此 id), 由 create-v07 塌到 maker');
ok(posts.every((b) => b.maker_relay_id === 'maker-r' && b.resolution_rule_spec && JSON.parse(b.resolution_rule_spec).data_source_canonical.startsWith('polymarket:')), '体仍是 gamma 镜像体(maker_relay_id + polymarket 数据源)');

console.log('[test] exhausted=true / 终态 ⇒ 不计入 live');
reset(); process.env.ZK_MAX_LIVE_MARKETS = '2';
seedMarket('m-done-1', { protocol_status: 'attested_v2', metadata: JSON.stringify({ zk_continuation: { exhausted: true } }) });
seedMarket('m-done-2', { protocol_status: 'completed' });
await quiet(() => tick());
ok(posts.length === 2, `cap=2, 已有 0 个在跑 ⇒ 补 2(实 ${posts.length})`);

console.log('[test] 已满 ⇒ 一个都不发');
reset(); process.env.ZK_MAX_LIVE_MARKETS = '2';
seedMarket('m-a', { protocol_status: 'attested_v2', metadata: '{}' }); seedMarket('m-b', { protocol_status: 'pending_bettors' });
await quiet(() => tick());
ok(posts.length === 0, '2/2 ⇒ 不发 create');

console.log('[test] create-v07 回 live_market_cap_reached ⇒ 干净退出本 tick(只发 1 次, 不重试其余)');
reset(); process.env.ZK_MAX_LIVE_MARKETS = '5'; process.env.POOL_SEED_TARGET = '5'; createMode = 'cap';
await quiet(() => tick());
ok(posts.length === 1, `409 cap ⇒ break(实 POST ${posts.length})`);

console.log('[test] 未设 ZK_MAX_LIVE_MARKETS ⇒ 目标夹到 1(原一次一盘)');
reset(); delete process.env.ZK_MAX_LIVE_MARKETS; process.env.POOL_SEED_TARGET = '5';
await quiet(() => tick());
ok(posts.length === 1, `未设上限 ⇒ 只补 1 个(实 ${posts.length})`);

console.log('[test] POOL_SEED_MAX_DAY 在无 KAS 模式夹到 300 天(票龄 365d-60d 余量内)');
reset(); process.env.POOL_SEED_MAX_DAY = '400';
gamma = [...gammaRows(1, 320, '0xd0'), ...gammaRows(1, 290, '0xd1')];
const got = await quiet(() => pickGammaMarkets(5));
ok(got.length === 1 && got[0].conditionId.startsWith('0xd1'), `deadline 320d 被滤, 290d 保留(实 ${got.map((g) => g.conditionId.slice(0, 5)).join()})`);
delete process.env.POOL_SEED_MAX_DAY;

console.log('[test] 非无 KAS 模式: 旧行为不变(网关默认 id 保留)');
delete process.env.KANET_NO_KAS_STAKE_MODE; reset(); process.env.POOL_SEED_TARGET = '1';
await quiet(() => tick());
ok(posts.length === 1 && posts[0].broker_relay_id === '15593e10-fe63-4806-a7b5-cae062699de8', '旧模式(testnet) broker 默认仍 15593e10');

console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
