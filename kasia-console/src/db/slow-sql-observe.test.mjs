// slow-sql-observe.test.mjs — M10 v3-A 离线测试. 跑: cd kasia-console && node src/db/slow-sql-observe.test.mjs
// 🔴 M0a 门(R-M0A-BARE-IMPORT-DIFF): 测试文件不得裸 import better-sqlite3 ⇒ 走仓内 sanctioned 形(同 client.default-path.test.mjs):
//    本进程 import client.js 前把 DB_PATH 指到 mkdtemp 临时库, 用 client.js 装好观察者的 `sqlite` 实例测; 从不打开 kasia-console/data/console.db。
//    阈值/日志经 sqlite.__slowSqlObserver(STATE_KEY) 改, 不需要第二个 Database; 结束时 close + 删临时目录。
// 覆盖 Bettor 硬条件 5 (6 向量) + NWT C5 (7-10): 普通 all/get/run; 链式 .pluck().all()/.raw().get() 返回 Proxy 且计时; transaction 内语句;
//   抛错语句异常原样(SqliteError 同 class/code, 慢时仍打行); 慢语句一行且格式正确; 阈值 0 不装(假 db 对象); 经 Proxy 调用不抛 Illegal invocation;
//   非函数属性透传; fail-open(log 抛错); 幂等; callerFrame 纯函数.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installSlowSqlObserver, resolveSlowMs, callerFrame, DEFAULT_SLOW_MS, STATE_KEY } from './slow-sql-observe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'slow-sql-observe-'));
process.env.DB_PATH = join(dir, 'obs.db');
const { sqlite } = await import(pathToFileURL(join(HERE, 'client.js')).href);   // client.js 里已 installSlowSqlObserver(sqlite)

let n = 0, fail = 0;
const t = (name, fn) => { n++; try { fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
// NWT C1: at= 是时间戳(与 v2/readout 同契约), 调用点是 src=
const LINE_RE = /^\[diag:step\] sql\.(all|get|run) ms=\d+ rows=(\d+|-) sql="[^"]{1,80}" src=\S+ at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const state = sqlite[STATE_KEY];
const lines = [];
const capture = () => { lines.length = 0; state.slowMs = 50; state.log = (s) => lines.push(String(s)); };
sqlite.function('sleep_ms', (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { /* spin */ } return ms; });
sqlite.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL); INSERT INTO t (v) VALUES (\'a\'), (\'b\'), (\'c\')');

t('V0 client.js 已装观察者: state 存在、默认阈值 = 200(env 未设)、prepare 已被包', () => {
  assert.ok(state && typeof state.log === 'function'); assert.equal(state.slowMs, DEFAULT_SLOW_MS);
  assert.equal(sqlite.prepare.name, 'prepare'); assert.equal(Object.keys(sqlite).includes(STATE_KEY), false);   // 不可枚举
});
t('V1 普通 all/get/run: 结果正确(与字面期望相等), 快语句零行', () => {
  capture();
  assert.deepEqual(sqlite.prepare('SELECT * FROM t ORDER BY id').all(), [{ id: 1, v: 'a' }, { id: 2, v: 'b' }, { id: 3, v: 'c' }]);
  assert.deepEqual(sqlite.prepare('SELECT v FROM t WHERE id = ?').get(2), { v: 'b' });
  const r = sqlite.prepare('INSERT INTO t (v) VALUES (?)').run('d');
  assert.equal(r.changes, 1); assert.equal(typeof r.lastInsertRowid, 'number'); assert.equal(r.lastInsertRowid, 4);
  sqlite.prepare('DELETE FROM t WHERE id = 4').run();
  assert.equal(sqlite.prepare('SELECT v FROM t WHERE id = 99').get(), undefined);
  assert.equal(lines.length, 0);
});
t('V2 慢 all ⇒ 恰一行, 格式(src=/at=ISO)/rows/sql 头正确, 不记参数', () => {
  capture();
  const rows = sqlite.prepare('SELECT   id, sleep_ms(?) AS s\n  FROM t WHERE v <> ?').all(30, 'SECRET-ADDR');
  assert.equal(rows.length, 3);
  assert.equal(lines.length, 1); assert.match(lines[0], LINE_RE);
  assert.match(lines[0], /^\[diag:step\] sql\.all ms=\d{2,} rows=3 sql="SELECT id, sleep_ms\(\?\) AS s FROM t WHERE v <> \?" src=\S*src\/db\/slow-sql-observe\.test\.mjs:\d+ at=/);
  assert.ok(!lines[0].includes('SECRET-ADDR'), 'bind 参数不得进日志');
});
t('V3 慢 get / 慢 run: 各一行, rows=1 / rows=changes', () => {
  capture();
  sqlite.prepare('SELECT sleep_ms(60) AS s').get();
  sqlite.prepare('UPDATE t SET v = v || sleep_ms(60)').run();
  assert.equal(lines.length, 2);
  assert.match(lines[0], /sql\.get ms=\d+ rows=1 /); assert.match(lines[1], /sql\.run ms=\d+ rows=3 /);
  sqlite.prepare('UPDATE t SET v = substr(v, 1, 1)').run();   // 复原
});
t('V4 (C5-9) .pluck().all() / .raw().get() 链: 语义原样且链后仍计时(链方法返回 Proxy)', () => {
  capture();
  assert.deepEqual(sqlite.prepare('SELECT v FROM t ORDER BY id').pluck().all(), ['a', 'b', 'c']);
  assert.deepEqual(sqlite.prepare('SELECT id, v FROM t ORDER BY id').raw().get(), [1, 'a']);
  assert.equal(lines.length, 0);
  assert.deepEqual(sqlite.prepare('SELECT sleep_ms(60) AS s').pluck().all(), [60]);
  assert.deepEqual(sqlite.prepare('SELECT sleep_ms(60) AS s, 7 AS k').raw().get(), [60, 7]);
  assert.equal(lines.length, 2); assert.match(lines[0], /sql\.all ms=\d+ rows=1 /); assert.match(lines[1], /sql\.get ms=\d+ rows=1 /);
  const s = sqlite.prepare('SELECT id FROM t'); assert.equal(s.bind().all().length, 3);   // bind() 返回 Proxy, 链后照常
  assert.equal(s.expand().safeIntegers(false).all().length, 3);
});
t('V5 sqlite.transaction(fn) 内语句: 提交结果正确、慢语句被记(不双计)、内部抛错 ⇒ 回滚原样', () => {
  capture();
  const tx = sqlite.transaction((v) => { sqlite.prepare('INSERT INTO t (v) VALUES (?)').run(v); sqlite.prepare('SELECT sleep_ms(60)').get(); return sqlite.prepare('SELECT COUNT(*) AS c FROM t').get().c; });
  assert.equal(tx('x'), 4);
  assert.equal(lines.length, 1); assert.match(lines[0], /sql\.get /);
  const bad = sqlite.transaction(() => { sqlite.prepare('INSERT INTO t (v) VALUES (?)').run('y'); sqlite.prepare('INSERT INTO t (id, v) VALUES (1, ?)').run('dup'); });
  assert.throws(() => bad(), (e) => e && e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS c FROM t').get().c, 4, '回滚后计数不变');
  sqlite.prepare('DELETE FROM t WHERE v = ?').run('x');
});
t('V6 (C5-10) 抛错语句: 运行期 SqliteError 同 class/code(保留), 编译期 prepare 错原样', () => {
  capture();
  let e1;
  try { sqlite.prepare('INSERT INTO t (id, v) VALUES (1, ?)').run('dup'); } catch (e) { e1 = e; }
  assert.ok(e1); assert.equal(e1.constructor.name, 'SqliteError'); assert.equal(e1.code, 'SQLITE_CONSTRAINT_PRIMARYKEY'); assert.match(e1.message, /UNIQUE constraint failed/);
  assert.throws(() => sqlite.prepare('SELECT * FROM nope'), (e) => /no such table/.test(e.message));
  try { sqlite.prepare('INSERT INTO t (v) VALUES (?)').run(null); assert.fail('should throw'); } catch (e) { assert.equal(e.code, 'SQLITE_CONSTRAINT_NOTNULL'); }
  assert.equal(lines.length, 0);
});
t('V7 慢且抛错: 异常照常透出(同对象未再包), 仍打一行(rows=-)', () => {
  capture();
  let caught;
  try { sqlite.prepare('SELECT sleep_ms(60), json_extract(\'{\', \'$.a\')').get(); } catch (e) { caught = e; }
  assert.ok(caught && /malformed JSON/.test(caught.message)); assert.equal(caught.constructor.name, 'SqliteError');
  assert.equal(lines.length, 1); assert.match(lines[0], /sql\.get ms=\d+ rows=- /);
});
t('V8 阈值 0 ⇒ 不安装(prepare 原函数); resolveSlowMs 解析; 幂等(再装返回 true 且 state 同一对象)', () => {
  const fake = { prepare() { return {}; } }; const orig = fake.prepare;
  assert.equal(installSlowSqlObserver(fake, { slowMs: 0 }), false); assert.equal(fake.prepare, orig); assert.equal(fake[STATE_KEY], undefined);
  assert.equal(resolveSlowMs({}), DEFAULT_SLOW_MS); assert.equal(resolveSlowMs({ DIAG_SQL_SLOW_MS: '0' }), 0);
  assert.equal(resolveSlowMs({ DIAG_SQL_SLOW_MS: '350' }), 350); assert.equal(resolveSlowMs({ DIAG_SQL_SLOW_MS: 'abc' }), 0); assert.equal(resolveSlowMs({ DIAG_SQL_SLOW_MS: '-5' }), 0);
  assert.equal(installSlowSqlObserver(sqlite, { slowMs: 999, log: () => {} }), true); assert.equal(sqlite[STATE_KEY], state);   // 不重复包、state 不变
});
t('V8b 运行期 state.slowMs=0 ⇒ 关闭(零行), 不是"每条都打"; 改回 50 恢复', () => {
  capture(); state.slowMs = 0;
  sqlite.prepare('SELECT sleep_ms(60) AS s').get(); sqlite.prepare('SELECT 1').get();
  assert.equal(lines.length, 0);
  state.slowMs = 50; sqlite.prepare('SELECT sleep_ms(60) AS s').get(); assert.equal(lines.length, 1);
});
t('V9 fail-open: log 抛错 ⇒ 语句结果照常', () => {
  capture(); state.log = () => { throw new Error('log boom'); };
  assert.equal(sqlite.prepare('SELECT sleep_ms(60) AS s').get().s, 60);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS c FROM t').get().c, 3);
});
t('V10 (C5-7/8) 经 Proxy 调 all/get/run/iterate/columns 不抛 Illegal invocation; 非函数属性透传', () => {
  capture();
  const s = sqlite.prepare('SELECT id, v FROM t ORDER BY id');
  assert.equal(s.reader, true); assert.equal(typeof s.source, 'string'); assert.equal(s.database, sqlite); assert.equal(s.busy, false);
  assert.deepEqual(s.columns().map((c) => c.name), ['id', 'v']);
  assert.deepEqual([...s.iterate()].map((r) => r.id), [1, 2, 3]);
  const all = s.all, get = s.get;   // 解构后裸调(this=undefined)也不抛: 包装函数内固定用原 Statement
  assert.equal(all().length, 3); assert.equal(get().id, 1);
});
t('V11 callerFrame: 取第一层非本模块帧, 路径截到 kasia-console/ 之后; 垃圾栈 ⇒ ?', () => {
  const stack = 'Error\n    at timers.<computed> (file:///D:/kanet-tn12/kasia-console/src/db/slow-sql-observe.mjs:60:20)\n    at intakeTick (file:///D:/kanet-tn12/kasia-console/src/services/broker-intake-watcher.js:717:6)\n    at x (node:internal/y:1:1)';
  assert.equal(callerFrame(stack), 'src/services/broker-intake-watcher.js:717');
  assert.equal(callerFrame('Error\n    at D:\\kanet-tn12\\kasia-console\\src\\api\\pool.js:3290:15'), 'src/api/pool.js:3290');
  assert.equal(callerFrame(''), '?'); assert.equal(callerFrame(null), '?');
});

try { sqlite.close(); } catch { /* best-effort */ }
try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
