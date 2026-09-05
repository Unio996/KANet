// phase2-handoff-candidates.test.mjs — Phase-2 B 包 P2-3 离线测试。跑: cd kasia-console && node src/db/phase2-handoff-candidates.test.mjs
// sanctioned 形: DB_PATH=mkdtemp 临时库 → import client.js(不裸 import better-sqlite3); 自建 payout_shards / pool_markets。
// 覆盖: 八类 metadata 行(缺 zk / 对象 / 坏 JSON / NULL / '' / zk=null / zk=false / zk=0 / zk='' / zk=true / zk='0')新 SQL 候选集合 == 旧 JS(parse+假值判)候选集合;
//   不取 metadata 血(列集); marketMetaById 与旧解析同语义; EXPLAIN 计划形(SCAN ps 722 + pm 主键点查, 与 BEFORE 同形——本项赢在数据量不在计划)。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'p23-'));
process.env.DB_PATH = join(dir, 'p23.db');
const { sqlite } = await import(pathToFileURL(join(HERE, 'client.js')).href);
const { handoffCandidateRows, handoffLegacyRows, marketMetaById, parseMetaLegacy, HANDOFF_CANDIDATE_ROWS_SQL } = await import(pathToFileURL(join(HERE, 'phase2-handoff-candidates.mjs')).href);

let n = 0, fail = 0;
const t = (name, fn) => { n++; try { fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
sqlite.exec(`
  CREATE TABLE pool_markets (id TEXT PRIMARY KEY, deadline INTEGER NOT NULL DEFAULT 0, metadata TEXT);
  CREATE TABLE payout_shards (logical_market_id TEXT PRIMARY KEY, payout_cov_id TEXT NOT NULL DEFAULT 'c', payout_ps_addr TEXT NOT NULL DEFAULT 'a', payout_ps_outpoint TEXT, payout_redeem_hex TEXT NOT NULL, pool_merkle_root TEXT, predicate_commit TEXT, created_at INTEGER);
`);
const cases = {
  absent: JSON.stringify({ zk_handoff_pending: { txId: 'x' } }),
  object: JSON.stringify({ zk_continuation: { proving: { status: 'ready' } } }),
  badjson: '{not json',
  nullmeta: null,
  emptymeta: '',
  zknull: JSON.stringify({ zk_continuation: null }),
  zkfalse: JSON.stringify({ zk_continuation: false }),
  zkzero: JSON.stringify({ zk_continuation: 0 }),
  zkempty: JSON.stringify({ zk_continuation: '' }),
  zktrue: JSON.stringify({ zk_continuation: true }),
  zkstr0: JSON.stringify({ zk_continuation: '0' }),   // JS: '0' 真值 ⇒ 跳过; SQL: 文本 '0' ∉ (0,'')
  noshard: JSON.stringify({}),   // 没有 payout_shards 行 ⇒ 两边都不候选
};
for (const [id, meta] of Object.entries(cases)) {
  sqlite.prepare('INSERT INTO pool_markets (id, metadata) VALUES (?, ?)').run(id, meta);
  if (id !== 'noshard') sqlite.prepare('INSERT INTO payout_shards (logical_market_id, payout_redeem_hex) VALUES (?, ?)').run(id, 'ab');
}
// 旧 JS(lib/zk-autonomy-ticks.mjs _scanHandoffCandidates 的 metadata 步, 不含 redeem 检查——redeem 检查两边同一函数, 不在本模块)
const legacyFilter = (rows) => { const out = []; for (const row of rows) { let meta; try { meta = JSON.parse(row.metadata || '{}'); } catch { continue; } if (meta.zk_continuation) continue; out.push(row.marketId); } return out.sort(); };

t('V1 八类+行: 新 SQL 候选集合 == 旧 JS 候选集合 == {absent, nullmeta, emptymeta, zknull, zkfalse, zkzero, zkempty}', () => {
  const neu = handoffCandidateRows(sqlite).map((r) => r.marketId).sort(); const old = legacyFilter(handoffLegacyRows(sqlite));
  assert.deepEqual(neu, ['absent', 'emptymeta', 'nullmeta', 'zkempty', 'zkfalse', 'zknull', 'zkzero']);
  assert.deepEqual(neu, old);
  for (const bad of ['object', 'badjson', 'zktrue', 'zkstr0', 'noshard']) assert.ok(!neu.includes(bad), bad);
});
t('V2 新查询不取 metadata 血: 列集 = {marketId, redeemHex}', () => {
  assert.deepEqual(sqlite.prepare(HANDOFF_CANDIDATE_ROWS_SQL).columns().map((c) => c.name), ['marketId', 'redeemHex']);
  assert.equal(handoffCandidateRows(sqlite)[0].redeemHex, 'ab');
});
t('V3 marketMetaById / parseMetaLegacy 与旧解析同语义: 坏 JSON ⇒ null, NULL/"" ⇒ {}, 对象原样, 不存在 ⇒ null', () => {
  assert.equal(marketMetaById(sqlite, 'badjson'), null); assert.deepEqual(marketMetaById(sqlite, 'nullmeta'), {}); assert.deepEqual(marketMetaById(sqlite, 'emptymeta'), {});
  assert.deepEqual(marketMetaById(sqlite, 'absent'), { zk_handoff_pending: { txId: 'x' } }); assert.equal(marketMetaById(sqlite, 'nope'), null);
  assert.equal(parseMetaLegacy('{'), null); assert.deepEqual(parseMetaLegacy(undefined), {});
});
t('V4 状态翻转: 给 absent 写入 zk_continuation 对象 ⇒ 两边都不再候选; 清掉 ⇒ 都回来', () => {
  sqlite.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?').run(JSON.stringify({ zk_continuation: { a: 1 } }), 'absent');
  assert.ok(!handoffCandidateRows(sqlite).some((r) => r.marketId === 'absent')); assert.ok(!legacyFilter(handoffLegacyRows(sqlite)).includes('absent'));
  sqlite.prepare('UPDATE pool_markets SET metadata = ? WHERE id = ?').run(JSON.stringify({}), 'absent');
  assert.ok(handoffCandidateRows(sqlite).some((r) => r.marketId === 'absent')); assert.ok(legacyFilter(handoffLegacyRows(sqlite)).includes('absent'));
});
t('V5 EXPLAIN 形: SCAN ps + pm 主键点查(与 BEFORE 同形; 本项赢在不搬 metadata, 不在计划)', () => {
  const p = sqlite.prepare('EXPLAIN QUERY PLAN ' + HANDOFF_CANDIDATE_ROWS_SQL).all().map((r) => r.detail).join(' | ');
  assert.match(p, /SCAN ps/); assert.match(p, /SEARCH pm USING INDEX sqlite_autoindex_pool_markets_1 \(id=\?\)/);
});

try { sqlite.close(); } catch { /* best-effort */ }
try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
