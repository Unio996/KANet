// events-type-index-v201.test.mjs — P2-6 6a 离线测试。跑: cd kasia-console && node src/db/events-type-index-v201.test.mjs
// 守: 记账式 built→present 幂等; :68 形(event_type=? AND payload_json LIKE ?)与 :83 形(event_type=? AND created_at > ?)EXPLAIN 都走 idx_events_type_created 不再 SCAN events;
//     preprune-capture-monitor 的 stale 去重形同; 播种查询走索引且返回 DISTINCT marketId(坏 JSON 被 json_valid 挡)。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'v201-'));
process.env.DB_PATH = join(dir, 'v201.db');
const { sqlite } = await import(pathToFileURL(join(HERE, 'client.js')).href);
const M = await import(pathToFileURL(join(HERE, 'events-type-index-v201.mjs')).href);

let n = 0, fail = 0;
const t = (name, fn) => { n++; try { fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
sqlite.exec(`CREATE TABLE events (id TEXT PRIMARY KEY, trace_id TEXT, event_scope TEXT NOT NULL DEFAULT 'system', event_type TEXT NOT NULL, source TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info', summary TEXT NOT NULL DEFAULT '', payload_json TEXT, created_at TEXT, agent_address TEXT);
  CREATE INDEX idx_events_created ON events(created_at DESC); CREATE INDEX idx_events_level ON events(level);`);
let k = 0;
const E = (type, payload, created = '2026-09-06 20:00:00') => sqlite.prepare("INSERT INTO events (id, event_type, source, payload_json, created_at) VALUES (?, ?, 'w', ?, ?)").run(`e${++k}`, type, payload, created);
for (let i = 0; i < 300; i++) E('noise_type_' + (i % 7), JSON.stringify({ x: i }));
E('side_lock_daa_unrecoverable', JSON.stringify({ marketId: 'mA', floor: 1 })); E('side_lock_daa_unrecoverable', JSON.stringify({ marketId: 'mA', again: 1 }));   // 同盘两条 ⇒ DISTINCT 一行
E('side_lock_daa_unrecoverable', JSON.stringify({ marketId: 'mB' })); E('side_lock_daa_unrecoverable', '{"marketId":"mBAD"');   // 坏 JSON ⇒ 播种不认
const plan = (sql) => { const st = sqlite.prepare('EXPLAIN QUERY PLAN ' + sql); const nq = (sql.match(/\?/g) || []).length; return st.all(...Array(nq).fill('x')).map((r) => r.detail).join(' | '); };
const Q68 = 'SELECT id FROM events WHERE event_type = ? AND payload_json LIKE ? LIMIT 1';
// :83 / monitor 活码里右侧是 datetime('now', '-1 hour'); 这里绑参(lint R-SQL-TIME-STRINGCMP 合法形), 规划器看到的谓词形相同(event_type=? AND created_at>?)
const Q83 = 'SELECT id FROM events WHERE event_type = ? AND payload_json LIKE ? AND created_at > ? LIMIT 1';
const QMON = 'SELECT id FROM events WHERE event_type = ? AND created_at > ? LIMIT 1';

t('V0 建索引前: :68 形 = SCAN events; :83 / monitor 形不走 event_type(只能借 created_at 索引或全扫)', () => {
  assert.match(plan(Q68), /SCAN events/);
  for (const q of [Q83, QMON]) { const p = plan(q); assert.doesNotMatch(p, /event_type/); assert.match(p, /SCAN events|idx_events_created/); }
});
t('V1 记账式: 首跑 built, 再跑 present, 索引在 sqlite_master 且不 ANALYZE(无 sqlite_stat1)', () => {
  const logs = []; const log = (s) => logs.push(s);
  assert.equal(M.ensureEventsTypeCreatedIndexV201(sqlite, { log }), 'built'); assert.match(logs[0], /\[migrate\] v201: idx_events_type_created 建完 \d+ ms/);
  assert.equal(M.ensureEventsTypeCreatedIndexV201(sqlite, { log }), 'present'); assert.match(logs[1], /在, 记账通过/);
  assert.ok(sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_events_type_created'").get());
  assert.ok(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_stat1'").get());
});
t('V2 建索引后: :68 / :83 / monitor 三形都 SEARCH events USING INDEX idx_events_type_created (event_type=?…), 无 SCAN events', () => {
  for (const q of [Q68, Q83, QMON]) { const p = plan(q); assert.match(p, /SEARCH events USING INDEX idx_events_type_created \(event_type=\?/); assert.doesNotMatch(p, /SCAN events/); }
  assert.match(plan(Q83), /event_type=\? AND created_at>\?/);   // 范围谓词走同索引第二列
});
t('V3 播种查询: DISTINCT marketId = {mA, mB}(同盘两条合一; 坏 JSON 不认), 走索引', () => {
  const rows = M.seedMarkedMarketIds(sqlite, 'side_lock_daa_unrecoverable');
  assert.deepEqual(rows.map((r) => r.marketId).sort(), ['mA', 'mB']);
  assert.match(plan(M.UNRECOVERABLE_SEED_SQL), /idx_events_type_created/);
  assert.deepEqual(M.seedMarkedMarketIds(sqlite, 'never_seen'), []);
});
t('V4 索引在时写入不抛; 新事件立刻可播种到', () => {
  E('side_lock_daa_unrecoverable', JSON.stringify({ marketId: 'mC' }));
  assert.deepEqual(M.seedMarkedMarketIds(sqlite, 'side_lock_daa_unrecoverable').map((r) => r.marketId).sort(), ['mA', 'mB', 'mC']);
});

try { sqlite.close(); } catch { /* best-effort */ }
try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
