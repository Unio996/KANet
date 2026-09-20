// proto-oracle-adapter.test.mjs — oracle 整合批 B / B5: adapter 启动接线(默认关 / 拒启动条件 / 启动 LOUD / 单飞 / 状态复位)。deps 全注入; 无网络 / 无链 / 无 IPC。
// Run: cd kasia-console && node src/services/proto-oracle-adapter.test.mjs
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

if (!process.env._PMOA_SVC_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_pmoa_svc_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _PMOA_SVC_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
const assert = (await import('node:assert/strict')).default;
const svc = await import('./proto-oracle-adapter.mjs');
const { resolveBudgetConfig } = await import('../lib/proto-settlement-budget.mjs');

let pass = 0, fail = 0;
const t = async (n, f) => { try { await f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); } };
const H = 3_600_000;
const mkLog = () => { const l = { lines: [], log: (...a) => l.lines.push(['log', a.join(' ')]), warn: (...a) => l.lines.push(['warn', a.join(' ')]), error: (...a) => l.lines.push(['error', a.join(' ')]) }; l.has = (lv, re) => l.lines.some(([x, s]) => x === lv && re.test(s)); return l; };
const voter = (w) => ({ UMA_FINALIZATION_WINDOW_MS: w });
const ON = { PROTO_ORACLE_ADAPTER_ENABLED: '1', KASPA_NETWORK: 'simnet' };
const cfg = resolveBudgetConfig({}, { tickMs: 20_000 }).config;
const emptyDb = { prepare: () => ({ all: () => [] }) };

await t('V1 tick 间隔: 默认 300000; 非整数 / <30000 / 非数字 ⇒ 默认; 合法值原样', () => {
  assert.equal(svc.oracleAdapterIntervalMs({}), 300_000);
  for (const v of ['abc', '29999', '1.5', '-1', '', '0']) assert.equal(svc.oracleAdapterIntervalMs({ PROTO_ORACLE_ADAPTER_INTERVAL_MS: v }), 300_000, v);
  assert.equal(svc.oracleAdapterIntervalMs({ PROTO_ORACLE_ADAPTER_INTERVAL_MS: '30000' }), 30_000); assert.equal(svc.oracleAdapterIntervalMs({ PROTO_ORACLE_ADAPTER_INTERVAL_MS: '600000' }), 600_000);
});
await t('V2 ▲ 默认关闭: 开关缺省 / 非字面 "1" / 缺 relay ⇒ disabled, 不启动、不打策略行、不建 interval', async () => {
  for (const [name, env, relayId] of [['缺省', {}, 'r1'], ['0', { PROTO_ORACLE_ADAPTER_ENABLED: '0', KASPA_NETWORK: 'simnet' }, 'r1'], ['true', { PROTO_ORACLE_ADAPTER_ENABLED: 'true', KASPA_NETWORK: 'simnet' }, 'r1'], ['开但无 relay', ON, ''], ['开但 relay=null', ON, null]]) {
    const log = mkLog(); await svc.startProtoOracleAdapter({ env, relayId, log, deps: { voter: voter(48 * H) } });
    assert.equal(svc.oracleAdapterState().started, false, name); assert.ok(log.has('log', /\[proto-oracle-adapter\] disabled/), name); assert.ok(!log.has('log', /judged-market policy/) && !log.has('warn', /judged-market policy/), name + ': 未启用不打策略行');
  }
  assert.equal(svc.isProtoOracleAdapterEnabled({ env: {}, relayId: 'r' }), false); assert.equal(svc.isProtoOracleAdapterEnabled({ env: ON, relayId: 'r' }), true); assert.equal(svc.isProtoOracleAdapterEnabled({ env: ON, relayId: '' }), false);
});
await t('V3 ▲ 拒启动(LOUD): 网络未配置 / 网络未知 / UMA 定稿窗 NaN / <24h / undefined ⇒ error 行含 REFUSED 且不启动', async () => {
  const cases = [['网络缺失', { PROTO_ORACLE_ADAPTER_ENABLED: '1' }, voter(48 * H), /KASPA_NETWORK/], ['网络未知', { PROTO_ORACLE_ADAPTER_ENABLED: '1', KASPA_NETWORK: 'nope' }, voter(48 * H), /KASPA_NETWORK/], ['UMA NaN', ON, voter(NaN), /UMA_FINALIZATION_WINDOW_MS/], ['UMA 3h', ON, voter(3 * H), /24h/], ['UMA undefined', ON, voter(undefined), /UMA_FINALIZATION_WINDOW_MS/]];
  for (const [name, env, v, re] of cases) { const log = mkLog(); await svc.startProtoOracleAdapter({ env, relayId: 'r1', log, deps: { voter: v } }); assert.equal(svc.oracleAdapterState().started, false, name); assert.ok(log.has('error', /REFUSED to start/) && log.lines.some(([, s]) => re.test(s)), name + ' ' + JSON.stringify(log.lines)); }
});
await t('V4 ▲ 合法启动: LOUD 打印策略生效值(adapter=ENABLED / network / 白名单)+ started 行(含 uma_window_ms); stop 复位; 重复 start 幂等; 主网另带 N5b 提示', async () => {
  const log = mkLog();
  try {
    await svc.startProtoOracleAdapter({ env: { ...ON, PROTO_ORACLE_ADAPTER_INTERVAL_MS: '60000' }, relayId: 'r1', log, deps: { voter: voter(48 * H) } });
    assert.equal(svc.oracleAdapterState().started, true); assert.ok(log.has('warn', /judged-market policy: adapter=ENABLED network=simnet/), JSON.stringify(log.lines)); assert.ok(log.has('log', /started \(tick 60000ms, network=simnet, uma_window_ms=172800000\)/));
    const n = log.lines.length; await svc.startProtoOracleAdapter({ env: ON, relayId: 'r1', log, deps: { voter: voter(48 * H) } }); assert.equal(log.lines.length, n, '重复 start 不重复打印 / 不再建 interval');
  } finally { svc.stopProtoOracleAdapter(); }
  assert.equal(svc.oracleAdapterState().started, false);
  const log2 = mkLog();
  try { await svc.startProtoOracleAdapter({ env: { ...ON, KASPA_NETWORK: 'mainnet', PROTO_ORACLE_VALUELESS_TOKEN_IDS: 'tokA' }, relayId: 'r1', log: log2, deps: { voter: voter(48 * H) } }); assert.ok(log2.has('warn', /network=mainnet.*valueless_token_ids=\[tokA\].*N5b/), JSON.stringify(log2.lines)); }
  finally { svc.stopProtoOracleAdapter(); }
});
await t('V5 tick 本体: 单飞(在飞时第二次调用 ⇒ skipped in_flight, 不重入); 抛错后状态复位; UMA 窗不安全 ⇒ tick 中止(aborted)', async () => {
  const base = { relayId: 'r1', network: 'simnet', cfg, log: mkLog() };
  const deps = { voter: voter(48 * H), db: emptyDb, readPmt: async () => ({ valid: true, pmtMs: 1 }), deriveExtractor: async () => ({}), deriveUma: async () => ({}) };
  const p1 = svc.oracleAdapterTickBody({ ...base, deps }); assert.equal(svc.oracleAdapterState().inFlight, true);
  const r2 = await svc.oracleAdapterTickBody({ ...base, deps }); assert.deepEqual(r2, { skipped: true, reason: 'in_flight' });
  const r1 = await p1; assert.equal(r1.scanned, 0); assert.equal(svc.oracleAdapterState().inFlight, false);
  await assert.rejects(() => svc.oracleAdapterTickBody({ ...base, deps: { ...deps, db: { prepare: () => { throw new Error('db down'); } } } }), /db down/); assert.equal(svc.oracleAdapterState().inFlight, false, '抛错后 inFlight 复位');
  const r3 = await svc.oracleAdapterTickBody({ ...base, deps }); assert.equal(r3.aborted, null);
  const r4 = await svc.oracleAdapterTickBody({ ...base, deps: { ...deps, voter: voter(NaN) } }); assert.equal(r4.aborted, 'uma_window_unsafe');
});
await t('V3b ▲ SHOULD① voter 导入失败 ⇒ LOUD 拒启动(不抛、不启动、不建 interval): 顶层 await startProtoOracleAdapter 不会因此拖垮 console 启动', async () => {
  const log = mkLog(); await svc.startProtoOracleAdapter({ env: ON, relayId: 'r1', log, deps: { importVoter: async () => { throw new Error('Cannot find module x'); } } });
  assert.equal(svc.oracleAdapterState().started, false); assert.ok(log.has('error', /REFUSED to start.*bettor-prediction-voter.*Cannot find module x/), JSON.stringify(log.lines));
  const log2 = mkLog(); await svc.startProtoOracleAdapter({ env: ON, relayId: 'r1', log: log2, deps: { importVoter: () => { throw new Error('sync boom'); } } }); assert.equal(svc.oracleAdapterState().started, false); assert.ok(log2.has('error', /sync boom/));
});
await t('V6 接线钉(源码): index.js 在 startProtoSettlementDriver 之后启动 adapter; 服务默认关(读 PROTO_ORACLE_ADAPTER_ENABLED === "1"); 独立 interval, 不碰旧 voter 的 tick; 生产端口装配 readPmt 走批 D readValidatedPmt(共享校验器)', () => {
  const idx = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8'); const a = idx.indexOf('startProtoSettlementDriver()'), b = idx.indexOf('startProtoOracleAdapter()');
  assert.ok(a > 0 && b > a, 'adapter 启动在 settlement driver 之后'); assert.ok(/import \{ startProtoOracleAdapter \}/.test(idx));
  const src = fs.readFileSync(new URL('./proto-oracle-adapter.mjs', import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '');
  assert.ok(/env\[ENV_ADAPTER_ENABLED\] === '1'/.test(src)); assert.ok(!/voterTick|startBettorPredictionVoter/.test(src), '不复用 / 不改旧 voter 的循环'); assert.ok(/readValidatedPmt/.test(src) && /sharedPmtValidator/.test(src));
  assert.ok(/setInterval\(/.test(src));
});

console.log(`\nproto-oracle-adapter.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
