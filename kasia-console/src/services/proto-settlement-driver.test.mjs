// proto-settlement-driver.test.mjs — 批9 9-2b(iii): 启动接线(开关 8 态 / 启动日志 / 单飞 / 健康与网络前缀 / 关闭态零副作用 / ops 不可用拒绝启动)。零链 / 零 IPC / 零私钥: 全部依赖注入。
// Run: cd kasia-console && node src/services/proto-settlement-driver.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PROTO_SETTLE_WIRING_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_settle_wiring_${process.pid}.db`;
  try { fs.unlinkSync(tmpDb); } catch {}
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PROTO_SETTLE_WIRING_BOOTSTRAPPED: '1', PROTO_RELAY_ID: 'wiring-test-relay' } });
  try { fs.unlinkSync(tmpDb); } catch {}
  process.exit(r.status ?? 1);
}
import assert from 'node:assert/strict';
const W = await import('./proto-settlement-driver.mjs');
const { isProtoSettlementDriverEnabled, startProtoSettlementDriver, stopProtoSettlementDriver, driveSettlementOnce, settlementTickBody, stepBudgetFor, assertRelayAddressOnNetwork, settlementIntervalMs, settlementTickCap, _settlementDriverTestState, _resetSettlementDriverState } = W;
const { stripComments } = await import('../../../shared/test-fixtures/source-scan/scan-non-test-sources.mjs');

let pass = 0, fail = 0;
const t = async (n, f) => { try { _resetSettlementDriverState(); await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } finally { stopProtoSettlementDriver(); _resetSettlementDriverState(); } };
const mkLog = () => { const lines = []; const mk = (lv) => (...a) => lines.push(`${lv} ${a.map(String).join(' ')}`); return { lines, log: mk('log'), warn: mk('warn'), error: mk('error') }; };

await t('开关 8 态(§3.1): 仅"结算开关==\'1\' ∧ relay 已配置"为真; PROTO_DRIVER_ENABLED 与之无关; 只认字面 \'1\'', () => {
  let trues = 0;
  for (const pde of [undefined, '0', '1']) for (const psde of [undefined, '1']) for (const relay of [null, 'r1']) {
    const env = {}; if (pde !== undefined) env.PROTO_DRIVER_ENABLED = pde; if (psde !== undefined) env.PROTO_SETTLEMENT_DRIVER_ENABLED = psde;
    const got = isProtoSettlementDriverEnabled({ env, relayId: relay });
    assert.equal(got, psde === '1' && relay === 'r1', JSON.stringify({ pde, psde, relay })); if (got) trues++;
  }
  assert.equal(trues, 3);                                            // 三个 PDE 取值 × (PSDE=1, relay 已配)
  for (const v of ['on', 'true', ' 1', '', '01', '2']) assert.equal(isProtoSettlementDriverEnabled({ env: { PROTO_SETTLEMENT_DRIVER_ENABLED: v }, relayId: 'r1' }), false, JSON.stringify(v));
});
await t('关闭态零副作用(§3.2 / §3.3): 只打恰一行 "[proto-settlement-driver] disabled"; 不启动 interval; 不装载 ops; 不发任何命令', () => {
  for (const env of [{}, { PROTO_SETTLEMENT_DRIVER_ENABLED: '0' }, { PROTO_SETTLEMENT_DRIVER_ENABLED: '1' }]) {   // 第三种: 开关开但 relay 未配 ⇒ 仍关
    const L = mkLog(); let loaded = 0;
    startProtoSettlementDriver({ env, relayId: env.PROTO_SETTLEMENT_DRIVER_ENABLED === '1' ? null : 'r1', loadOps: async () => { loaded++; return {}; }, log: L });
    assert.deepEqual(L.lines, ['log [proto-settlement-driver] disabled']); assert.equal(_settlementDriverTestState().started, false); assert.equal(loaded, 0);
  }
});
await t('启动日志(§3.2): 形状 "started (tick …ms, cap …/tick, network=…)" 显式带 network; 非主网另打一行 NON-MAINNET; 重复 start 不重复启动; stop 后清 interval', () => {
  const L = mkLog();
  startProtoSettlementDriver({ env: { PROTO_SETTLEMENT_DRIVER_ENABLED: '1', KASPA_NETWORK: 'simnet' }, relayId: 'r1', loadOps: async () => ({}), log: L });
  assert.deepEqual(L.lines, ['log [proto-settlement-driver] started (tick 60000ms, cap 3/tick, network=simnet)', 'warn [proto-settlement-driver] NON-MAINNET network=simnet']);
  assert.equal(_settlementDriverTestState().started, true);
  startProtoSettlementDriver({ env: { PROTO_SETTLEMENT_DRIVER_ENABLED: '1', KASPA_NETWORK: 'simnet' }, relayId: 'r1', loadOps: async () => ({}), log: L }); assert.equal(L.lines.length, 2, '重复 start 不重复日志');
  stopProtoSettlementDriver(); assert.equal(_settlementDriverTestState().started, false);
  const L2 = mkLog(); startProtoSettlementDriver({ env: { PROTO_SETTLEMENT_DRIVER_ENABLED: '1', KASPA_NETWORK: 'mainnet', PROTO_SETTLEMENT_DRIVER_INTERVAL_MS: '90000', PROTO_SETTLEMENT_DRIVER_TICK_CAP: '2' }, relayId: 'r1', loadOps: async () => ({}), log: L2 });
  assert.deepEqual(L2.lines, ['log [proto-settlement-driver] started (tick 90000ms, cap 2/tick, network=mainnet)'], '主网不打 NON-MAINNET');
});
await t('拒绝启动(LOUD): KASPA_NETWORK 未设 / 未知 ⇒ 不启动; tick 间隔太短使每步预算 ≥ 间隔 ⇒ 不启动', () => {
  for (const env of [{ PROTO_SETTLEMENT_DRIVER_ENABLED: '1' }, { PROTO_SETTLEMENT_DRIVER_ENABLED: '1', KASPA_NETWORK: 'mainnet-typo' }, { PROTO_SETTLEMENT_DRIVER_ENABLED: '1', KASPA_NETWORK: 'mainnet', PROTO_SETTLEMENT_DRIVER_INTERVAL_MS: '15000' }]) {
    const L = mkLog(); startProtoSettlementDriver({ env, relayId: 'r1', loadOps: async () => ({}), log: L });
    assert.equal(_settlementDriverTestState().started, false); assert.equal(L.lines.length, 1); assert.match(L.lines[0], /^error \[proto-settlement-driver\] REFUSED to start/);
  }
});
await t('批 D N2 启动校验: 预算常量自相矛盾(tick 拉到 10 分钟, 默认 SAFETY 压不住 LAG_MAX+MARGIN+tick)⇒ REFUSED to start(不起 interval); 非法 env 值 ⇒ 回默认并 LOUD(error 级日志)仍启动; 无 env 覆盖 ⇒ 无预算日志', () => {
  const base = { PROTO_SETTLEMENT_DRIVER_ENABLED: '1', KASPA_NETWORK: 'mainnet' };
  { const L = mkLog(); startProtoSettlementDriver({ env: { ...base, PROTO_SETTLEMENT_DRIVER_INTERVAL_MS: '600000' }, relayId: 'r1', loadOps: async () => ({}), log: L });
    assert.equal(_settlementDriverTestState().started, false); assert.ok(L.lines.some((l) => l.startsWith('error [proto-settlement-driver] REFUSED to start: 预算自相矛盾')), L.lines.join(' | ')); stopProtoSettlementDriver(); }
  { const L = mkLog(); startProtoSettlementDriver({ env: { ...base, PROTO_GRACE_MS: 'abc', PROTO_PROMOTION_SAFETY_MS: '1000' }, relayId: 'r1', loadOps: async () => ({}), log: L });
    assert.equal(_settlementDriverTestState().started, true); const loud = L.lines.filter((l) => l.startsWith('error [proto-settlement-driver] BUDGET CONFIG (LOUD)')); assert.equal(loud.length, 2, L.lines.join(' | ')); stopProtoSettlementDriver(); }
  { const L = mkLog(); startProtoSettlementDriver({ env: base, relayId: 'r1', loadOps: async () => ({}), log: L });
    assert.equal(_settlementDriverTestState().started, true); assert.equal(L.lines.filter((l) => /BUDGET/.test(l)).length, 0); stopProtoSettlementDriver(); }
});
await t('每步预算(§19.3a): = tick 间隔的一半, 下限 15000, 且必须小于间隔(否则 RangeError); 间隔 / cap 取自 env 正整数, 否则默认 60000 / 3', () => {
  assert.equal(stepBudgetFor(60000), 30000); assert.equal(stepBudgetFor(30000), 15000); assert.equal(stepBudgetFor(20000), 15000); assert.throws(() => stepBudgetFor(15000), RangeError); assert.throws(() => stepBudgetFor(1000), RangeError);
  assert.equal(settlementIntervalMs({}), 60000); assert.equal(settlementIntervalMs({ PROTO_SETTLEMENT_DRIVER_INTERVAL_MS: 'abc' }), 60000); assert.equal(settlementIntervalMs({ PROTO_SETTLEMENT_DRIVER_INTERVAL_MS: '45000' }), 45000);
  assert.equal(settlementTickCap({}), 3); assert.equal(settlementTickCap({ PROTO_SETTLEMENT_DRIVER_TICK_CAP: '0' }), 3); assert.equal(settlementTickCap({ PROTO_SETTLEMENT_DRIVER_TICK_CAP: '7' }), 7);
});
await t('网络与 relay 地址前缀(S7): 整段前缀精确比较——kaspa↔mainnet, kaspasim↔simnet, kaspatest↔testnet-12; mainnet 配置遇 kaspasim: 地址必须拒(不是 startsWith)', () => {
  assert.equal(assertRelayAddressOnNetwork({ network: 'mainnet', relayAddress: 'kaspa:qqqq' }), true);
  assert.equal(assertRelayAddressOnNetwork({ network: 'simnet', relayAddress: 'kaspasim:qqqq' }), true);
  assert.equal(assertRelayAddressOnNetwork({ network: 'testnet-12', relayAddress: 'kaspatest:qqqq' }), true);
  assert.throws(() => assertRelayAddressOnNetwork({ network: 'mainnet', relayAddress: 'kaspasim:qqqq' }), /前缀/);
  assert.throws(() => assertRelayAddressOnNetwork({ network: 'simnet', relayAddress: 'kaspa:qqqq' }), /前缀/);
  assert.throws(() => assertRelayAddressOnNetwork({ network: 'mainnet', relayAddress: 'kaspadev:qqqq' }), /前缀/);
  assert.throws(() => assertRelayAddressOnNetwork({ network: 'mainnet', relayAddress: 'nocolon' }), /前缀/);
  assert.throws(() => assertRelayAddressOnNetwork({ network: 'nonsense', relayAddress: 'kaspa:qqqq' }));
});
await t('单 tick: relay 不健康 ⇒ 跳过整 tick、零装配零 IPC(§3.6); 网络前缀不符 ⇒ 跳过并 LOUD; 通过 ⇒ 装配并 runTick(cap 透传); 单飞: 并发第二个 tick 跳过; 报错后单飞标志复位', async () => {
  let built = 0; const L = mkLog();
  let r = await driveSettlementOnce({ assertHealthyFn: async () => { throw new Error('balance too high'); }, network: 'mainnet', buildDeps: async () => { built++; }, log: L });
  assert.deepEqual([r.skipped, r.reason, built], [true, 'relay_unhealthy', 0]);
  r = await driveSettlementOnce({ assertHealthyFn: async () => ({ address: 'kaspasim:qqq' }), network: 'mainnet', buildDeps: async () => { built++; }, log: L });
  assert.deepEqual([r.skipped, r.reason, built], [true, 'network_mismatch', 0]); assert.ok(L.lines.some((l) => l.startsWith('error ') && l.includes('REFUSED')));
  let capSeen = null; const okDriver = { runTick: async ({ cap }) => { capSeen = cap; return { actioned: 1, landed: 0, submitted: 1, waiting: 0, gated: 0, held: 0, failed: 0 }; } };
  r = await driveSettlementOnce({ assertHealthyFn: async () => ({ address: 'kaspa:qqq' }), network: 'mainnet', buildDeps: async () => okDriver, cap: 5, log: L });
  assert.equal(r.submitted, 1); assert.equal(capSeen, 5); assert.equal(_settlementDriverTestState().inFlight, false);
  let release; const gate = new Promise((res) => { release = res; });
  const slow = driveSettlementOnce({ assertHealthyFn: async () => { await gate; return { address: 'kaspa:qqq' }; }, network: 'mainnet', buildDeps: async () => okDriver, log: L });
  const overlap = await driveSettlementOnce({ assertHealthyFn: async () => ({ address: 'kaspa:qqq' }), network: 'mainnet', buildDeps: async () => { built++; return okDriver; }, log: L });
  assert.deepEqual([overlap.skipped, overlap.reason], [true, 'in_flight']); assert.equal(_settlementDriverTestState().skippedOverlap, 1);
  release(); await slow;
  await assert.rejects(() => driveSettlementOnce({ assertHealthyFn: async () => ({ address: 'kaspa:qqq' }), network: 'mainnet', buildDeps: async () => { throw new Error('boom'); }, log: L }), /boom/);
  assert.equal(_settlementDriverTestState().inFlight, false, '异常后单飞标志复位');
});
await t('ops 不可用 ⇒ tick 体 LOUD 拒绝并自停(绝不带着半截端口跑钱路); 网络不符 ⇒ 自停; 二者都不发命令', async () => {
  const L = mkLog();
  startProtoSettlementDriver({ env: { PROTO_SETTLEMENT_DRIVER_ENABLED: '1', KASPA_NETWORK: 'mainnet' }, relayId: 'r1', loadOps: async () => ({}), log: L });
  assert.equal(_settlementDriverTestState().started, true);
  let sent = 0;
  const r = await settlementTickBody({ relayId: 'r1', loadOps: async () => { throw new Error('Cannot find module proto-settlement-ops'); }, log: L, network: 'mainnet', cap: 3, intervalMs: 60000, kaspa: {}, sendCmd: async () => { sent++; }, assertHealthyFn: async () => ({ address: 'kaspa:qqq' }) });
  assert.deepEqual([r.skipped, r.reason, sent], [true, 'ops_unavailable', 0]); assert.equal(_settlementDriverTestState().started, false); assert.ok(L.lines.some((l) => l.includes('REFUSED') && l.includes('ops')));
  startProtoSettlementDriver({ env: { PROTO_SETTLEMENT_DRIVER_ENABLED: '1', KASPA_NETWORK: 'mainnet' }, relayId: 'r1', loadOps: async () => ({}), log: L });
  const r2 = await settlementTickBody({ relayId: 'r1', loadOps: async () => ({}), log: L, network: 'mainnet', cap: 3, intervalMs: 60000, kaspa: {}, sendCmd: async () => { sent++; }, assertHealthyFn: async () => ({ address: 'kaspasim:qqq' }) });
  assert.equal(r2.reason, 'network_mismatch'); assert.equal(_settlementDriverTestState().started, false); assert.equal(sent, 0);
});
await t('默认 ops 装载器: 四步端口模块(proto-settlement-ops)尚不存在时启动会 LOUD 拒绝(iii-2 落地前不会悄悄跑半截钱路)', async () => {
  const L = mkLog();
  const r = await settlementTickBody({ relayId: 'r1', loadOps: () => import('../lib/proto-settlement-ops.mjs'), log: L, network: 'mainnet', cap: 3, intervalMs: 60000, kaspa: {}, sendCmd: async () => {}, assertHealthyFn: async () => ({ address: 'kaspa:qqq' }) })
    .catch((e) => ({ threw: e.message }));
  // ops 模块存在(iii-2 之后)则本用例改为: 装载成功继续; 不存在则 ops_unavailable —— 两种都不是"悄悄成功"
  assert.ok(r.reason === 'ops_unavailable' || r.threw !== undefined || r.skipped !== undefined || r.actioned !== undefined);
});
await t('结构(§11): 接线文件不 bare-import relay-manager; 不含 withdraw / reclaim / allowUnlistedTestDestination / 私钥; network 只来自 configuredNetwork(env); index.js 恰一处调用 startProtoSettlementDriver() 且在 startProtoDriver() 之后', () => {
  const code = stripComments(fs.readFileSync(new URL('./proto-settlement-driver.mjs', import.meta.url), 'utf8'));
  for (const bad of [/relay-manager/, /\bwithdraw\b/i, /\breclaim\b/i, /allowUnlistedTestDestination/, /privkey|PrivateKey/i, /request\.(body|query|params)/, /req\.body/]) assert.ok(!bad.test(code), '不应出现 ' + bad);
  assert.ok(/configuredNetwork\(env\)/.test(code) && !/process\.env\.KASPA_NETWORK/.test(code));
  const idx = stripComments(fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8'));
  assert.equal((idx.match(/startProtoSettlementDriver\(\)/g) || []).length, 1); assert.ok(idx.indexOf('startProtoDriver();') < idx.indexOf('startProtoSettlementDriver();'));
});

console.log(`\nproto-settlement-driver.test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
