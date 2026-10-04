// mainnet-no-kas-stake-routes.test.mjs — 账本1845 S0 回归: 主网上所有收 KAS 的 console 路由 ⇒ 403 + 零转账 + 零 relay 命令 + 零 DB 写;
// 测试网/simnet 行为不变(过闸, 不返 403)。真 Fastify + app.inject + 真 migration 临时库; transferAndConfirm / sendCommandAsync 用 mock.module 打桩计数。
// 再加两道结构闸: ① 每条受闸路由的【第一条语句】就是 assertNoKasStakeOnMainnet(同名); ② pool.js / proto.js 里每个 POST 路由要么受闸要么在显式白名单(防以后新增路由漏闸)。
// Run: cd kasia-console && node --experimental-test-module-mocks src/api/mainnet-no-kas-stake-routes.test.mjs
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'node:url';

if (!process.env._NOKAS_ROUTES_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_nokas_routes_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _NOKAS_ROUTES_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';   // rpc-health.js 模块加载就要这个 env; 指向不可达端口, 本测试不碰任何节点
process.env.KASPA_NETWORK = 'simnet';             // 模块加载期要有网络; 下面各段按需切换
delete process.env.PROTO_DRIVER_ENABLED; delete process.env.PROTO_RELAY_ID; delete process.env.WORLDCUP_SCHEDULE_ENABLED;

import { mock } from 'node:test';
import Fastify from 'fastify';

let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };

// ── 打桩: relay-manager 的 sendCommandAsync / transferAndConfirm 计数(其余导出原样) ──
const rmUrl = new URL('../services/relay-manager.js', import.meta.url).href;
const realRm = await import(rmUrl);
const calls = { send: 0, transfer: 0 };
const stubSend = () => { calls.send++; return Promise.reject(new Error('stubbed relay command (test)')); };
const stubTransfer = () => { calls.transfer++; return Promise.reject(new Error('stubbed transfer (test)')); };
const { default: realDefault, ...realNamed } = realRm;
mock.module(rmUrl, {
  namedExports: {
    ...realNamed,
    sendCommandAsync: stubSend,
    transferAndConfirm: stubTransfer,
  },
  ...(realDefault !== undefined ? { defaultExport: realDefault } : {}),
});

const { sqlite } = await import('../db/client.js');
const { registerPoolRoutes } = await import('./pool.js');
const { registerProtoRoutes } = await import('./proto.js');
const { assertNoKasStakeOnMainnet, NO_KAS_STAKE_ERROR, NO_KAS_STAKE_CODE, _resetNoKasStakeLogForTest } = await import('../lib/mainnet-no-kas-stake-gate.mjs');
const { worldcupScheduleEnabled, startWorldcupScheduleCron } = await import('../services/worldcup-schedule-cron.mjs');

// ── 1. 闸函数矩阵 ──
console.log('[test] 1. assertNoKasStakeOnMainnet 网络矩阵');
{
  const g = assertNoKasStakeOnMainnet('t', { KASPA_NETWORK: 'mainnet' });
  ok(g && g.http === 403 && g.body.ok === false && g.body.code === NO_KAS_STAKE_CODE && g.body.error === NO_KAS_STAKE_ERROR && g.body.route === 't', 'mainnet ⇒ 403 + 固定文案 + code + route');
  ok(NO_KAS_STAKE_ERROR === '主网押注与开盘不收 KAS（D-017 §2）', '文案逐字 == 派工要求');
  for (const n of ['testnet-12', 'simnet', 'devnet']) ok(assertNoKasStakeOnMainnet('t', { KASPA_NETWORK: n }) === null, `${n} ⇒ null(放行, 行为不变)`);
  for (const bad of [undefined, '', 'Mainnet', 'foo']) { const x = assertNoKasStakeOnMainnet('t', { KASPA_NETWORK: bad }); ok(x && x.http === 403, `网络未配/未知(${JSON.stringify(bad)}) ⇒ fail-closed 403`); }
}

// ── 2. 路由矩阵 ──
const GATED = [
  ['/api/pool/market/create', 'create'],
  ['/api/pool/market/create-v06', 'create-v06'],
  ['/api/pool/market/m1/bettor/register-v07/prep', 'register-v07/prep'],
  ['/api/pool/market/m1/bettor/register-v07/confirm', 'register-v07/confirm'],
  ['/api/pool/market/m1/oracle/deposit', 'oracle/deposit'],
  ['/api/pool/market/m1/bettor/register', 'register'],
  ['/api/pool/market/m1/bettor/register-external/prep', 'register-external/prep'],
  ['/api/pool/market/m1/bettor/register-external/confirm', 'register-external/confirm'],
  ['/api/pool/market/m1/bettor/register-v06/prep', 'register-v06/prep'],
  ['/api/pool/market/m1/bettor/register-v06/confirm', 'register-v06/confirm'],
  ['/api/proto-markets/create', 'proto-markets/create'],
  ['/api/proto-markets/m1/bet', 'proto-markets/bet'],
  ['/api/proto-markets/m1/resolve', 'proto-markets/resolve'],
  ['/api/proto-markets/m1/claim', 'proto-markets/claim'],
  ['/api/proto-markets/m1/withdraw', 'proto-markets/withdraw'],
];
// 账本1846 S1/S2 起这两条是【显式重开】路由(主网只放行无 KAS 分支, 专测见 no-kas-reopened-routes.test.mjs); 这里只在"测试网过闸"与结构闸里带上它们。
const REOPENED = [['/api/pool/market/create-v07', 'create-v07'], ['/api/pool/market/m1/bettor/register-v07', 'register-v07']];
const app = Fastify(); await registerPoolRoutes(app); await registerProtoRoutes(app); await app.ready();
const tables = ['pool_markets', 'pool_bettor_sides', 'market_shards', 'pool_bet_preps', 'proto_markets', 'proto_bets', 'proto_bet_intents', 'proto_settlement_intents', 'events'];
const counts = () => Object.fromEntries(tables.map((t) => { try { return [t, sqlite.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c]; } catch { return [t, -1]; } }));
const post = (url, payload) => Promise.race([
  app.inject({ method: 'POST', url, payload: payload ?? {} }),
  new Promise((_, rej) => setTimeout(() => rej(new Error('inject timeout 20s')), 20000)),
]);
// 一份"看起来合法"的体, 证明闸不看体(拒绝发生在读体之前)
const FULL_BODY = { maker_relay_id: 'x', outcome_side: 'YES', outcome_end_date: new Date(Date.now() + 3600e3).toISOString(), resolution_rule_spec: '{}', maker_stake_kas: 100, bettor_relay_id: 'b', direction: 0, stake_kas: 1, oracle_relay_id: 'o', deposit_kas: 1, linked_addr: 'kaspa:x', bet_id: 'b1', tokenId: 't', title: 'x', deadline: new Date(Date.now() + 3600e3).toISOString(), amount: 1 };

console.log('[test] 2. 主网 ⇒ 每条路由 403 + 零转账 + 零 relay 命令 + 零 DB 写');
process.env.KASPA_NETWORK = 'mainnet';
for (const [url, name] of GATED) {
  for (const [label, body] of [['空体', {}], ['完整体', FULL_BODY]]) {
    _resetNoKasStakeLogForTest();
    const before = counts(); calls.send = 0; calls.transfer = 0;
    let res; try { res = await post(url, body); } catch (e) { res = { statusCode: -1, body: e.message }; }
    const j = (() => { try { return JSON.parse(res.body); } catch { return {}; } })();
    const after = counts();
    ok(res.statusCode === 403 && j.code === NO_KAS_STAKE_CODE && j.route === name && j.error === NO_KAS_STAKE_ERROR, `${name} [${label}] mainnet ⇒ 403 ${NO_KAS_STAKE_CODE}`);
    ok(calls.transfer === 0 && calls.send === 0, `${name} [${label}] transferAndConfirm=${calls.transfer} sendCommandAsync=${calls.send}(均须 0)`);
    ok(JSON.stringify(before) === JSON.stringify(after), `${name} [${label}] 关键表行数不变`);
  }
}

console.log('[test] 3. 测试网 / simnet ⇒ 过闸(不返 mainnet_no_kas_stake 403), 行为不变');
for (const net of ['testnet-12', 'simnet']) {
  process.env.KASPA_NETWORK = net;
  for (const [url, name] of [...GATED, ...REOPENED]) {
    let res; try { res = await post(url, {}); } catch (e) { res = { statusCode: -1, body: e.message }; }
    const j = (() => { try { return JSON.parse(res.body); } catch { return {}; } })();
    ok(j.code !== NO_KAS_STAKE_CODE && res.statusCode !== -1, `${name} @${net} 过闸(status=${res.statusCode}, 空体由原有校验接手)`);
  }
}

// ── 4. 结构闸 ──
console.log('[test] 4. 结构: 第一条语句 + 无漏闸 POST 路由');
const here = fileURLToPath(new URL('.', import.meta.url));
const { REOPENED_ROUTES } = await import('../lib/mainnet-no-kas-stake-gate.mjs');
const NOT_COLLECTING = new Set([   // 不向任何人收 KAS 的 POST 路由(显式白名单; 新增路由必须在此登记或加闸)
  '/api/pool/market/:id/settle', '/api/pool/market/:id/oracle/vote', '/api/pool/market/:id/bettor-refund-claim', '/api/pool/prevet-extract', '/api/pool/prevet',
  // 结算侧 admin 路由(admin secret + ADMIN_*_ENABLED env 双闸, 只付结算手续费/出证 gate 注资, 不向开盘人/下注人/委员收 KAS)与 broker 推荐(只读判断):
  '/api/admin/pool/propose-close-v2', '/api/admin/pool/zk-handoff-v2', '/api/admin/pool/zk-close-v2', '/api/admin/pool/zk-close-gate-debugger', '/api/broker/recommend',
]);
for (const file of ['pool.js', 'proto.js']) {
  const src = fs.readFileSync(here + file, 'utf8').split('\n');
  for (let i = 0; i < src.length; i++) {
    const m = /fastify\.post\('([^']+)', async \(request, reply\) => \{\s*$/.exec(src[i]);
    if (!m) { if (/fastify\.post\(/.test(src[i])) ok(false, `${file}:${i + 1} 非标准形态的 POST 路由声明, 结构闸无法判定: ${src[i].trim().slice(0, 80)}`); continue; }
    const route = m[1];
    const next = (src[i + 1] || '').trim();
    const reopened = /^const _noKas = assertNoKasStakeUnlessReopened\('([^']+)', '([^']+)'\); if \(_noKas\) return reply\.code\(_noKas\.http\)\.send\(_noKas\.body\);/.exec(next);
    if (reopened) {
      const exp = REOPENED.find(([u]) => u.replace(/\/m1\//, '/:id/') === route);
      ok(!!exp && exp[1] === reopened[1] && REOPENED_ROUTES[reopened[1]] === reopened[2], `${file}:${i + 2} ${route} 重开路由: 第一条语句 = assertNoKasStakeUnlessReopened('${reopened[1]}', '${reopened[2]}') 且 id 与 REOPENED_ROUTES 一致`);
      continue;
    }
    const gated = /^const _noKas = assertNoKasStakeOnMainnet\('([^']+)'\); if \(_noKas\) return reply\.code\(_noKas\.http\)\.send\(_noKas\.body\);/.exec(next);
    if (gated) {
      const exp = GATED.find(([u]) => u.replace(/\/m1\//, '/:id/') === route);
      ok(!!exp && exp[1] === gated[1], `${file}:${i + 2} ${route} 第一条语句 = assertNoKasStakeOnMainnet('${gated[1]}')`);
    } else {
      ok(NOT_COLLECTING.has(route), `${file} ${route} 未受闸 ⇒ 必须在 NOT_COLLECTING 白名单`);
    }
  }
}
ok(GATED.length === 15 && REOPENED.length === 2, `受闸路由 15 条 + 显式重开 2 条 = 17(pool 12 + proto 5), 实 ${GATED.length}+${REOPENED.length}`);

// ── 5. worldcup-schedule 开关 ──
console.log('[test] 5. WORLDCUP_SCHEDULE_ENABLED 默认关');
ok(worldcupScheduleEnabled({}) === false && worldcupScheduleEnabled({ WORLDCUP_SCHEDULE_ENABLED: '0' }) === false && worldcupScheduleEnabled({ WORLDCUP_SCHEDULE_ENABLED: 'true' }) === false, '未设 / 0 / true ⇒ 关(只认字面 1)');
ok(worldcupScheduleEnabled({ WORLDCUP_SCHEDULE_ENABLED: '1' }) === true, "'1' ⇒ 开");
{
  const logs = []; const orig = console.log; console.log = (...a) => { logs.push(a.join(' ')); };
  delete process.env.WORLDCUP_SCHEDULE_ENABLED; calls.send = 0;
  try { startWorldcupScheduleCron(); startWorldcupScheduleCron(); } finally { console.log = orig; }
  ok(logs.some((l) => /\[worldcup-schedule\] disabled/.test(l)), 'env 未设 ⇒ 日志含 "[worldcup-schedule] disabled"');
  ok(!logs.some((l) => /starting/.test(l)), '未设 ⇒ 没有 "starting"(没起 timer, 没发首个 tick)');
}

await app.close();
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exit(fails ? 1 : 0);
