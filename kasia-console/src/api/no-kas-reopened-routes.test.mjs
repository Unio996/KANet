// no-kas-reopened-routes.test.mjs — 账本1846 S1 + S2: 主网「不收 KAS」硬闸的两条【显式重开】分支的回归。
//   S2 create-v07: 主网只开"ZK 原生盘·不建 spine·不转账·无 100/5 KAS 下限·maker_stake_amount=0"; zk_native=false / 非法 spec 仍 403。
//   S1 register-v07: 主网走"网关代付"(下注人钱包零转账; bettor_pk 仍由下注人地址推出), 字段 stake_ktt, stake_kas 不读。
//   测试网/simnet(不设 KANET_NO_KAS_STAKE_MODE)行为不变: 仍要求 maker_stake_kas ≥ 100、仍向网关转 stake+2 KAS。
//   余额不变 = 打桩计数: transferAndConfirm 零调用 + 没有任何发给下注人/开盘人钱包的 relay 命令 + 只有 get_pubkey 这类只读命令。
//   也含 S0 结构闸对重开路由的升级: 重开路由第一条语句必须是 assertNoKasStakeUnlessReopened(同名, 且 id == REOPENED_ROUTES)。
// Run: cd kasia-console && node src/api/no-kas-reopened-routes.test.mjs   (自举: 临时 migration 库 + --experimental-test-module-mocks)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'node:url';

if (!process.env._NOKAS_REOPEN_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_nokas_reopen_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'simnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _NOKAS_REOPEN_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
process.env.KASPA_NETWORK = 'mainnet';
delete process.env.KANET_NO_KAS_STAKE_MODE; delete process.env.KANET_TESTNET_NO_LIMITS; delete process.env.PROTO_DRIVER_ENABLED; delete process.env.PROTO_RELAY_ID;
process.env.ZK_GATE_TMPL_HASH = 'd4'.repeat(32); process.env.ZK_CLOSEZK_SIL_PATH = 'D:/none/CloseZkV2.sil';   // zk_native 目标盘走 _resolveZkNativeCtorExtras(只查 env 存在; 重活 ensureGateTmplHashFresh 在下面打桩)
process.env.ZK_SYSTEM_SINK_PK = 'ab'.repeat(32); process.env.ZK_CLAIM_RETIRE_DAA = '25920000';   // 账本1850: 主网 fail-closed 配置(缺则 create-v07 500)
process.env.ZK_TOKEN_TMPL_HASH = 'a1'.repeat(32); process.env.ZK_CLAIM_TMPL_HASH = 'b2'.repeat(32); process.env.ZK_MARKET_SUFFIX_HASH = 'c3'.repeat(32);

import { mock } from 'node:test';
import Fastify from 'fastify';

let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };

// ── 钥匙/地址(主网前缀, 合法校验和) ──
const kaspa = await import('kaspa-wasm');
const mk = (hex) => { const sk = new kaspa.PrivateKey(hex); const pub = sk.toPublicKey(); return { addrMain: pub.toAddress('mainnet').toString(), addrSim: pub.toAddress('simnet').toString(), xonly: pub.toXOnlyPublicKey().toString() }; };
const MAKER = mk('01'.repeat(32)), BETTOR = mk('02'.repeat(32)), ORACLE = mk('03'.repeat(32));

// ── 打桩 ──
const calls = { transfer: [], send: [], reg: [] };
const rmUrl = new URL('../services/relay-manager.js', import.meta.url).href;
const realRm = await import(rmUrl);
const { default: realRmDefault, ...realRmNamed } = realRm;
const stubSend = (relayId, cmd) => {
  calls.send.push({ relayId, type: cmd?.type });
  if (cmd?.type === 'get_pubkey' && globalThis.__STUB_SEND_DELAY_MS) return new Promise((r) => setTimeout(r, globalThis.__STUB_SEND_DELAY_MS)).then(() => ({ x_only_pubkey: MAKER.xonly, address: currentNet() === 'mainnet' ? MAKER.addrMain : MAKER.addrSim }));   // 5c 并发测试: 制造真实 await 间隙, 让两个 create 都先过早失败检查
  if (cmd?.type === 'get_pubkey') return Promise.resolve({ x_only_pubkey: MAKER.xonly, address: currentNet() === 'mainnet' ? MAKER.addrMain : MAKER.addrSim });
  if (cmd?.type === 'send_broadcast') return Promise.resolve({ txId: 'bcast' });
  return Promise.reject(new Error('stubbed relay command ' + cmd?.type));
};
const stubTransfer = (...a) => { calls.transfer.push(a); return Promise.reject(new Error('stubbed transfer')); };
mock.module(rmUrl, { namedExports: { ...realRmNamed, sendCommandAsync: stubSend, transferAndConfirm: stubTransfer, isRelayAlive: () => ({ alive: true }) }, ...(realRmDefault !== undefined ? { defaultExport: realRmDefault } : {}) });
const psrUrl = new URL('../lib/pool-shard-register.mjs', import.meta.url).href;
const realPsr = await import(psrUrl);
const { default: realPsrDefault, ...realPsrNamed } = realPsr;
const stubRegister = (o) => { calls.reg.push(o); return Promise.resolve({ action: 'use', shardIndex: 0, shardMarketId: o.logicalMarketId + '-s0', leafTx: 'ff'.repeat(32) }); };
mock.module(psrUrl, { namedExports: { ...realPsrNamed, registerBettorOnShard: stubRegister, computeCloseZkTmplAnchor: () => ({ anchorHex: '00'.repeat(32) }) }, ...(realPsrDefault !== undefined ? { defaultExport: realPsrDefault } : {}) });

const gthUrl = new URL('../lib/gate-tmpl-hash.mjs', import.meta.url).href;
const realGth = await import(gthUrl);
const { default: realGthDefault, ...realGthNamed } = realGth;
mock.module(gthUrl, { namedExports: { ...realGthNamed, ensureGateTmplHashFresh: () => {} }, ...(realGthDefault !== undefined ? { defaultExport: realGthDefault } : {}) });

const { sqlite } = await import('../db/client.js');
const { registerPoolRoutes } = await import('./pool.js');
const { REOPENED_ROUTES, noKasStakeModeOn, assertNoKasStakeUnlessReopened, mainnetCreateV07Branch, parseStakeKtt, NO_KAS_STAKE_CODE } = await import('../lib/mainnet-no-kas-stake-gate.mjs');
const currentNet = () => process.env.KASPA_NETWORK;
sqlite.pragma('foreign_keys = OFF');

// ── 夹具 ──
const rinfo = sqlite.pragma('table_info(relay_nodes)').filter((c) => c.notnull === 1 && c.dflt_value == null && c.name !== 'id');
const addRelay = (id, addr, isOracle = 0) => { const row = { id, name: id, address: addr, created_at: 'x', updated_at: 'x', is_oracle: isOracle }; for (const c of rinfo) if (!(c.name in row)) row[c.name] = 'x'; sqlite.prepare(`INSERT OR REPLACE INTO relay_nodes (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row)); };
const putAddrs = (net) => { addRelay('maker-r', net === 'mainnet' ? MAKER.addrMain : MAKER.addrSim); addRelay('bettor-r', net === 'mainnet' ? BETTOR.addrMain : BETTOR.addrSim); addRelay('oracle-r', net === 'mainnet' ? ORACLE.addrMain : ORACLE.addrSim, 1); };
sqlite.prepare("INSERT INTO oracle_pool_chain_view (snapshot_daa, leaves_json, merkle_root, pool_size, derived_at) VALUES (1,'[]',?,6,'x')").run('ab'.repeat(32));
const minfo = sqlite.pragma('table_info(pool_markets)').filter((c) => c.notnull === 1 && c.dflt_value == null && c.name !== 'id');
const seedMarket = (id, over = {}) => { const row = { id, maker_relay_id: 'maker-r', protocol_version: 'v0.7', protocol_status: 'pending_bettors', spine_p2sh: null, spine_lock_tx: null, maker_stake_amount: 0, deadline: Math.floor(Date.now() / 1000) + 7200, pool_merkle_root: 'ab'.repeat(32), oracle_relay_ids: '[]', resolution_rule_spec: JSON.stringify({ title: 't', resolution_criteria: 'c', data_source_canonical: 'u', zk_native: true }), metadata: '{}', market_metadata_hash: 'cd'.repeat(32), maker_pk: MAKER.xonly, broker_pk: MAKER.xonly, ...over }; for (const c of minfo) if (!(c.name in row)) row[c.name] = /INT/i.test(c.type) ? 1 : 'x'; sqlite.prepare(`INSERT OR REPLACE INTO pool_markets (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row)); };
const app = Fastify(); await registerPoolRoutes(app); await app.ready();
const post = (url, payload) => Promise.race([app.inject({ method: 'POST', url, payload }), new Promise((_, rej) => setTimeout(() => rej(new Error('inject timeout')), 30000))]);
const J = (res) => { try { return JSON.parse(res.body); } catch { return {}; } };
const reset = () => { calls.transfer.length = 0; calls.send.length = 0; calls.reg.length = 0; };
const spec = (extra = {}) => JSON.stringify({ title: 'Will X?', resolution_criteria: 'blockhash parity', data_source_canonical: 'kaspa:blockhash_parity', judge_type: 'blockhash_parity', ...extra });
const createBody = (over = {}) => ({ maker_relay_id: 'maker-r', outcome_side: 'YES', outcome_end_date: new Date(Date.now() + 2 * 3600e3).toISOString(), resolution_rule_spec: spec(), pool_merkle_root: 'ab'.repeat(32), ...over });

// ═══ 0. 闸库: 重开 API ═══
console.log('[test] 0. 重开 API');
ok(JSON.stringify(Object.keys(REOPENED_ROUTES).sort()) === JSON.stringify(['create-v07', 'register-v07']) && REOPENED_ROUTES['create-v07'] === 'S2-zk-native-no-spine' && REOPENED_ROUTES['register-v07'] === 'S1-gateway-sponsor', '重开清单恰两条, id 固定');
ok(assertNoKasStakeUnlessReopened('create-v07', 'wrong-id', { KASPA_NETWORK: 'mainnet' })?.http === 403, 'reopen id 对不上 ⇒ 403(fail-closed)');
ok(assertNoKasStakeUnlessReopened('create-v06', 'S2-zk-native-no-spine', { KASPA_NETWORK: 'mainnet' })?.http === 403, '未登记的路由名 ⇒ 403(不能借别的路由的 id 重开)');
ok(assertNoKasStakeUnlessReopened('create-v07', 'S2-zk-native-no-spine', { KASPA_NETWORK: 'mainnet' }) === null, '主网 + 正确 id ⇒ 放行进分支守卫');
ok(assertNoKasStakeUnlessReopened('create-v07', 'S2-zk-native-no-spine', { KASPA_NETWORK: 'foo' })?.http === 403, '网络未知 ⇒ 仍 fail-closed');
ok(noKasStakeModeOn({ KASPA_NETWORK: 'mainnet' }) && !noKasStakeModeOn({ KASPA_NETWORK: 'simnet' }) && noKasStakeModeOn({ KASPA_NETWORK: 'simnet', KANET_NO_KAS_STAKE_MODE: '1' }) && noKasStakeModeOn({}), '模式位: 主网 ⇒ 开; simnet ⇒ 关; simnet+flag ⇒ 开; 网络未配 ⇒ 开(fail-closed)');
ok(mainnetCreateV07Branch('{"zk_native":false}')?.http === 403 && mainnetCreateV07Branch('not json')?.http === 403 && mainnetCreateV07Branch('{}') === null && mainnetCreateV07Branch('{"zk_native":true}') === null, '分支守卫: zk_native=false/非法 JSON ⇒ 403; 缺省/true ⇒ 放行');
ok(parseStakeKtt({ stake_kas: 5 }, 1e8).ok === false && parseStakeKtt({ stake_ktt: 5 }, 1e8).ok === false && parseStakeKtt({ stake_ktt: 1.5e8 + 0.5 }, 1e8).ok === false && parseStakeKtt({ stake_ktt: 150000000 }, 1e8).stakeUnits === 150000000 && parseStakeKtt({ stake_ktt: '150000000' }, 1e8).stakeUnits === 150000000, 'parseStakeKtt: 只认 stake_ktt 整数 ≥ 下限(stake_kas 不读)');

// ═══ 1. S2 create-v07 ═══
console.log('[test] 1. S2 create-v07 主网: ZK 原生·无 spine·零转账');
process.env.KASPA_NETWORK = 'mainnet'; putAddrs('mainnet'); reset();
let marketId;
{
  const res = await post('/api/pool/market/create-v07', createBody({ maker_stake_kas: 500 }));   // 传了 maker_stake_kas=500 也必须被忽略
  const j = J(res);
  ok(res.statusCode === 200 && j.ok === true && j.no_kas_stake === true, `200 ok + no_kas_stake(实 ${res.statusCode} ${String(res.body).slice(0, 160)})`);
  ok(j.spine_p2sh === null && j.spine_lock_tx === null && j.maker_stake_locked_kas === 0, '响应: spine_p2sh/spine_lock_tx = null, maker_stake_locked_kas = 0');
  marketId = j.market_id;
  const row = sqlite.prepare('SELECT * FROM pool_markets WHERE id = ?').get(marketId) || {};
  const md = (() => { try { return JSON.parse(row.metadata); } catch { return {}; } })();
  ok(row.spine_p2sh === null && row.spine_lock_tx === null && Number(row.maker_stake_amount) === 0 && row.protocol_status === 'pending_bettors' && row.protocol_version === 'v0.7', 'DB 行: spine 两列 NULL, maker_stake_amount=0, pending_bettors, v0.7');
  ok(md.no_spine === true && !md.spine_redeem_script_hex, 'metadata.no_spine=true 且没有 spine_redeem_script_hex');
  ok(JSON.parse(row.resolution_rule_spec).zk_native === true, 'spec.zk_native 默认补 true(既有行为)');
  ok(calls.transfer.length === 0, `transferAndConfirm 零调用(实 ${calls.transfer.length})`);
  const types = [...new Set(calls.send.map((c) => c.type))];
  ok(types.every((t) => t === 'get_pubkey'), `只有只读命令 get_pubkey, 没有 send_broadcast/任何移动 KAS 的命令(实 ${JSON.stringify(types)})`);
  ok(!calls.send.some((c) => c.relayId === 'bettor-r'), '没有任何命令发给下注人 relay');
}
reset();
{
  const before = sqlite.prepare('SELECT COUNT(*) c FROM pool_markets').get().c;
  for (const [label, rs] of [['zk_native=false', spec({ zk_native: false })], ['非法 JSON', 'not json']]) {
    const res = await post('/api/pool/market/create-v07', createBody({ resolution_rule_spec: rs }));
    ok(res.statusCode === 403 && J(res).code === NO_KAS_STAKE_CODE, `主网 ${label} ⇒ 403`);
  }
  ok(sqlite.prepare('SELECT COUNT(*) c FROM pool_markets').get().c === before && calls.transfer.length === 0 && calls.send.length === 0, '被拒的两次: 无新行、零转账、零 relay 命令(先于任何查库)');
}

// ═══ 2. S1 register-v07 ═══
console.log('[test] 2. S1 register-v07 主网: 网关代付·下注人零转账');
seedMarket('m-reg'); reset();
{
  const res = await post('/api/pool/market/m-reg/bettor/register-v07', { bettor_relay_id: 'bettor-r', direction: 0, stake_ktt: 150000000, stake_kas: 99 });
  const j = J(res);
  ok(res.statusCode === 200 && j.ok === true && j.no_kas_stake === true && j.stake_ktt === 150000000, `200 ok(实 ${res.statusCode} ${String(res.body).slice(0, 200)})`);
  ok(calls.transfer.length === 0, `transferAndConfirm 零调用 = 下注人钱包零转账(实 ${calls.transfer.length})`);
  ok(!calls.send.some((c) => c.relayId === 'bettor-r'), '没有任何 relay 命令发给下注人 relay');
  ok(calls.send.every((c) => c.type === 'get_pubkey'), `路由层只发了只读 get_pubkey(实 ${JSON.stringify([...new Set(calls.send.map((c) => c.type))])})`);
  ok(calls.reg.length === 1 && calls.reg[0].stakeSompi === 150000000, `registerBettorOnShard 收到的是 stake_ktt 原数(实 ${calls.reg[0]?.stakeSompi}), 没有 ×1e8 的 KAS 换算`);
  ok(calls.reg[0]?.bettorPk === BETTOR.xonly, 'bettor_pk 仍由下注人钱包地址推出(输赢归属不变)');
  ok(calls.reg[0]?.relayAddr === MAKER.addrMain, '付费方 = 网关(maker relay)自己的地址');
}
reset();
{
  const r1 = await post('/api/pool/market/m-reg/bettor/register-v07', { bettor_relay_id: 'bettor-r', direction: 0, stake_kas: 5 });
  ok(r1.statusCode === 400 && J(r1).code === 'stake_ktt_required', '只给 stake_kas ⇒ 400 stake_ktt_required(主网不读 stake_kas)');
  const r2 = await post('/api/pool/market/m-reg/bettor/register-v07', { bettor_relay_id: 'bettor-r', direction: 0, stake_ktt: 5 });
  ok(r2.statusCode === 400 && J(r2).code === 'stake_ktt_required', 'stake_ktt 低于下限 ⇒ 400');
  seedMarket('m-reg-o', { oracle_relay_ids: JSON.stringify(['bettor-r']) });
  const r3 = await post('/api/pool/market/m-reg-o/bettor/register-v07', { bettor_relay_id: 'bettor-r', direction: 0, stake_ktt: 150000000 });
  ok(r3.statusCode === 403, '委员不能下注(area-1 互斥)仍有效');
  ok(calls.transfer.length === 0 && calls.reg.length === 0, '三次被拒: 零转账、零 register');
}
reset();
{
  seedMarket('m-legacy', { resolution_rule_spec: JSON.stringify({ title: 't', resolution_criteria: 'c', data_source_canonical: 'u' }) });   // 旧 V1 盘: zk_native 缺省
  seedMarket('m-spine', { spine_p2sh: MAKER.addrMain, spine_lock_tx: 'ee'.repeat(32) });                                                    // 带 spine 的旧 KAS 模型盘
  seedMarket('m-badspec', { resolution_rule_spec: 'not json' });
  for (const id of ['m-legacy', 'm-spine', 'm-badspec']) {
    const r = await post(`/api/pool/market/${id}/bettor/register-v07`, { bettor_relay_id: 'bettor-r', direction: 0, stake_ktt: 150000000 });
    ok(r.statusCode === 403 && J(r).code === NO_KAS_STAKE_CODE, `主网 register-v07 目标盘 ${id} ⇒ 403(legacy 行进不了网关代付分支)`);
  }
  ok(calls.transfer.length === 0 && calls.reg.length === 0 && calls.send.length === 0, '三个被拒的目标盘: 零转账、零 register、零 relay 命令(守卫在 get_pubkey 之前)');
}
reset();
for (const path of ['register-v07/prep', 'register-v07/confirm', 'register', 'register-external/prep', 'register-external/confirm', 'register-v06/prep', 'register-v06/confirm']) {
  const res = await post(`/api/pool/market/m-reg/bettor/${path}`, { bettor_relay_id: 'bettor-r', direction: 0, stake_kas: 1, stake_ktt: 150000000 });
  ok(res.statusCode === 403 && J(res).code === NO_KAS_STAKE_CODE, `主网 ${path} 仍 403`);
}
{
  const res = await post('/api/pool/market/m-reg/oracle/deposit', { oracle_relay_id: 'oracle-r' });
  ok(res.statusCode === 403, '主网 oracle/deposit 仍 403');
  for (const p of ['create', 'create-v06']) ok((await post(`/api/pool/market/${p}`, createBody({ maker_stake_kas: 100 }))).statusCode === 403, `主网 ${p} 仍 403`);
  ok(calls.transfer.length === 0 && calls.send.length === 0 && calls.reg.length === 0, '其余 9 条: 零转账、零 relay 命令');
}

// ═══ 3. 无 spine 盘的 settle / refund-claim 干净 409 ═══
console.log('[test] 3. 无 spine 盘: /settle 与 /bettor-refund-claim 干净 409');
reset();
{
  const r1 = await post('/api/pool/market/m-reg/settle', {});
  ok(r1.statusCode === 409 && /no_spine_market/.test(r1.body), '/settle ⇒ 409 no_spine_market(不会把盘翻到 verifying 交给 legacy 结算器)');
  ok(sqlite.prepare("SELECT protocol_status s FROM pool_markets WHERE id='m-reg'").get().s === 'pending_bettors', '状态仍 pending_bettors');
  const r2 = await post('/api/pool/market/m-reg/bettor-refund-claim', { bettor_pk: BETTOR.xonly });
  ok(r2.statusCode === 409 && /no_spine_market/.test(r2.body), '/bettor-refund-claim ⇒ 409 no_spine_market(不是 500)');
}

// ═══ 4. 非主网(simnet, 不设模式位)行为不变 ═══
console.log('[test] 4. simnet(无 KANET_NO_KAS_STAKE_MODE): 老行为不变');
process.env.KASPA_NETWORK = 'simnet'; putAddrs('simnet'); reset();
{
  const r0 = await post('/api/pool/market/create-v07', createBody());
  ok(r0.statusCode === 400 && /missing maker_stake_kas/.test(r0.body), 'create-v07 仍要求 maker_stake_kas');
  const r1 = await post('/api/pool/market/create-v07', createBody({ maker_stake_kas: 50 }));
  ok(r1.statusCode === 400 && /maker_stake_kas/.test(r1.body), 'create-v07 maker_stake_kas<100 仍 400(100 KAS 下限原样)');
  ok(calls.transfer.length === 0, '以上两次未到转账');
  const r2 = await post('/api/pool/market/m-reg/bettor/register-v07', { bettor_relay_id: 'bettor-r', direction: 0, stake_kas: 1 });
  ok(calls.transfer.length === 1 && calls.transfer[0][0] === 'bettor-r' && calls.transfer[0][2] === '3.00000000', `register-v07 仍向网关转 stake+2 KAS(实 ${JSON.stringify(calls.transfer[0]?.slice(0, 3))})`);
  ok(r2.statusCode === 503, '转账桩失败 ⇒ 503 bettor→gateway funding failed(老行为)');
  const r3 = await post('/api/pool/market/m-reg/bettor/register-v07', { bettor_relay_id: 'bettor-r', direction: 0, stake_ktt: 150000000 });
  ok(r3.statusCode === 400, 'simnet 不收 stake_ktt: 缺 stake_kas ⇒ 400(stake_kas 仍是老字段)');
}

// ═══ 5. simnet + KANET_NO_KAS_STAKE_MODE=1(S3 彩排用)= 与主网同款 ═══
console.log('[test] 5. simnet + KANET_NO_KAS_STAKE_MODE=1 ⇒ 与主网同款(只会加严)');
process.env.KANET_NO_KAS_STAKE_MODE = '1'; reset();
{
  const r0 = await post('/api/pool/market/create-v07', createBody({ resolution_rule_spec: spec({ zk_native: false }) }));
  ok(r0.statusCode === 403, 'zk_native=false ⇒ 403');
  const r1 = await post('/api/pool/market/m-reg/bettor/register-v07', { bettor_relay_id: 'bettor-r', direction: 1, stake_ktt: 120000000 });
  ok(r1.statusCode === 200 && calls.transfer.length === 0 && calls.reg.length === 1, 'register-v07 stake_ktt ⇒ 200 且零转账');
  const r2 = await post('/api/pool/market/m-reg/bettor/register-v07/prep', {});
  ok(r2.statusCode === 403, 'prep ⇒ 403');
  const r1b = await post('/api/pool/market/m-reg/bettor/register-v07', { bettor_relay_id: 'bettor-r' });   // 缺 direction
  ok(r1b.statusCode === 400 && /stake_ktt/.test(r1b.body) && !/stake_kas required/.test(r1b.body), `无 KAS 模式缺参错误文案提 stake_ktt(实 ${r1b.statusCode} ${String(r1b.body).slice(0, 120)})`);
}
delete process.env.KANET_NO_KAS_STAKE_MODE;

// ═══ 5b. 账本1850 严格零: create-v07 的两道闸(一次一盘 409 / 市场不得比票活得久 400 / 配置缺失 fail-closed) ═══
console.log('[test] 5b. create-v07 严格零闸');
process.env.KASPA_NETWORK = 'mainnet'; putAddrs('mainnet'); reset();
{
  const finish = () => sqlite.prepare("UPDATE pool_markets SET protocol_status = 'cancelled'").run();
  finish();
  const before = sqlite.prepare('SELECT COUNT(*) c FROM pool_markets').get().c;
  // (a) 已有一个未完结的 zk_native 盘(protocol_status 非终态, metadata 无 exhausted) ⇒ 409, 一行不新增、零转账
  seedMarket('m-zk-live', { resolution_rule_spec: spec({ zk_native: true }), protocol_status: 'attested_v2', metadata: JSON.stringify({ zk_continuation: { exhausted: false } }) });
  const n1 = sqlite.prepare('SELECT COUNT(*) c FROM pool_markets').get().c;
  const r1 = await post('/api/pool/market/create-v07', createBody());
  ok(r1.statusCode === 409 && J(r1).code === 'live_market_cap_reached' && J(r1).blocking_market_id === 'm-zk-live', `另一 zk_native 盘未完结(attested_v2 + exhausted≠true) ⇒ 409 带 blocking_market_id(实 ${r1.statusCode} ${String(r1.body).slice(0, 140)})`);
  ok(sqlite.prepare('SELECT COUNT(*) c FROM pool_markets').get().c === n1 && calls.transfer.length === 0 && calls.send.length === 0, '409: 无新行、零转账、零 relay 命令(闸先于 get_pubkey)');
  // (b) 同一盘 exhausted=true ⇒ 视为完结, 放行
  sqlite.prepare("UPDATE pool_markets SET metadata = ? WHERE id = 'm-zk-live'").run(JSON.stringify({ zk_continuation: { exhausted: true } }));
  // (c) 终态 completed/refunded/cancelled/expired ⇒ 完结; 非 zk_native 盘/shard_internal 行不挡
  seedMarket('m-legacy-live', { resolution_rule_spec: JSON.stringify({ title: 't', resolution_criteria: 'c', data_source_canonical: 'u' }), protocol_status: 'pending_bettors' });
  seedMarket('m-shard-row', { resolution_rule_spec: spec({ zk_native: true }), protocol_status: 'shard_internal' });
  // (d) 配置缺失 ⇒ fail-closed 500(不放行)
  const savedSink = process.env.ZK_SYSTEM_SINK_PK; delete process.env.ZK_SYSTEM_SINK_PK; reset();
  const r2 = await post('/api/pool/market/create-v07', createBody());
  ok(r2.statusCode === 500 && /ZK_SYSTEM_SINK_PK/.test(r2.body) && calls.transfer.length === 0, `主网缺 ZK_SYSTEM_SINK_PK ⇒ 500 fail-closed(实 ${r2.statusCode})`);
  process.env.ZK_SYSTEM_SINK_PK = savedSink;
  const savedDaa = process.env.ZK_CLAIM_RETIRE_DAA; delete process.env.ZK_CLAIM_RETIRE_DAA;
  const r2b = await post('/api/pool/market/create-v07', createBody());
  ok(r2b.statusCode === 500 && /ZK_CLAIM_RETIRE_DAA/.test(r2b.body), '主网缺 ZK_CLAIM_RETIRE_DAA ⇒ 500 fail-closed');
  process.env.ZK_CLAIM_RETIRE_DAA = savedDaa;
  // (e) deadline 晚于 票龄-60天 ⇒ 400; 之内 ⇒ 过闸(此处只断言没被这道闸拦: 状态码 ≠ 400 deadline_exceeds_ticket_age)
  process.env.POOL_DEADLINE_MAX_DAY = '4000'; process.env.ZK_TICKET_SWEEP_DAA = '315360000'; reset();   // 365 天 - 60 天 = 最晚 305 天
  const far = await post('/api/pool/market/create-v07', createBody({ outcome_end_date: new Date(Date.now() + 340 * 86400e3).toISOString() }));
  ok(far.statusCode === 400 && J(far).code === 'deadline_exceeds_ticket_age', `deadline=now+340d > 365d-60d ⇒ 400 deadline_exceeds_ticket_age(实 ${far.statusCode} ${String(far.body).slice(0, 140)})`);
  const near = await post('/api/pool/market/create-v07', createBody({ outcome_end_date: new Date(Date.now() + 300 * 86400e3).toISOString() }));
  ok(near.statusCode !== 400 || J(near).code !== 'deadline_exceeds_ticket_age', `deadline=now+300d ≤ 305d ⇒ 不被票龄闸拦(实 ${near.statusCode})`);
  finish();
  process.env.ZK_TICKET_SWEEP_DAA = '864000'; reset();   // 票龄 1 天 ⇒ 任何 deadline 都晚于 1d-60d
  const tiny = await post('/api/pool/market/create-v07', createBody());
  ok(tiny.statusCode === 400 && J(tiny).code === 'deadline_exceeds_ticket_age', '票龄 < 结算余量 ⇒ 任何 deadline 都 400');
  delete process.env.ZK_TICKET_SWEEP_DAA; delete process.env.POOL_DEADLINE_MAX_DAY;
  // (f) 全部完结后放行(回到 S2 的 200 路径)
  finish(); reset();
  const r3 = await post('/api/pool/market/create-v07', createBody());
  ok(r3.statusCode === 200 && J(r3).ok === true && J(r3).no_kas_stake === true, `全部完结后 create-v07 ⇒ 200(实 ${r3.statusCode} ${String(r3.body).slice(0, 120)})`);
  // (g) 非不收 KAS 模式(simnet 无 flag)完全不受影响: 不查"一次一盘"
  process.env.KASPA_NETWORK = 'simnet'; putAddrs('simnet'); reset();
  const r4 = await post('/api/pool/market/create-v07', createBody());
  ok(r4.statusCode === 400 && /missing maker_stake_kas/.test(r4.body), 'simnet(无模式位)仍是老行为, 不触发一次一盘闸');
}

// ═══ 5c. 账本1855 A: 一次一盘 → 可配上限 ZK_MAX_LIVE_MARKETS(默认 1); 上限-1 时两个并发 create 恰一个成功 ═══
console.log('[test] 5c. ZK_MAX_LIVE_MARKETS 上限 + 并发 create 原子性');
process.env.KASPA_NETWORK = 'mainnet'; putAddrs('mainnet'); reset();
{
  const finish = () => sqlite.prepare("UPDATE pool_markets SET protocol_status = 'cancelled'").run();
  const live = () => sqlite.prepare("SELECT COUNT(*) c FROM pool_markets WHERE protocol_status NOT IN ('cancelled','shard_internal')").get().c;
  finish();
  // (a) 未设/非法 ⇒ 上限 1(与 1850 行为一致)
  for (const bad of [undefined, '', '0', '-2', 'abc', '1.5', '101']) {
    if (bad === undefined) delete process.env.ZK_MAX_LIVE_MARKETS; else process.env.ZK_MAX_LIVE_MARKETS = bad;
    finish(); seedMarket('m-cap-a' + String(bad), { resolution_rule_spec: spec({ zk_native: true }), protocol_status: 'attested_v2', metadata: '{}' });
    const r = await post('/api/pool/market/create-v07', createBody());
    ok(r.statusCode === 409 && J(r).cap === 1, `ZK_MAX_LIVE_MARKETS=${bad === undefined ? '(unset)' : JSON.stringify(bad)} ⇒ 上限 1, 已有 1 个 ⇒ 409(实 ${r.statusCode} ${String(r.body).slice(0, 90)})`);
  }
  // (b) 上限 3, 已有 2 ⇒ 过; 满 3 ⇒ 409 且 live/cap 如实
  process.env.ZK_MAX_LIVE_MARKETS = '3'; finish(); reset();
  seedMarket('m-cap-1', { resolution_rule_spec: spec({ zk_native: true }), protocol_status: 'pending_bettors', metadata: '{}' });
  seedMarket('m-cap-2', { resolution_rule_spec: spec({ zk_native: true }), protocol_status: 'pending_bettors', metadata: '{}' });
  const rOk = await post('/api/pool/market/create-v07', createBody({ outcome_condition_id: '0x' + 'a1'.repeat(32) }));
  ok(rOk.statusCode === 200 && live() === 3, `上限 3, 已有 2 ⇒ 第 3 个放行(实 ${rOk.statusCode} ${String(rOk.body).slice(0, 100)})`);
  const rFull = await post('/api/pool/market/create-v07', createBody({ outcome_condition_id: '0x' + 'a2'.repeat(32) }));
  ok(rFull.statusCode === 409 && J(rFull).code === 'live_market_cap_reached' && J(rFull).live === 3 && J(rFull).cap === 3 && live() === 3, '满 3/3 ⇒ 409 live_market_cap_reached(live=3, cap=3), 不新增行');
  // (c) 并发: 上限 3, 已有 2 ⇒ 同时发 2 个 create ⇒ 恰一个 200, 一个 409, 终态恰 3 个在跑
  finish(); reset();
  seedMarket('m-race-1', { resolution_rule_spec: spec({ zk_native: true }), protocol_status: 'pending_bettors', metadata: '{}' });
  seedMarket('m-race-2', { resolution_rule_spec: spec({ zk_native: true }), protocol_status: 'pending_bettors', metadata: '{}' });
  globalThis.__STUB_SEND_DELAY_MS = 40;
  const [ra, rb] = await Promise.all([
    post('/api/pool/market/create-v07', createBody({ outcome_condition_id: '0x' + 'b1'.repeat(32) })),
    post('/api/pool/market/create-v07', createBody({ outcome_condition_id: '0x' + 'b2'.repeat(32) })),
  ]);
  globalThis.__STUB_SEND_DELAY_MS = 0;
  const codes = [ra.statusCode, rb.statusCode].sort();
  ok(codes[0] === 200 && codes[1] === 409 && live() === 3, `cap-1 并发 2 个 create ⇒ 恰一个 200 一个 409, 在跑恰 3(实 ${codes.join('/')} live=${live()})`);
  const loser = ra.statusCode === 409 ? ra : rb;
  ok(J(loser).code === 'live_market_cap_reached', '败者回 live_market_cap_reached');
  delete process.env.ZK_MAX_LIVE_MARKETS; finish(); reset();
}

// ═══ 6. 结构闸: 重开路由第一条语句 ═══
console.log('[test] 6. 结构: 重开路由第一条语句');
{
  const src = fs.readFileSync(fileURLToPath(new URL('./pool.js', import.meta.url)), 'utf8').split('\n');
  for (const [name, id] of Object.entries(REOPENED_ROUTES)) {
    const idx = src.findIndex((l) => l.includes(`/bettor/${name}', async`) || l.includes(`/market/${name}', async`));
    const next = (src[idx + 1] || '').trim();
    ok(idx >= 0 && next.startsWith(`const _noKas = assertNoKasStakeUnlessReopened('${name}', '${id}'); if (_noKas) return reply.code(_noKas.http).send(_noKas.body);`), `${name}: 第一条语句 = assertNoKasStakeUnlessReopened('${name}', '${id}')`);
  }
  const uses = src.filter((l) => l.includes('assertNoKasStakeUnlessReopened(') && !l.startsWith('import')).length;
  ok(uses === Object.keys(REOPENED_ROUTES).length, `pool.js 里只有 ${uses} 处使用重开版闸(== 清单长度, 没有偷偷多开的路由)`);
}

await app.close();
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;   // 不 process.exit: 在途的 fetch/句柄还在关闭时 Windows libuv 会断言 UV_HANDLE_CLOSING(exit 1), 让事件循环自然排空
