// zk-self-cov-backfill.test.mjs — 账本1893: 补写 zk_self_cov_id(json_set, 首写为准, 只碰一个键)。
// Run: cd kasia-console && node src/lib/zk-self-cov-backfill.test.mjs   (自举: 临时 migration 库)
import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
if (!process.env._ZKBF_BOOTSTRAPPED) {
  const tmpDb = `${process.env.TEMP || '/tmp'}/_j2_zkbf_${process.pid}.db`;
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  execSync('node scripts/run-migrations.mjs', { cwd: process.cwd(), env: { ...process.env, DB_PATH: tmpDb, KASPA_NETWORK: 'simnet' }, stdio: 'pipe' });
  const r = spawnSync(process.execPath, [process.argv[1]], { cwd: process.cwd(), stdio: 'inherit', env: { ...process.env, DB_PATH: tmpDb, _ZKBF_BOOTSTRAPPED: '1' } });
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch {} }
  process.exit(r.status ?? 1);
}
process.env.KASPA_NETWORK = 'simnet';
process.env.KASPA_RPC_URL = 'ws://127.0.0.1:1';
if (!process.env.CONSOLE_ENCRYPTION_KEY) process.env.CONSOLE_ENCRYPTION_KEY = '1'.repeat(64);
let fails = 0;
const ok = (c, l) => { if (c) console.log(`  ✅ ${l}`); else { console.error(`  ❌ ${l}`); fails++; } };
const { sqlite } = await import('../db/client.js');
const { backfillSelfCovId } = await import('./zk-self-cov-backfill.mjs');
sqlite.pragma('foreign_keys = OFF');
const ins = (id, meta) => { const cols = sqlite.pragma('table_info(pool_markets)').filter((c) => c.notnull === 1 && c.dflt_value == null && c.name !== 'id' && !c.pk); const row = { id, metadata: typeof meta === 'string' ? meta : JSON.stringify(meta) }; for (const c of cols) if (!(c.name in row)) row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 0 : 'x'; const ks = Object.keys(row); sqlite.prepare(`INSERT INTO pool_markets (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`).run(...ks.map((k) => row[k])); };
const raw = (id) => sqlite.prepare('SELECT metadata m FROM pool_markets WHERE id = ?').get(id).m;
const COV = 'ab'.repeat(32);

console.log('[test] backfillSelfCovId');
ins('m1', { no_spine: true, keep: 1, zk_continuation: { exhausted: true, nested: { a: [1, 2] } } });
const before = raw('m1');
let r = backfillSelfCovId(sqlite, 'm1', COV);
ok(r.action === 'would_write' && r.ok && raw('m1') === before, '默认 dry-run: 报 would_write, 库字节不变');
r = backfillSelfCovId(sqlite, 'm1', COV, { apply: true });
const after = JSON.parse(raw('m1'));
ok(r.action === 'written' && after.zk_self_cov_id === COV, 'apply: 写入');
const b = JSON.parse(before); ok(Object.keys(after).length === Object.keys(b).length + 1 && JSON.stringify(after.zk_continuation) === JSON.stringify(b.zk_continuation) && after.keep === 1 && after.no_spine === true, '只多一个键, 其余字段原样(只碰这一个字段)');
r = backfillSelfCovId(sqlite, 'm1', 'cd'.repeat(32), { apply: true });
ok(r.ok === false && /DIFFERENT/.test(r.reason) && JSON.parse(raw('m1')).zk_self_cov_id === COV, '首写为准: 已有不同值 ⇒ 不覆盖, 返回失败');
r = backfillSelfCovId(sqlite, 'm1', COV, { apply: true });
ok(r.ok === true && r.action === 'noop' && r.reason === 'already_set_same', '同值重跑 ⇒ 幂等 noop');
ok(backfillSelfCovId(sqlite, 'm1', 'zz', { apply: true }).reason === 'bad_cov_id' && backfillSelfCovId(sqlite, 'nope', COV, { apply: true }).reason === 'no_market', '非法 cov id / 盘不存在 ⇒ 不写');
ins('m2', { zk_continuation: { exhausted: false } });
ok(/not_exhausted/.test(backfillSelfCovId(sqlite, 'm2', COV, { apply: true }).reason) && !('zk_self_cov_id' in JSON.parse(raw('m2'))), '未耗尽的盘 ⇒ 拒绝(那类盘由 claim tick stamp)');
ins('m3', '{not json');
ok(backfillSelfCovId(sqlite, 'm3', COV, { apply: true }).reason === 'bad_metadata' && raw('m3') === '{not json', '坏 JSON ⇒ 不碰');
// 原子性: 判空在 WHERE 里。模拟"读之后、写之前别处抢写了": 直接用同一条 UPDATE 再打一次, 不能覆盖
ins('m4', { zk_continuation: { exhausted: true } });
const fake = { prepare: (sql) => (/^SELECT/.test(sql) ? sqlite.prepare(sql) : { run: (...a) => { sqlite.prepare(`UPDATE pool_markets SET metadata = json_set(metadata,'$.zk_self_cov_id','${'ee'.repeat(32)}') WHERE id='m4'`).run(); return sqlite.prepare(sql).run(...a); } }) };
r = backfillSelfCovId(fake, 'm4', COV, { apply: true });
ok(r.action === 'noop' && /lost_race/.test(r.reason) && JSON.parse(raw('m4')).zk_self_cov_id === 'ee'.repeat(32), '竞态: 读后被别处先写 ⇒ 单条 UPDATE 的 IS NULL 条件保证不覆盖');
const src = fs.readFileSync(new URL('./zk-self-cov-backfill.mjs', import.meta.url), 'utf8');
ok(/json_set\(metadata, '\$\.zk_self_cov_id', \?\)/.test(src) && !/SET metadata = \?/.test(src), '源码: 写入用 json_set, 无整串回写');
console.log(fails ? `\n${fails} FAIL` : '\nALL PASS');
process.exitCode = fails ? 1 : 0;
