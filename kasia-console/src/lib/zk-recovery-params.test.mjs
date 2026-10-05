// zk-recovery-params.test.mjs — 账本1861 C §8: 铸造时回收参数写进盘 metadata + 漂移 LOUD。
// Run: cd kasia-console && node src/lib/zk-recovery-params.test.mjs   (自举: 临时 migration 库)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
if (!process.env._ZKRP_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_zkrp_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'simnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _ZKRP_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
process.env.KASPA_NETWORK = 'simnet';
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const { sqlite } = await import('../db/client.js');
const P = await import('./zk-recovery-params.mjs');
sqlite.pragma('foreign_keys = OFF');
const ENV = { KASPA_NETWORK: 'mainnet', ZK_SYSTEM_SINK_PK: 'ab'.repeat(32), ZK_CLAIM_RETIRE_DAA: '25920000', ZK_TICKET_SWEEP_DAA: '315360000', ZK_CLAIM_OUT_VALUE_SOMPI: '40000000' };
const ins = (id, meta) => { const cols = sqlite.pragma('table_info(pool_markets)').filter((c) => c.notnull === 1 && c.dflt_value == null && c.name !== 'id' && !c.pk); const row = { id, metadata: JSON.stringify(meta), protocol_version: 'v0.7', protocol_status: 'verifying' }; for (const c of cols) if (!(c.name in row)) row[c.name] = /INT/i.test(c.type) ? 1 : 'x'; sqlite.prepare(`INSERT OR REPLACE INTO pool_markets (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row)); };
const meta = (id) => JSON.parse(sqlite.prepare('SELECT metadata m FROM pool_markets WHERE id = ?').get(id).m);
const warns = []; const w0 = console.warn; console.warn = (...a) => warns.push(a.join(' '));

console.log('[test] 1. currentRecoveryParams / withRecoveryParams');
{
  const p = P.currentRecoveryParams(ENV);
  ok(p && p.sink_pk === 'ab'.repeat(32) && p.retire_daa === 25920000 && p.sweep_daa === 315360000 && p.claim_out_value_sompi === 40000000, '四个值取自 env(含 ZK_CLAIM_OUT_VALUE_SOMPI 覆盖)');
  ok(P.currentRecoveryParams({ KASPA_NETWORK: 'mainnet' }) === null, 'env 不全(主网缺 sink)⇒ null, 不抛');
  const m = P.withRecoveryParams({ no_spine: true }, ENV, '2026-10-05T00:00:00.000Z');
  ok(m.no_spine === true && m.zk_recovery_params.sink_pk === 'ab'.repeat(32) && m.zk_recovery_params.stamped_at === '2026-10-05T00:00:00.000Z' && m.zk_recovery_params.source === 'create-v07', 'withRecoveryParams: 原键保留 + 新增 zk_recovery_params');
  const m2 = P.withRecoveryParams(m, { ...ENV, ZK_CLAIM_RETIRE_DAA: '1' });
  ok(m2 === m && m2.zk_recovery_params.retire_daa === 25920000, '首写为准: 已有记录不被覆盖');
  const m3 = P.withRecoveryParams({ a: 1 }, { KASPA_NETWORK: 'mainnet' });
  ok(!('zk_recovery_params' in m3), 'env 不全 ⇒ 不写(原样)');
}

console.log('[test] 2. 漂移检测');
{
  ins('m-ok', P.withRecoveryParams({ no_spine: true }, ENV));
  warns.length = 0;
  ok(P.checkRecoveryParamsDrift(sqlite, 'm-ok', 'claim', ENV).drift === false && warns.length === 0 && !meta('m-ok').zk_recovery_params_drift, 'env 未变 ⇒ 无漂移, 无警告, 不写');
  const env2 = { ...ENV, ZK_CLAIM_RETIRE_DAA: '100' };
  const r = P.checkRecoveryParamsDrift(sqlite, 'm-ok', 'register-v07', env2, '2026-10-06T00:00:00.000Z');
  const m = meta('m-ok');
  ok(r.drift === true && warns.some((w) => w.includes('DRIFT') && w.includes('m-ok'.slice(-8))), 'retire_daa 变了 ⇒ drift:true + LOUD 警告');
  ok(Array.isArray(m.zk_recovery_params_drift) && m.zk_recovery_params_drift.length === 1 && m.zk_recovery_params_drift[0].site === 'register-v07' && m.zk_recovery_params_drift[0].current.retire_daa === 100, '追加 drift 记录(site + 当时 env)');
  ok(m.zk_recovery_params.retire_daa === 25920000, '盘上铸造记录不被改(枚举器优先用它)');
  P.checkRecoveryParamsDrift(sqlite, 'm-ok', 'claim', env2);
  ok(meta('m-ok').zk_recovery_params_drift.length === 1, '同一漂移值不重复追加');
  P.checkRecoveryParamsDrift(sqlite, 'm-ok', 'claim', { ...ENV, ZK_TICKET_SWEEP_DAA: '7' });
  ok(meta('m-ok').zk_recovery_params_drift.length === 2, '另一个漂移值 ⇒ 再追加');
  for (let i = 0; i < 8; i++) P.checkRecoveryParamsDrift(sqlite, 'm-ok', 'claim', { ...ENV, ZK_TICKET_SWEEP_DAA: String(1000 + i) });
  ok(meta('m-ok').zk_recovery_params_drift.length === 5, 'drift 记录最多 5 条');
  ins('m-legacy', { no_spine: true });
  warns.length = 0;
  ok(P.checkRecoveryParamsDrift(sqlite, 'm-legacy', 'claim', env2).drift === false && warns.length === 0 && !meta('m-legacy').zk_recovery_params, '无记录的 legacy 盘 ⇒ 不判、不补写(不能把"现在的 env"冒充成铸造时的)');
  ok(P.checkRecoveryParamsDrift(sqlite, 'nope', 'claim', ENV).drift === false, '不存在的盘 ⇒ 不抛');
  ok(P.checkRecoveryParamsDrift({ prepare() { throw new Error('boom'); } }, 'x', 'claim', ENV).drift === false, 'DB 异常 ⇒ 吞掉不抛(不阻断铸造)');
}

console.log('[test] 3. 接线(结构): create 写、ticket 前查、claim 前查');
{
  const pool = fs.readFileSync(new URL('../api/pool.js', import.meta.url), 'utf8');
  ok(pool.includes('(_noKasMode ? withRecoveryParams : (m) => m)({'), 'create-v07: 仅不收 KAS 模式补 zk_recovery_params(其它网络元数据逐字节不变)');
  const iD = pool.indexOf("checkRecoveryParamsDrift(sqlite, logicalMarketId, 'register-v07')"); const iR = pool.indexOf('const result = await registerBettorOnShard({', iD);
  ok(iD > 0 && iR > iD, 'register-v07: 铸票前(registerBettorOnShard 之前)比对');
  const tk = fs.readFileSync(new URL('./zk-autonomy-ticks.mjs', import.meta.url), 'utf8');
  ok(tk.indexOf("checkRecoveryParamsDrift(sqlite, marketId, 'claim')") > 0 && tk.indexOf("checkRecoveryParamsDrift(sqlite, marketId, 'claim')") < tk.indexOf('const feeUtxo = await ctx.mintFeeUtxo(claimFeeInputSompi()'), 'claim tick: mintFeeUtxo/runTokenClaim 之前比对');
}
console.warn = w0;
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
