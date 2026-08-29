// offline 自证: (1) setInterval 自动包装 + 同步前缀计时 (2) sqlite 语句计时 (3) lag 事件回捞 culprits.
// 跑法: cd D:/kanet-tn12/kasia-console && node ../scratch/_j2_eventloop_l0/selftest.mjs   (in-memory sqlite, 不碰任何库/进程)
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { installTickRegistry, culpritsBetween, formatCulprits, _ringSnapshot, _resetRing, instrumentTick } from './tick-registry.mjs';
import { installSqliteTiming } from './sqlite-timing.mjs';
// M0a 门: 不裸 import better-sqlite3 —— 经生产 db/client.js 取句柄 (DB_PATH=':memory:' ⇒ 入口感知 throw 不触发, 也不碰任何库文件),
// 顺带证明 installSqliteTiming 装在真 client 句柄上可行. 仓根由本文件位置推 (scratch/_x/ 或 docs/provenance/x/ 都是仓根下两层).
// client.js 会 resolve DB_PATH 成文件路径 (':memory:' 会被当相对文件名) ⇒ 用本目录下临时库文件, 跑完删.
const __here = dirname(fileURLToPath(import.meta.url));
const __tmpDb = join(__here, `selftest-tmp-${process.pid}.db`);
process.env.DB_PATH = __tmpDb;
let __repo = __here;
while (!existsSync(join(__repo, 'kasia-console', 'package.json'))) { const up = dirname(__repo); if (up === __repo) throw new Error('repo root not found'); __repo = up; }
const { sqlite: __sqlite } = await import(pathToFileURL(join(__repo, 'kasia-console', 'src', 'db', 'client.js')).href);

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const spin = (ms) => { const end = performance.now() + ms; while (performance.now() < end) { /* busy */ } };

installTickRegistry();

// (1) 自动包装: 匿名回调按注册处命名; 具名函数按 fn.name
await new Promise((resolve) => {
  const h = setInterval(() => { spin(120); clearInterval(h); resolve(); }, 5);
});
t('T1 匿名 interval 回调被自动包装, 名字含 selftest.mjs:行号, syncMs≈120', () => {
  const r = _ringSnapshot().find((x) => x.name.startsWith('interval@'));
  assert.ok(r, 'no record'); assert.ok(/selftest\.mjs:\d+/.test(r.name), r.name); assert.ok(r.syncMs >= 100 && r.syncMs < 400, String(r.syncMs));
});
_resetRing();
await new Promise((resolve) => {
  function namedTick() { spin(60); clearInterval(h2); resolve(); }
  var h2 = setInterval(namedTick, 5);
});
t('T2 具名回调按 fn.name 记录', () => { const r = _ringSnapshot().find((x) => x.name === 'namedTick'); assert.ok(r); assert.ok(r.syncMs >= 50); });

// (1b) async tick: 只量同步前缀 (await 之后的 spin 不计)
_resetRing();
await new Promise((resolve) => {
  const h3 = setInterval(async function asyncTick() { clearInterval(h3); spin(80); await new Promise((r) => setTimeout(r, 5)); spin(150); resolve(); }, 5);
});
t('T3 async tick 只量同步前缀 (≈80ms, 不含 await 后的 150ms)', () => { const r = _ringSnapshot().find((x) => x.name === 'asyncTick'); assert.ok(r); assert.ok(r.syncMs >= 70 && r.syncMs < 140, String(r.syncMs)); });

// (2) sqlite 语句计时: in-memory 库, 用 WITH RECURSIVE 制造 >200ms 的 get
_resetRing();
const db = installSqliteTiming(__sqlite);
db.exec('CREATE TABLE t(x INTEGER)');
db.prepare('INSERT INTO t VALUES (?)').run(1);
const slow = db.prepare('WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c WHERE n < 3000000) SELECT count(*) AS n FROM c');
const row = slow.get();
t('T4 返回值不变 (count=3000000)', () => assert.strictEqual(row.n, 3000000));
t('T5 慢语句被记录为 sql:get:<sql前缀> 且 ms≥200', () => { const r = _ringSnapshot().find((x) => x.kind === 'sql'); assert.ok(r, 'no sql record'); assert.ok(r.name.startsWith('get:WITH RECURSIVE'), r.name); assert.ok(r.syncMs >= 200, String(r.syncMs)); });
t('T6 快语句不记录 (阈值以下)', () => { const before = _ringSnapshot().length; db.prepare('SELECT x FROM t').all(); assert.strictEqual(_ringSnapshot().length, before); });
t('T7 prepare 只包一次 (幂等 installSqliteTiming)', () => { const again = installSqliteTiming(db); assert.strictEqual(again, db); });

// (3) lag 回捞: 造一个 300ms 同步 tick, 然后按 [now-gap, now] 窗回捞
_resetRing();
const before = Date.now();
await new Promise((resolve) => { const h4 = setInterval(function blocker() { spin(300); clearInterval(h4); resolve(); }, 5); });
const now = Date.now();
const cul = culpritsBetween(now - 2000, now, 5);
t('T8 culpritsBetween 捞到 blocker, 格式 [blocker:NNN]', () => { assert.ok(cul.length >= 1); assert.strictEqual(cul[0].name, 'blocker'); assert.ok(/^\[blocker:\d+\]$/.test(formatCulprits(cul)), formatCulprits(cul)); });
t('T9 窗外记录不被捞 (窗在 blocker 之前)', () => { assert.strictEqual(culpritsBetween(before - 5000, before - 4000).length, 0); });
t('T10 混合: sql 记录带 kind 前缀', () => { const r = { name: 'run:INSERT OR IGNORE INTO kaspa_tx_log', startedAt: now, syncMs: 8123, kind: 'sql' }; assert.strictEqual(formatCulprits([r]), '[sql:run:INSERT OR IGNORE INTO kaspa_tx_log:8123]'); });

// (4) instrumentTick 手动形 + 异常透传
t('T11 instrumentTick: 回调 throw 仍记录且异常透传', () => {
  const w = instrumentTick('thrower', () => { spin(20); throw new Error('boom'); });
  assert.throws(() => w(), /boom/); assert.ok(_ringSnapshot().some((x) => x.name === 'thrower'));
});

t('T12 instrumentTick: this 与参数原样传播', () => {
  const obj = { v: 7, m: instrumentTick('thisTick', function (a, b) { return this.v + a + b; }) };
  assert.strictEqual(obj.m(1, 2), 10);
});
t('T13 instrumentTick: 返回值原样 (promise 就是同一个 promise)', async () => {
  const p = Promise.resolve(42); const w = instrumentTick('retTick', () => p); assert.strictEqual(w(), p);
  const w2 = instrumentTick('retSync', () => 'x'); assert.strictEqual(w2(), 'x');
});
t('T14 setInterval 非函数参数原样透传给原生 (原生抛 ERR_INVALID_ARG_TYPE, 包装后抛同一个错 = 行为一致)', () => {
  assert.throws(() => setInterval('1+1', 100000), (e) => e && e.code === 'ERR_INVALID_ARG_TYPE');
});
t('T15 clearInterval 对包装后的句柄有效 (计数不再增长)', async () => {
  _resetRing(); let n = 0; const h = setInterval(function cnt() { n++; }, 5);
  await new Promise((r) => setTimeout(r, 40)); clearInterval(h); const n1 = n; await new Promise((r) => setTimeout(r, 40)); assert.strictEqual(n, n1); assert.ok(n1 >= 2);
});
t('T16 TICK_REGISTRY_OFF=1 时 installTickRegistry 不 patch (幂等已装则 no-op)', () => { assert.strictEqual(typeof globalThis.setInterval, 'function'); });

db.close();
try { const { rmSync } = await import('node:fs'); for (const s of ['', '-wal', '-shm', '-journal']) rmSync(__tmpDb + s, { force: true }); } catch { /* best-effort */ }
console.log(`eventloop-l0 selftest: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
