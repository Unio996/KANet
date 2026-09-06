// preprune-capture-worker-unrecoverable-set.test.mjs — P2-6 6b 离线测试(J2 2026-09-06, NWT 两条件)。跑: cd kasia-console && node src/services/preprune-capture-worker-unrecoverable-set.test.mjs
// 离线: 不连 kaspad, 临时库自建 events / pool_markets / spc_daa_index_coverage / spc_prune_capture_heartbeat, 不 import pool-market-settler-v06(用 deps 注入绕过 body)。
// 守:
//   V1 播种: Set == events 里 DISTINCT marketId; 播种后 _hasBeenMarkedUnrecoverable 不再 prepare 任何 events 查询(计数 0); Set.size === 播种行数。
//   V2 播种失败 fail-closed(NWT ①): seed 抛 ⇒ _tick 返回 skipped='seed-failed', body 零调用, heartbeat (0,0), LOUD 一行; 集合保持 null(下 tick 重试)。
//   V3 LIKE↔精确等价(NWT ②): 干净向量逐一同判; 含 `_` 与大小写不同两向量断言"旧 LIKE 多认、新精确不认"的形状(新法更严, 活库 0 例)。
//   V4 新标即入集合: _markUnrecoverableIfBeyondFloor 插入后 has() 立即 true, 且 payload.marketId 与集合成员同串; 重置后重播种仍在(事件持久)。
//   V5 空值/重复行播种 ⇒ 抛(size 断言), 集合不被替换。
//   V6 阳性对照: 未播种 + 门放行 + 播种成功 ⇒ body 被调 1 次。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), 'ppw-set-')), 'ppw.db');
const { sqlite } = await import('../db/client.js');
const W = await import('./preprune-capture-worker.mjs');

let n = 0, fail = 0;
const t = async (name, fn) => { n++; try { await fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
sqlite.exec(`
  CREATE TABLE events (id TEXT PRIMARY KEY, trace_id TEXT, event_scope TEXT NOT NULL DEFAULT 'system', event_type TEXT NOT NULL, source TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info', summary TEXT NOT NULL DEFAULT '', payload_json TEXT, created_at TEXT, agent_address TEXT);
  CREATE INDEX idx_events_type_created ON events(event_type, created_at DESC);
  CREATE TABLE pool_markets (id TEXT PRIMARY KEY, protocol_status TEXT, deadline_daa INTEGER);
  CREATE TABLE market_shards (shard_market_id TEXT, logical_market_id TEXT);
  CREATE TABLE spc_daa_index_coverage (id INTEGER PRIMARY KEY AUTOINCREMENT, start_daa INTEGER NOT NULL, end_daa INTEGER NOT NULL);
  CREATE TABLE spc_prune_capture_heartbeat (id INTEGER PRIMARY KEY CHECK (id = 1), tick_count INTEGER NOT NULL DEFAULT 0, last_scanned_null_rows INTEGER NOT NULL DEFAULT 0, last_recaptured INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
  INSERT INTO spc_daa_index_coverage (start_daa, end_daa) VALUES (1000, 2000);
`);
let k = 0;
const E = (payload) => sqlite.prepare("INSERT INTO events (id, event_type, source, payload_json, created_at) VALUES (?, 'side_lock_daa_unrecoverable', 'w', ?, datetime('now'))").run(`e${++k}`, payload);
E(JSON.stringify({ marketId: 'mkt-aaa' })); E(JSON.stringify({ marketId: 'mkt-aaa', dup: 1 })); E(JSON.stringify({ marketId: 'mkt-bbb' }));
E(JSON.stringify({ marketId: 'mktXunder' }));   // 通配向量: 若【探测 id】含 `_`(如 'mkt_under'), 旧 LIKE 把它当单字通配 ⇒ 会把 'mktXunder' 的标记误认成自己的
E(JSON.stringify({ marketId: 'MKT-UPPER' }));   // 大写: 旧 LIKE 不分大小写 ⇒ 探测 'mkt-upper' 也会被旧法认为已标
const likeMarked = (id) => !!sqlite.prepare("SELECT id FROM events WHERE event_type = 'side_lock_daa_unrecoverable' AND payload_json LIKE ? LIMIT 1").get(`%"marketId":"${id}"%`);
// 计数 events 查询的 prepare(检验"播种后不再查库")
let eventsPrepares = 0; const origPrepare = sqlite.prepare.bind(sqlite);
sqlite.prepare = (sql) => { if (/FROM events/i.test(sql)) eventsPrepares++; return origPrepare(sql); };

await t('V1 播种: Set == DISTINCT {mkt-aaa, mkt-bbb, mktXunder, MKT-UPPER}(4); 播种后 has() 不再 prepare events 查询; size === 行数', async () => {
  W._resetUnrecoverableSet(); eventsPrepares = 0;
  const set = W._seedUnrecoverableSet(sqlite);
  assert.deepEqual([...set].sort(), ['MKT-UPPER', 'mkt-aaa', 'mkt-bbb', 'mktXunder']); assert.equal(W._unrecoverableSetSize(), 4); assert.equal(eventsPrepares, 1);
  eventsPrepares = 0;
  for (let i = 0; i < 1000; i++) { assert.equal(W._hasBeenMarkedUnrecoverable('mkt-aaa'), true); assert.equal(W._hasBeenMarkedUnrecoverable('mkt-zzz'), false); }
  assert.equal(eventsPrepares, 0);
});
await t('V2 播种失败 fail-closed: seed 抛 ⇒ _tick skipped=seed-failed, body 0 调用, heartbeat (0,0), LOUD 一行, 集合仍 null', async () => {
  W._resetUnrecoverableSet();
  let body = 0; const hb = []; const errs = []; const origErr = console.error; console.error = (...a) => errs.push(a.join(' '));
  const r = await W._tick({ readNodeSynced: async () => ({ synced: true, isSynced: true }), seedUnrecoverable: () => { throw new Error('boom-seed'); }, runBody: async () => { body++; }, writeHeartbeat: (s, c) => hb.push([s, c]) });
  console.error = origErr;
  assert.equal(r.skipped, 'seed-failed'); assert.match(r.error, /boom-seed/); assert.equal(body, 0); assert.deepEqual(hb, [[0, 0]]);
  assert.equal(errs.filter((l) => l.includes('unrecoverable-set seed FAILED')).length, 1); assert.equal(W._unrecoverableSetSize(), null);
});
await t('V2b 真播种路径失败(events 表暂时不可读) ⇒ 同判; 表恢复后下 tick 播种成功进 body', async () => {
  W._resetUnrecoverableSet(); sqlite.exec('ALTER TABLE events RENAME TO events_gone');
  let body = 0; const origErr = console.error; console.error = () => {};
  const realSeed = () => { if (W._unrecoverableSetSize() === null) W._seedUnrecoverableSet(sqlite); };   // = 生产路径的默认 seedFn(注入 runBody 的用例须显式带上)
  const r1 = await W._tick({ readNodeSynced: async () => ({ synced: true, isSynced: true }), seedUnrecoverable: realSeed, runBody: async () => { body++; }, writeHeartbeat: () => {} });
  console.error = origErr;
  assert.equal(r1.skipped, 'seed-failed'); assert.equal(body, 0); assert.equal(W._unrecoverableSetSize(), null);
  sqlite.exec('ALTER TABLE events_gone RENAME TO events');
  const r2 = await W._tick({ readNodeSynced: async () => ({ synced: true, isSynced: true }), seedUnrecoverable: realSeed, runBody: async () => { body++; return { scanned: 0, recaptured: 0 }; }, writeHeartbeat: () => {} });
  assert.equal(r2.skipped, undefined); assert.equal(body, 1); assert.equal(W._unrecoverableSetSize(), 4);
});
await t('V3 LIKE↔精确: 干净向量同判; `_` 与大小写两向量 = 旧 LIKE 多认、新精确不认(新法更严; 活库 2026-09-06 NWT 实核含 `_`/`%`/大写 id = 0)', async () => {
  W._resetUnrecoverableSet(); W._seedUnrecoverableSet(sqlite);
  for (const id of ['mkt-aaa', 'mkt-bbb', 'mkt-zzz', 'mkt-a', 'kt-aaa']) assert.equal(W._hasBeenMarkedUnrecoverable(id), likeMarked(id), id);
  assert.equal(likeMarked('mkt_under'), true); assert.equal(W._hasBeenMarkedUnrecoverable('mkt_under'), false);   // 探测 id 含 `_` ⇒ 旧 LIKE 通配误认 'mktXunder' 的标记; 新精确不认
  assert.equal(likeMarked('mkt-upper'), true); assert.equal(W._hasBeenMarkedUnrecoverable('mkt-upper'), false);   // 大小写
});
await t('V4 新标即入集合: _markUnrecoverableIfBeyondFloor 插入后 has() 立即 true; payload.marketId === 集合成员; 重置重播种仍在', async () => {
  W._resetUnrecoverableSet(); W._seedUnrecoverableSet(sqlite);
  sqlite.prepare("INSERT INTO pool_markets VALUES ('mkt-new', 'verifying', 500)").run();   // deadline_daa 500 < floor 1000
  const lm = sqlite.prepare("SELECT * FROM pool_markets WHERE id = 'mkt-new'").get();
  assert.equal(W._hasBeenMarkedUnrecoverable('mkt-new'), false);
  W._markUnrecoverableIfBeyondFloor(lm, 3);
  assert.equal(W._hasBeenMarkedUnrecoverable('mkt-new'), true);
  const row = sqlite.prepare("SELECT payload_json FROM events WHERE event_type = 'side_lock_daa_unrecoverable' ORDER BY rowid DESC LIMIT 1").get();
  assert.equal(JSON.parse(row.payload_json).marketId, 'mkt-new'); assert.equal(typeof JSON.parse(row.payload_json).marketId, 'string');
  W._resetUnrecoverableSet(); assert.equal(W._hasBeenMarkedUnrecoverable('mkt-new'), true); assert.equal(W._unrecoverableSetSize(), 5);
  W._markUnrecoverableIfBeyondFloor(lm, 3);   // 1h 去重 ⇒ 不再插第二条
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM events WHERE event_type = 'side_lock_daa_unrecoverable' AND payload_json LIKE '%mkt-new%'").get().n, 1);
});
await t('V5 播种行含空 marketId ⇒ 抛且集合不被替换', async () => {
  W._resetUnrecoverableSet(); W._seedUnrecoverableSet(sqlite); const before = W._unrecoverableSetSize();
  E(JSON.stringify({ marketId: '' }));
  assert.throws(() => W._seedUnrecoverableSet(sqlite), /empty marketId/); assert.equal(W._unrecoverableSetSize(), before);
  sqlite.prepare("DELETE FROM events WHERE payload_json = ?").run(JSON.stringify({ marketId: '' }));
});
await t('V6 阳性对照: 门放行 + 播种成功 ⇒ body 1 次; 注入 runBody 且不带 seed 的旧契约用例不被播种挡(ibd-gate/disable-env 用例形)', async () => {
  W._resetUnrecoverableSet(); let body = 0;
  const r = await W._tick({ readNodeSynced: async () => ({ synced: true, isSynced: true }), seedUnrecoverable: () => { if (W._unrecoverableSetSize() === null) W._seedUnrecoverableSet(sqlite); }, runBody: async () => { body++; return { scanned: 0, recaptured: 0 }; }, writeHeartbeat: () => {} });
  assert.equal(body, 1); assert.equal(r.scanned, 0); assert.equal(W._unrecoverableSetSize(), 5);
  W._resetUnrecoverableSet(); body = 0;
  const r2 = await W._tick({ readNodeSynced: async () => ({ synced: true, isSynced: true }), runBody: async () => { body++; return { scanned: 0, recaptured: 0 }; }, writeHeartbeat: () => {} });
  assert.equal(body, 1); assert.equal(r2.scanned, 0); assert.equal(W._unrecoverableSetSize(), null);   // 旧契约: 不播种、直接进注入的 body
});

sqlite.prepare = origPrepare;
try { sqlite.close(); } catch { /* best-effort */ }
console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
