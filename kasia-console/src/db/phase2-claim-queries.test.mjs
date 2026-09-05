// phase2-claim-queries.test.mjs — Phase-2 C 包 P2-4 离线测试(钱路: 自动 claim 候选)。跑: cd kasia-console && node src/db/phase2-claim-queries.test.mjs
// 事件 × sides 向量: 全匹配 / 只 market_id / 只 bettor_pk / 已 claim / lock NULL / redeem NULL / 键序不同+多余字段 / 坏 JSON 含子串(差 1) / 大小写不同(差 2)。
//   核心集合(去掉两条已知差的向量)新旧相等; 两条已知差各自断言形状(旧认新不认 ⇒ diffIdSets.onlyLegacy 恰为它们); 列集相同; EXPLAIN 新形走 (market_id, bettor_pk) 索引点查, 无 SCAN s。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'p24-'));
process.env.DB_PATH = join(dir, 'p24.db');
const { sqlite } = await import(pathToFileURL(join(HERE, 'client.js')).href);
const Q = await import(pathToFileURL(join(HERE, 'phase2-claim-queries.mjs')).href);
const { diffIdSets } = await import(pathToFileURL(join(HERE, 'phase2-shadow.mjs')).href);

let n = 0, fail = 0;
const t = (name, fn) => { n++; try { fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
sqlite.exec(`
  CREATE TABLE pool_markets (id TEXT PRIMARY KEY, deadline INTEGER NOT NULL DEFAULT 0, protocol_status TEXT);
  CREATE TABLE pool_bettor_sides (id INTEGER PRIMARY KEY AUTOINCREMENT, market_id TEXT NOT NULL, bettor_pk TEXT NOT NULL, direction INTEGER NOT NULL DEFAULT 1, stake_amount INTEGER NOT NULL DEFAULT 1,
    side_p2sh TEXT NOT NULL DEFAULT 'p', side_lock_tx TEXT, side_redeem_script_hex TEXT, claim_txid TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX idx_pool_sides_market ON pool_bettor_sides(market_id);
  CREATE UNIQUE INDEX idx_pool_sides_bettor_market ON pool_bettor_sides(market_id, bettor_pk);
  CREATE INDEX idx_pool_sides_market_bettor ON pool_bettor_sides(market_id, bettor_pk);
  CREATE UNIQUE INDEX idx_pool_sides_side_lock_tx_unique ON pool_bettor_sides(side_lock_tx) WHERE side_lock_tx IS NOT NULL;
  CREATE TABLE chain_events (id TEXT PRIMARY KEY, txid TEXT, event_type TEXT, from_address TEXT, to_address TEXT, payload TEXT, observed_by TEXT, observed_at INTEGER);
  CREATE INDEX idx_chain_events_type ON chain_events(event_type, observed_at DESC);
`);
let ev = 0;
const E = (payload, type = 'bettor_refund_available') => sqlite.prepare('INSERT INTO chain_events (id, event_type, payload, observed_at) VALUES (?,?,?,?)').run(`e${++ev}`, type, payload, ev);
const S = (id, mid, pk, { lock = 'tx', redeem = 'rr', claim = null } = {}) => { sqlite.prepare('INSERT INTO pool_markets VALUES (?, 1, ?)').run(mid, 'refunded'); sqlite.prepare('INSERT INTO pool_bettor_sides (id, market_id, bettor_pk, side_lock_tx, side_redeem_script_hex, claim_txid) VALUES (?,?,?,?,?,?)').run(id, mid, pk, lock === null ? null : `${lock}${id}`, redeem, claim); };
const pay = (o) => JSON.stringify(o);
S(1, 'm1', 'pkA'); E(pay({ market_id: 'm1', bettor_pk: 'pkA', side_id: 1 }));                       // 全匹配 ⇒ 两边都在
S(2, 'm2', 'pkB'); E(pay({ market_id: 'm2', bettor_pk: 'pkZ' }));                                   // 只 market_id ⇒ 都不在
S(3, 'm3', 'pkC'); E(pay({ market_id: 'mZ', bettor_pk: 'pkC' }));                                   // 只 bettor_pk ⇒ 都不在
S(4, 'm4', 'pkD', { claim: 'c' }); E(pay({ market_id: 'm4', bettor_pk: 'pkD' }));                   // 已 claim ⇒ 都不在
S(5, 'm5', 'pkE', { lock: null }); E(pay({ market_id: 'm5', bettor_pk: 'pkE' }));                   // lock NULL ⇒ 都不在
S(6, 'm6', 'pkF', { redeem: null }); E(pay({ market_id: 'm6', bettor_pk: 'pkF' }));                 // redeem NULL ⇒ 都不在
S(7, 'm7', 'pkG'); E('{"market_id":"m7","bettor_pk":"pkG",');                                       // 差 1: 坏 JSON 含子串 ⇒ 旧认新不认
S(8, 'm8', 'pkh'); E(pay({ market_id: 'm8', bettor_pk: 'PKH' }));                                   // 差 2: 大小写 ⇒ 旧认(LIKE ci)新不认
S(9, 'm9', 'pkI'); E(pay({ extra: 1, bettor_pk: 'pkI', market_id: 'm9', nested: { market_id: 'x' } }));   // 键序不同+多余字段 ⇒ 都在
S(10, 'm10', 'pkJ'); E(pay({ market_id: 'm10', bettor_pk: 'pkJ' }), 'other_type');                  // 类型不对 ⇒ 都不在
S(11, 'm11', 'pkK'); E(pay({ market_id: 'm11', bettor_pk: 'pkK' })); E(pay({ market_id: 'm11', bettor_pk: 'pkK', again: true }));   // 两条事件 ⇒ 都在且只一行
const ids = (rows) => rows.map((r) => r.id).sort((a, b) => a - b);
const KNOWN_DIVERGENT = [7, 8];

t('V1 旧集合 = {1,7,8,9,11}; 新集合 = {1,9,11}; 差恰为已知两向量(onlyLegacy=[7,8], onlyNew=[])', () => {
  const L = ids(Q.claimSidesLegacy(sqlite)), N = ids(Q.claimSidesReversed(sqlite));
  assert.deepEqual(L, [1, 7, 8, 9, 11]); assert.deepEqual(N, [1, 9, 11]);
  const d = diffIdSets(N, L); assert.deepEqual(d.onlyLegacy, ['7', '8']); assert.deepEqual(d.onlyNew, []);
});
t('V2 核心集合(去掉已知差向量)新旧相等, 且行内容逐列相等', () => {
  const f = (rows) => rows.filter((r) => !KNOWN_DIVERGENT.includes(r.id)).sort((a, b) => a.id - b.id);
  assert.deepEqual(f(Q.claimSidesLegacy(sqlite)), f(Q.claimSidesReversed(sqlite)));
});
t('V3 两条查询列集相同(下游按列名取)', () => {
  assert.deepEqual(sqlite.prepare(Q.LEGACY_CLAIM_SIDES_SQL).columns().map((c) => c.name), sqlite.prepare(Q.REVERSED_CLAIM_SIDES_SQL).columns().map((c) => c.name));
});
t('V4 已知差消失即相等: 把差 1 事件修成合法 JSON、差 2 事件大小写归一 ⇒ 两边集合相等', () => {
  sqlite.prepare("UPDATE chain_events SET payload = ? WHERE payload LIKE '%\"m7\"%'").run(pay({ market_id: 'm7', bettor_pk: 'pkG' }));
  sqlite.prepare("UPDATE chain_events SET payload = ? WHERE payload LIKE '%\"PKH\"%'").run(pay({ market_id: 'm8', bettor_pk: 'pkh' }));
  assert.deepEqual(ids(Q.claimSidesLegacy(sqlite)), ids(Q.claimSidesReversed(sqlite))); assert.equal(diffIdSets(ids(Q.claimSidesReversed(sqlite)), ids(Q.claimSidesLegacy(sqlite))).equal, true);
});
t('V5 EXPLAIN 新形: chain_events 走 idx_chain_events_type, sides 按 (market_id, bettor_pk) 索引点查, 无 SCAN s / SCAN pool_bettor_sides', () => {
  const p = sqlite.prepare('EXPLAIN QUERY PLAN ' + Q.REVERSED_CLAIM_SIDES_SQL).all().map((r) => r.detail).join(' | ');
  assert.match(p, /idx_chain_events_type/); assert.match(p, /SEARCH s USING INDEX idx_pool_sides_(market_bettor|bettor_market) \(market_id=\? AND bettor_pk=\?\)/);
  assert.doesNotMatch(p, /SCAN s\b|SCAN pool_bettor_sides/);
});
t('V6 状态翻转: side 1 claim 后两边同时掉', () => {
  sqlite.prepare("UPDATE pool_bettor_sides SET claim_txid = 'x' WHERE id = 1").run();
  assert.deepEqual(ids(Q.claimSidesLegacy(sqlite)), ids(Q.claimSidesReversed(sqlite))); assert.ok(!ids(Q.claimSidesLegacy(sqlite)).includes(1));
});

try { sqlite.close(); } catch { /* best-effort */ }
try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
