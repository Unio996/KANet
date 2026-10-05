// zk-bet-cost-gate-routes.test.mjs — 账本1861 / D-036: 主网(不收 KAS 模式) register-v07 的服务端成本闸 —— 每 bettor_pk 每 UTC 日 + 全系统每 UTC 日 下注上限。
//   计数 = pool_bettor_sides 行(zk_native 盘)+ 进程内在途预留; 查数+预留同步无 await; 被拒 ⇒ 429 且在任何链上动作之前(零 KAS)。
// Run: cd kasia-console && node src/api/zk-bet-cost-gate-routes.test.mjs   (自举: 临时 migration 库 + --experimental-test-module-mocks)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'node:url';

if (!process.env._BETGATE_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_betgate_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'simnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _BETGATE_BOOTSTRAPPED: '1' } });
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
const stubRegister = async (o) => { calls.reg.push(o); if (globalThis.__REG_HOOK) await globalThis.__REG_HOOK(o); return { action: 'use', shardIndex: 0, shardMarketId: o.logicalMarketId + '-s0', leafTx: 'ff'.repeat(32) }; };
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

// ── 夹具: 模拟 recordBettor —— 链上动作(这里是可控延时)之后才写 pool_bettor_sides 行(行落在 shard 克隆行 market_id 上, 与生产一致) ──
const PKS = Array.from({ length: 12 }, (_, i) => String(i + 10).repeat(32).slice(0, 64));   // 64-hex x-only 假 pk(freshBettor 直传路径)
let _rowSeq = 0;
const insertRow = (pk, marketId, createdAt = null) => sqlite.prepare(`INSERT INTO pool_bettor_sides (market_id, bettor_pk, bettor_relay_id, direction, stake_amount, side_p2sh, side_lock_tx, merkle_index, side_redeem_script_hex${createdAt ? ', created_at' : ''}) VALUES (?,?,?,?,?,?,?,?,?${createdAt ? ',?' : ''})`)
  .run(...[marketId, pk, null, 0, 1, 'p', 'tx' + (++_rowSeq), 0, '', ...(createdAt ? [createdAt] : [])]);
let regDelay = 0, regFail = false;
globalThis.__REG_HOOK = async (o) => {
  if (regDelay) await new Promise((r) => setTimeout(r, regDelay));
  if (regFail) { regFail = false; throw new Error('simulated on-chain failure'); }
  insertRow(o.bettorPk, o.logicalMarketId + '-s0');
};
const wipe = () => { sqlite.prepare('DELETE FROM pool_bettor_sides').run(); _resetBetGateForTest(); reset(); };
const bet = (id, pk) => post(`/api/pool/market/${id}/bettor/register-v07`, { bettor_pk: pk, direction: 0, stake_ktt: 150000000 });
const { resolveBetCaps, reserveBetSlot, countBetsToday, utcDayBounds, _resetBetGateForTest, _inflightSnapshotForTest, BET_CAP_PK_CODE, BET_CAP_GLOBAL_CODE } = await import('../lib/zk-bet-cost-gate.mjs');

seedMarket('m-cap'); seedMarket('m-cap-s0', { protocol_status: 'shard_internal' });   // 逻辑盘 + shard 克隆(同 spec, zk_native)
seedMarket('m-leg', { resolution_rule_spec: JSON.stringify({ title: 't', resolution_criteria: 'c', data_source_canonical: 'u' }) }); seedMarket('m-leg-s0', { protocol_status: 'shard_internal', resolution_rule_spec: JSON.stringify({ title: 't', resolution_criteria: 'c', data_source_canonical: 'u' }) });

// ═══ 1. env 解析: 默认 5/50, 非法 ⇒ 默认(fail-closed 小) ═══
console.log('[test] 1. env 解析');
{
  ok(JSON.stringify(resolveBetCaps({})) === '{"perPk":5,"global":50}', '未设 ⇒ 5 / 50');
  for (const bad of ['', 'abc', '0', '-3', '2.5', '1e9', '100001', ' ']) ok(resolveBetCaps({ ZK_BET_MAX_PER_PK_DAY: bad, ZK_BET_MAX_GLOBAL_DAY: bad }).perPk === 5 && resolveBetCaps({ ZK_BET_MAX_GLOBAL_DAY: bad }).global === 50, `非法值 ${JSON.stringify(bad)} ⇒ 默认`);
  ok(resolveBetCaps({ ZK_BET_MAX_PER_PK_DAY: '2', ZK_BET_MAX_GLOBAL_DAY: '7' }).perPk === 2 && resolveBetCaps({ ZK_BET_MAX_GLOBAL_DAY: '7' }).global === 7, '合法值生效');
}

// ═══ 2. 每 pk 日上限 ═══
console.log('[test] 2. 每 pk 日上限(ZK_BET_MAX_PER_PK_DAY=2)');
process.env.ZK_BET_MAX_PER_PK_DAY = '2'; delete process.env.ZK_BET_MAX_GLOBAL_DAY; wipe(); regDelay = 0;
{
  const r1 = await bet('m-cap', PKS[0]), r2 = await bet('m-cap', PKS[0]);
  ok(r1.statusCode === 200 && r2.statusCode === 200, `前两笔 200(实 ${r1.statusCode}/${r2.statusCode} ${r1.body.slice(0, 120)})`);
  const regBefore = calls.reg.length, sendBefore = calls.send.length;
  const r3 = await bet('m-cap', PKS[0]); const j = J(r3);
  ok(r3.statusCode === 429 && j.code === BET_CAP_PK_CODE && j.cap === 2 && j.used === 2 && typeof j.resets_at === 'string' && Number(r3.headers['retry-after']) >= 1, `第三笔 429 ${BET_CAP_PK_CODE}(实 ${r3.statusCode} ${r3.body.slice(0, 200)})`);
  ok(calls.reg.length === regBefore && calls.send.slice(sendBefore).every((c) => c.type === 'get_pubkey') && calls.transfer.length === 0, '被拒的这笔: 没进 registerBettorOnShard、除只读 get_pubkey 外没发任何 relay 命令、零转账 = 零 KAS');
  const r4 = await bet('m-cap', PKS[1]);
  ok(r4.statusCode === 200, '另一个 pk 不受影响 ⇒ 200');
  ok(Object.keys(_inflightSnapshotForTest()).length === 0, '全部结束后在途预留清零(无泄漏)');
}

// ═══ 3. 全局日上限 ═══
console.log('[test] 3. 全局日上限(ZK_BET_MAX_GLOBAL_DAY=3)');
delete process.env.ZK_BET_MAX_PER_PK_DAY; process.env.ZK_BET_MAX_GLOBAL_DAY = '3'; wipe();
{
  const rs = []; for (let i = 0; i < 3; i++) rs.push(await bet('m-cap', PKS[i]));
  ok(rs.every((r) => r.statusCode === 200), '三个不同 pk 各 1 笔 ⇒ 全 200');
  const regBefore = calls.reg.length;
  const r4 = await bet('m-cap', PKS[5]); const j = J(r4);
  ok(r4.statusCode === 429 && j.code === BET_CAP_GLOBAL_CODE && j.cap === 3 && j.used === 3, `第 4 笔(新 pk) 429 ${BET_CAP_GLOBAL_CODE}(实 ${r4.statusCode} ${r4.body.slice(0, 160)})`);
  ok(calls.reg.length === regBefore && calls.transfer.length === 0, '被拒 ⇒ 零链上动作');
}
// 两闸同时超 ⇒ 先报 pk 码
console.log('[test] 3b. 两闸同超 ⇒ pk 码优先');
process.env.ZK_BET_MAX_PER_PK_DAY = '1'; process.env.ZK_BET_MAX_GLOBAL_DAY = '1'; wipe();
{ await bet('m-cap', PKS[0]); const r = await bet('m-cap', PKS[0]); ok(r.statusCode === 429 && J(r).code === BET_CAP_PK_CODE, '同 pk 再投 ⇒ bet_cap_pk_day'); }

// ═══ 4. 非 zk_native 盘的行不计数 ═══
console.log('[test] 4. 只数 zk_native 盘的行');
process.env.ZK_BET_MAX_PER_PK_DAY = '2'; delete process.env.ZK_BET_MAX_GLOBAL_DAY; wipe();
{
  insertRow(PKS[0], 'm-leg-s0'); insertRow(PKS[0], 'm-leg-s0'); insertRow(PKS[0], 'm-leg');
  ok(countBetsToday(sqlite, { pk: PKS[0] }) === 0, 'legacy 盘的行 countBetsToday=0');
  const r = await bet('m-cap', PKS[0]); ok(r.statusCode === 200, 'legacy 行不占 zk 上限 ⇒ 200');
}

// ═══ 5. UTC 日翻转 ═══
console.log('[test] 5. UTC 日翻转');
{
  wipe(); const now = Date.UTC(2026, 9, 5, 23, 59, 30);   // 2026-10-05 23:59:30Z
  const env = { ZK_BET_MAX_PER_PK_DAY: '2', ZK_BET_MAX_GLOBAL_DAY: '3' };
  insertRow(PKS[0], 'm-cap-s0', '2026-10-05 08:00:00'); insertRow(PKS[0], 'm-cap-s0', '2026-10-05 09:00:00');
  const full = reserveBetSlot(sqlite, PKS[0], { env, nowMs: now });
  ok(!full.ok && full.body.code === BET_CAP_PK_CODE && full.retryAfterSec === 30 && full.body.resets_at === '2026-10-06T00:00:00.000Z', `23:59:30Z 仍满 ⇒ 429, retry-after 30s, resets_at 次日 0 点(实 ${full.retryAfterSec} ${full.body?.resets_at})`);
  const nextDay = reserveBetSlot(sqlite, PKS[0], { env, nowMs: now + 31_000 });   // 00:00:01Z
  ok(nextDay.ok === true, '00:00:01Z(次日) 同一 pk 额度重置 ⇒ 放行'); nextDay.release();
  insertRow(PKS[1], 'm-cap-s0', '2026-10-05 12:00:00'); insertRow(PKS[2], 'm-cap-s0', '2026-10-05 13:00:00');   // 今日全局已 4 笔(≥3)
  const g = reserveBetSlot(sqlite, PKS[3], { env, nowMs: now }); ok(!g.ok && g.body.code === BET_CAP_GLOBAL_CODE, '当日全局满 ⇒ global 码');
  const g2 = reserveBetSlot(sqlite, PKS[3], { env, nowMs: now + 31_000 }); ok(g2.ok === true, '次日全局额度也重置 ⇒ 放行'); g2.release();
  ok(utcDayBounds(Date.UTC(2026, 9, 5, 0, 0, 0)).start === '2026-10-05 00:00:00', '日起点 00:00:00 含边界');
  ok(countBetsToday(sqlite, { nowMs: Date.UTC(2026, 9, 5, 0, 0, 0) }) === 4 && countBetsToday(sqlite, { nowMs: Date.UTC(2026, 9, 6, 0, 0, 0) }) === 0, '00:00:00 当天 4 笔; 次日 0 笔(昨日行不计)');
  _resetBetGateForTest();
}

// ═══ 6. 并发竞态: 距上限只差 1 笔时同时来 N 笔 ⇒ 恰 1 笔成功(链上动作有延时, 行晚于预留才写) ═══
console.log('[test] 6. 并发竞态 cap-1');
{
  // 6a 全局: 上限 3, 已 2 笔, 5 笔不同 pk 并发
  process.env.ZK_BET_MAX_GLOBAL_DAY = '3'; delete process.env.ZK_BET_MAX_PER_PK_DAY; wipe(); regDelay = 250;
  insertRow(PKS[8], 'm-cap-s0'); insertRow(PKS[9], 'm-cap-s0');
  const rs = await Promise.all([0, 1, 2, 3, 4].map((i) => bet('m-cap', PKS[i])));
  const codes = rs.map((r) => r.statusCode).sort();
  ok(codes.filter((c) => c === 200).length === 1 && codes.filter((c) => c === 429).length === 4, `全局 cap-1 并发 5 笔 ⇒ 恰 1×200 + 4×429(实 ${codes.join(',')})`);
  ok(calls.reg.length === 1, `只有 1 笔进了链上动作(实 ${calls.reg.length})`);
  ok(countBetsToday(sqlite) === 3 && Object.keys(_inflightSnapshotForTest()).length === 0, '结束后库里恰 3 行, 预留清零');
  // 6b 每 pk: 上限 2, 已 1 笔, 同 pk 并发 4 笔
  process.env.ZK_BET_MAX_PER_PK_DAY = '2'; delete process.env.ZK_BET_MAX_GLOBAL_DAY; wipe(); regDelay = 250;
  insertRow(PKS[0], 'm-cap-s0');
  const rs2 = await Promise.all([0, 1, 2, 3].map(() => bet('m-cap', PKS[0])));
  const c2 = rs2.map((r) => r.statusCode).sort();
  ok(c2.filter((c) => c === 200).length === 1 && c2.filter((c) => c === 429).length === 3 && rs2.filter((r) => r.statusCode === 429).every((r) => J(r).code === BET_CAP_PK_CODE), `每 pk cap-1 并发 4 笔 ⇒ 恰 1×200 + 3×bet_cap_pk_day(实 ${c2.join(',')})`);
  regDelay = 0;
}

// ═══ 7. 失败释放: 链上动作失败(500)不占额度 ═══
console.log('[test] 7. 失败释放预留');
process.env.ZK_BET_MAX_PER_PK_DAY = '1'; delete process.env.ZK_BET_MAX_GLOBAL_DAY; wipe(); regDelay = 0;
{
  regFail = true; const r1 = await bet('m-cap', PKS[0]);
  ok(r1.statusCode === 500, `链上失败 ⇒ 500(实 ${r1.statusCode})`);
  ok(Object.keys(_inflightSnapshotForTest()).length === 0, '失败后预留已释放');
  const r2 = await bet('m-cap', PKS[0]); ok(r2.statusCode === 200, '失败的那笔不占额度 ⇒ 重试 200');
}

// ═══ 8. 结构: 闸只在不收 KAS 模式, 且在 registerBettorOnShard 之前 ═══
console.log('[test] 8. 结构');
{
  const src = fs.readFileSync(fileURLToPath(new URL('./pool.js', import.meta.url)), 'utf8');
  const iGate = src.indexOf("if (_noKasMode) { const _g = reserveBetSlot(sqlite, bettorPk)");
  const iReg = src.indexOf('const result = await registerBettorOnShard({');
  ok(iGate > 0 && iReg > iGate, '成本闸出现在 registerBettorOnShard 调用之前, 且包在 `if (_noKasMode)` 里(旧网络行为不变)');
  ok(src.includes('finally { if (_betSlot) _betSlot.release(); }'), '有 finally 释放');
  const between = src.slice(iGate, src.indexOf('try {', iGate));
  ok(!/await /.test(between.split('\n').slice(0, 6).join('\n').replace(/\/\/.*$/gm, '')), '预留到 try 之间没有 await');
}

// ═══ 9. linked_addr(账本1861 电报接线): 服务端用既有 deriveXOnlyPubkey 推 bettor_pk; 成本闸按【推出的】pk 计数 ═══
console.log('[test] 9. register-v07 linked_addr');
process.env.ZK_BET_MAX_PER_PK_DAY = '1'; delete process.env.ZK_BET_MAX_GLOBAL_DAY; wipe(); regDelay = 0;
{
  const lbet = (extra) => post('/api/pool/market/m-cap/bettor/register-v07', { direction: 0, stake_ktt: 150000000, ...extra });
  const testnetAddr = new kaspa.PrivateKey('02'.repeat(32)).toPublicKey().toAddress('testnet-10').toString();
  const p2sh = kaspa.addressFromScriptPublicKey(kaspa.ScriptBuilder.fromScript(new Uint8Array([0x51])).createPayToScriptHashScript(), 'mainnet').toString();
  const regN = () => calls.reg.length;

  // my-positions 推出的 pk(同一个 deriveXOnlyPubkey)
  const mp = await app.inject({ method: 'GET', url: `/api/pool/my-positions?linked_addr=${encodeURIComponent(BETTOR.addrMain)}` });
  const mpPk = J(mp).bettor_pk;
  ok(mp.statusCode === 200 && mpPk === BETTOR.xonly, `my-positions 对该地址推出 bettor_pk(实 ${String(mpPk).slice(0, 12)})`);

  const n0 = regN();
  const bad1 = await lbet({ linked_addr: testnetAddr });
  ok(bad1.statusCode === 400 && /网络|前缀/.test(J(bad1).error || ''), `testnet 前缀 ⇒ 400(实 ${bad1.statusCode} ${String(J(bad1).error).slice(0, 80)})`);
  const bad2 = await lbet({ linked_addr: p2sh });
  ok(bad2.statusCode === 400 && /P2PK/.test(J(bad2).error || ''), `P2SH 地址 ⇒ 400 且信息清楚(实 ${bad2.statusCode} ${String(J(bad2).error).slice(0, 80)})`);
  const bad3 = await lbet({ linked_addr: BETTOR.addrMain, bettor_pk: PKS[0] });
  ok(bad3.statusCode === 400 && /不一致/.test(J(bad3).error || '') && J(bad3).derived_bettor_pk === BETTOR.xonly, `linked_addr 与 bettor_pk 不一致 ⇒ 400(实 ${bad3.statusCode})`);
  const bad4 = await lbet({ linked_addr: BETTOR.addrMain, bettor_relay_id: 'bettor-r' });
  ok(bad4.statusCode === 400, `linked_addr + bettor_relay_id ⇒ 400(实 ${bad4.statusCode})`);
  const bad5 = await lbet({ linked_addr: 'not-an-address' });
  ok(bad5.statusCode === 400, `乱码地址 ⇒ 400(实 ${bad5.statusCode})`);
  const miss = await post('/api/pool/market/m-cap/bettor/register-v07', { direction: 0, stake_ktt: 150000000 });
  ok(miss.statusCode === 400 && /linked_addr/.test(J(miss).error || ''), `缺身份参数的错误文本提到 linked_addr(实 ${String(J(miss).error).slice(0, 90)})`);
  ok(regN() === n0 && calls.transfer.length === 0, '以上全部 400: 没进 registerBettorOnShard、零转账');
  ok(Object.keys(_inflightSnapshotForTest()).length === 0, '400 路径没占预留');

  const good = await lbet({ linked_addr: BETTOR.addrMain });
  ok(good.statusCode === 200 && J(good).bettor_pk === BETTOR.xonly && calls.reg.at(-1)?.bettorPk === BETTOR.xonly, `有效主网 P2PK 地址 ⇒ 200, bettor_pk = 推出值 = my-positions 推出值(实 ${good.statusCode})`);
  ok(calls.reg.at(-1)?.bettorPk === mpPk, '与 my-positions 推出的 pk 逐字节相同');
  ok(calls.reg.at(-1)?.relayAddr === MAKER.addrMain && calls.transfer.length === 0, '仍是网关代付: 付费方=网关, 下注人零转账');
  // 成本闸按推出的 pk 计数: 同一 pk 的第二笔(无论用 linked_addr 还是 bettor_pk 十六进制)都 429 bet_cap_pk_day
  const cap1 = await lbet({ linked_addr: BETTOR.addrMain });
  const cap2 = await lbet({ bettor_pk: BETTOR.xonly.toUpperCase() });
  ok(cap1.statusCode === 429 && J(cap1).code === BET_CAP_PK_CODE && J(cap1).used === 1, `cap=1: 同地址第二笔(linked_addr) ⇒ 429 ${BET_CAP_PK_CODE}(实 ${cap1.statusCode})`);
  ok(cap2.statusCode === 429 && J(cap2).code === BET_CAP_PK_CODE, `同 pk 改用 bettor_pk 十六进制(大写) 也 ⇒ 429(按推出的 pk 计数, 两种入口共用额度)(实 ${cap2.statusCode})`);
  const other = await lbet({ linked_addr: MAKER.addrMain });
  ok(other.statusCode === 200 || other.statusCode === 403, `另一个地址不受该 pk 额度影响(实 ${other.statusCode})`);
  // 一致时可同给
  wipe();
  const both = await lbet({ linked_addr: BETTOR.addrMain, bettor_pk: BETTOR.xonly.toUpperCase() });
  ok(both.statusCode === 200, `linked_addr 与 bettor_pk 一致(大小写不敏感) 可同给 ⇒ 200(实 ${both.statusCode})`);
}

await app.close();
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
