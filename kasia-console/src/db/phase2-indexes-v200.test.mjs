// phase2-indexes-v200.test.mjs — Phase-2 A 包离线测试。跑: cd kasia-console && node src/db/phase2-indexes-v200.test.mjs
// sanctioned 形: DB_PATH=mkdtemp 临时库 → import client.js 拿 sqlite(不裸 import better-sqlite3); 自建 pool_markets / pool_bettor_sides / market_shards 小表。
// 覆盖: v200 幂等(built→present); P2-1 四类行(ready / 非 ready / exhausted-但-ready / 坏 JSON / NULL)新旧查询 + JS 筛后候选集合相等且坏 JSON 不在集合;
//   EXPLAIN 断言(NWT C2): ZK 查询含 idx_pool_markets_zk_ready, my-positions 形查询含 idx_pool_sides_bettor_created 且无 TEMP B-TREE;
//   坏 JSON INSERT/UPDATE 不抛(索引在时); 表达式单源(DDL 与查询串含同一 ZK_READY_EXPR)。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'v200-'));
process.env.DB_PATH = join(dir, 'v200.db');
const { sqlite } = await import(pathToFileURL(join(HERE, 'client.js')).href);
const M = await import(pathToFileURL(join(HERE, 'phase2-indexes-v200.mjs')).href);
const { ensurePhase2IndexesV200, zkReadyCandidateRows, zkLegacyLikeRows, ZK_READY_EXPR, ZK_READY_INDEX_DDL, ZK_READY_ROWS_SQL, ZK_READY_INDEX_NAME, SIDES_BETTOR_CREATED_INDEX_NAME } = M;

let n = 0, fail = 0;
const t = (name, fn) => { n++; try { fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
sqlite.exec(`
  CREATE TABLE pool_markets (id TEXT PRIMARY KEY, deadline INTEGER NOT NULL DEFAULT 0, protocol_status TEXT, metadata TEXT, protocol_version TEXT);
  CREATE TABLE pool_bettor_sides (id INTEGER PRIMARY KEY AUTOINCREMENT, market_id TEXT NOT NULL, bettor_pk TEXT NOT NULL, direction INTEGER NOT NULL, stake_amount INTEGER NOT NULL, side_p2sh TEXT NOT NULL, side_lock_tx TEXT, merkle_index INTEGER, claim_txid TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX idx_pool_sides_market ON pool_bettor_sides(market_id);
  CREATE INDEX idx_pool_sides_market_bettor ON pool_bettor_sides(market_id, bettor_pk);
  CREATE TABLE market_shards (id INTEGER PRIMARY KEY AUTOINCREMENT, logical_market_id TEXT NOT NULL, shard_market_id TEXT NOT NULL, UNIQUE(shard_market_id));
`);
const ins = (id, meta) => sqlite.prepare('INSERT INTO pool_markets (id, metadata) VALUES (?, ?)').run(id, meta);
const zc = (status, extra = {}) => JSON.stringify({ zk_continuation: { proving: { status }, outpoint: 'o', redeemHex: 'aa', ...extra } });
ins('ready1', zc('ready')); ins('ready2', zc('ready')); ins('pending', zc('pending')); ins('exhausted', zc('ready', { exhausted: true }));
ins('noOutpoint', JSON.stringify({ zk_continuation: { proving: { status: 'ready' } } })); ins('nozk', JSON.stringify({ foo: 1 })); ins('badjson', '{not json'); ins('nul', null);
ins('likeOnly', JSON.stringify({ note: 'mentions zk_continuation in text only' }));   // 旧 LIKE 会取到, JS 筛后不是候选

// 与 lib/zk-autonomy-ticks.mjs _scanZkAutonomyCandidates 相同的 JS 筛
const jsFilter = (rows) => { const out = []; for (const row of rows) { let meta; try { meta = JSON.parse(row.metadata || '{}'); } catch { continue; } const z = meta.zk_continuation; if (!z || z.exhausted === true) continue; if (!z.proving || z.proving.status !== 'ready') continue; if (!z.outpoint || !z.redeemHex) continue; out.push(row.id); } return out.sort(); };
const hasIdx = (name) => !!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(name);
const plan = (sql, ...a) => sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(...a).map((r) => r.detail).join(' | ');

t('V0 表达式单源: 索引 DDL 与查询串都含同一 ZK_READY_EXPR; 查询用字面量 = \'ready\'(C1/C2)', () => {
  assert.ok(ZK_READY_INDEX_DDL.includes(ZK_READY_EXPR)); assert.ok(ZK_READY_ROWS_SQL.includes(ZK_READY_EXPR)); assert.ok(ZK_READY_ROWS_SQL.endsWith("= 'ready'"));
  assert.equal((ZK_READY_INDEX_DDL.match(/CASE WHEN json_valid/g) || []).length, 2);
});
t('V1 v200 首跑 built×2, 再跑 present×2(幂等), 两索引在 sqlite_master', () => {
  const logs = [];
  assert.deepEqual(ensurePhase2IndexesV200(sqlite, { log: (s) => logs.push(s) }), { [SIDES_BETTOR_CREATED_INDEX_NAME]: 'built', [ZK_READY_INDEX_NAME]: 'built' });
  assert.deepEqual(ensurePhase2IndexesV200(sqlite, { log: (s) => logs.push(s) }), { [SIDES_BETTOR_CREATED_INDEX_NAME]: 'present', [ZK_READY_INDEX_NAME]: 'present' });
  assert.equal(hasIdx(ZK_READY_INDEX_NAME), true); assert.equal(hasIdx(SIDES_BETTOR_CREATED_INDEX_NAME), true); assert.equal(logs.length, 4); assert.match(logs[0], /建完 \d+ ms/); assert.match(logs[2], /记账通过/);
});
t('V2 P2-1 候选集合: 新查询 + JS 筛 == 旧 LIKE + JS 筛 == {ready1, ready2}; 坏 JSON/NULL/exhausted/noOutpoint/likeOnly 都不在', () => {
  const neu = jsFilter(zkReadyCandidateRows(sqlite)); const old = jsFilter(zkLegacyLikeRows(sqlite));
  assert.deepEqual(neu, ['ready1', 'ready2']); assert.deepEqual(old, ['ready1', 'ready2']);
  const rawNew = zkReadyCandidateRows(sqlite).map((r) => r.id).sort(); assert.deepEqual(rawNew, ['exhausted', 'noOutpoint', 'ready1', 'ready2']);   // SQL 层 = proving.status='ready' 超集, JS 再筛
  assert.ok(!zkReadyCandidateRows(sqlite).some((r) => r.id === 'badjson' || r.id === 'nul'));
});
t('V3 (C2) EXPLAIN: ZK 查询走 idx_pool_markets_zk_ready', () => {
  const p = plan(ZK_READY_ROWS_SQL); assert.match(p, new RegExp(`USING INDEX ${ZK_READY_INDEX_NAME}`)); assert.doesNotMatch(p, /SCAN pool_markets/);
});
t('V4 (P2-5) EXPLAIN: my-positions 形查询走 idx_pool_sides_bettor_created 且无 TEMP B-TREE; 结果按 created_at DESC', () => {
  for (let i = 0; i < 5; i++) sqlite.prepare("INSERT INTO pool_bettor_sides (market_id, bettor_pk, direction, stake_amount, side_p2sh, created_at) VALUES ('m', ?, 1, 1, 'p', ?)").run(i % 2 ? 'pkA' : 'pkB', `2026-09-0${i + 1}T00:00:00Z`);
  const Q = 'SELECT s.id, s.created_at FROM pool_bettor_sides s LEFT JOIN market_shards ms ON ms.shard_market_id = s.market_id LEFT JOIN pool_markets m ON m.id = COALESCE(ms.logical_market_id, s.market_id) WHERE s.bettor_pk = ? ORDER BY s.created_at DESC';
  const p = plan(Q, 'pkA'); assert.match(p, new RegExp(`USING INDEX ${SIDES_BETTOR_CREATED_INDEX_NAME}`)); assert.doesNotMatch(p, /TEMP B-TREE/);
  assert.deepEqual(sqlite.prepare(Q).all('pkA').map((r) => r.created_at), ['2026-09-04T00:00:00Z', '2026-09-02T00:00:00Z']);
  const Q2 = 'SELECT s.id FROM pool_bettor_sides s LEFT JOIN market_shards ms ON ms.shard_market_id = s.market_id WHERE s.bettor_pk = ? AND s.direction = ? AND COALESCE(ms.logical_market_id, s.market_id) = ?';
  assert.match(plan(Q2, 'pkA', 1, 'm'), new RegExp(`USING INDEX ${SIDES_BETTOR_CREATED_INDEX_NAME}`));   // :3402 同路
});
t('V5 索引在时: 坏 JSON INSERT/UPDATE 不抛; 状态翻转后候选跟着变(索引维护正确)', () => {
  ins('bad2', '{"zk_continuation":'); sqlite.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?').run('{{', 'bad2');
  sqlite.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?').run(zc('pending'), 'ready2');
  assert.deepEqual(jsFilter(zkReadyCandidateRows(sqlite)), ['ready1']);
  sqlite.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?').run(zc('ready'), 'pending');
  assert.deepEqual(jsFilter(zkReadyCandidateRows(sqlite)), ['pending', 'ready1']);
  assert.deepEqual(jsFilter(zkLegacyLikeRows(sqlite)), ['pending', 'ready1']);
});
t('V6 影子节奏(A v2 · NWT 条件): 默认/缺省/非法/0/负 ⇒ 0 ⇒ shadowDue 对 1..10000 次全假(永不调旧 LIKE); =100 ⇒ 只在 100 的倍数真; 0 次永假', () => {
  for (const env of [{}, { PHASE2_SHADOW_EVERY: '' }, { PHASE2_SHADOW_EVERY: 'abc' }, { PHASE2_SHADOW_EVERY: '0' }, { PHASE2_SHADOW_EVERY: '-5' }]) assert.equal(M.resolveShadowEvery(env), 0, JSON.stringify(env));
  assert.equal(M.resolveShadowEvery({ PHASE2_SHADOW_EVERY: '100' }), 100); assert.equal(M.resolveShadowEvery({ PHASE2_SHADOW_EVERY: '10' }), 10);
  const every0 = M.resolveShadowEvery({});
  let due = 0; for (let c = 1; c <= 10000; c++) if (M.shadowDue(c, every0)) due++;
  assert.equal(due, 0);
  const hits = []; for (let c = 0; c <= 350; c++) if (M.shadowDue(c, 100)) hits.push(c);
  assert.deepEqual(hits, [100, 200, 300]);
});

try { sqlite.close(); } catch { /* best-effort */ }
try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
