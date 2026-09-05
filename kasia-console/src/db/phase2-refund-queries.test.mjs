// phase2-refund-queries.test.mjs — Phase-2 C 包 P2-2 离线测试(钱路: P1 退款授权闸的 sides 扫描)。跑: cd kasia-console && node src/db/phase2-refund-queries.test.mjs
// 旧查询 oracle = 【直接从 services/pool-market-settler.js 源码抽取】内联模板(不复制文本 ⇒ 不会与主路漂移; 锚点移动即 throw)。
// 三入口(v0.5/NULL · unfixable · cancelled/refunded v0.6/v0.7)各 ≥1 市场 × sides 七态(lock NULL / claim 已设 / attempt 10min 前 / attempt 2h 前 / attempt NULL / attempt 整数 epoch / attempt T 形)
//   + 排除类(deadline 未到 / 坏 JSON / metadata NULL / 授权不在白名单 / completed / v0.7 collecting_sigs 不在 unfixable):
//   新旧查询去 LIMIT【逐行相等】(按 side_id 归一) · 带 LIMIT 同长同 stake 序列 · unfixable 空("''"占位)两边同 · EXPLAIN 新形含 MATERIALIZE m + deadline 索引且无 SCAN pool_markets
//   · V7 refund_attempted_at 三种存值形(空格 / 整数 epoch / T 形)逐一同判(参数绑定 == SQL 内 datetime())。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'p22-'));
process.env.DB_PATH = join(dir, 'p22.db');
const { sqlite } = await import(pathToFileURL(join(HERE, 'client.js')).href);
const Q = await import(pathToFileURL(join(HERE, 'phase2-refund-queries.mjs')).href);
const { REFUND_AUTHORIZATION_SQL_IN: AUTH_IN, REFUND_AUTHORIZATION_WHITELIST: WL } = await import(pathToFileURL(join(HERE, '..', 'lib', 'refund-authorization.mjs')).href);

// ── 旧查询 oracle: 从 settler 源码抽 `const _legacySidesSql = \`...\`` 模板 ──
const settlerSrc = readFileSync(join(HERE, '..', 'services', 'pool-market-settler.js'), 'utf8');
const mStart = settlerSrc.indexOf('const _legacySidesSql = `'); assert.ok(mStart > 0, 'settler 锚点 _legacySidesSql 不在');
const tplStart = mStart + 'const _legacySidesSql = `'.length; const tplEnd = settlerSrc.indexOf('`;', tplStart); assert.ok(tplEnd > tplStart);
const LEGACY_TPL = settlerSrc.slice(tplStart, tplEnd);
assert.ok(LEGACY_TPL.includes('${unfixablePlaceholders}') && LEGACY_TPL.includes('${REFUND_AUTHORIZATION_SQL_IN}') && /LIMIT \?\s*$/.test(LEGACY_TPL), '模板形变了');
const legacySql = (ph, authIn, { limit = true } = {}) => { const s = LEGACY_TPL.replace('${unfixablePlaceholders}', ph).replace('${REFUND_AUTHORIZATION_SQL_IN}', authIn); return limit ? s : s.replace(/LIMIT \?\s*$/, ''); };

let n = 0, fail = 0;
const t = (name, fn) => { n++; try { fn(); console.log(`  ✅ ${name}`); } catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); } };
sqlite.exec(`
  CREATE TABLE pool_markets (id TEXT PRIMARY KEY, deadline INTEGER NOT NULL DEFAULT 0, protocol_version TEXT, protocol_status TEXT, metadata TEXT);
  CREATE INDEX idx_pool_markets_deadline ON pool_markets(deadline);
  CREATE TABLE pool_bettor_sides (id INTEGER PRIMARY KEY AUTOINCREMENT, market_id TEXT NOT NULL, bettor_pk TEXT NOT NULL, direction INTEGER NOT NULL DEFAULT 1, stake_amount INTEGER NOT NULL,
    side_p2sh TEXT NOT NULL DEFAULT 'p', side_lock_tx TEXT, side_redeem_script_hex TEXT, claim_txid TEXT, refund_attempted_at TIMESTAMP, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);   -- refund_attempted_at TIMESTAMP = 活库 v142 同型(NUMERIC 亲和: 整数存整数, 空格形/T 形存文本)
  CREATE INDEX idx_pool_sides_market ON pool_bettor_sides(market_id);
  CREATE UNIQUE INDEX idx_pool_sides_bettor_market ON pool_bettor_sides(market_id, bettor_pk);
  CREATE UNIQUE INDEX idx_pool_sides_side_lock_tx_unique ON pool_bettor_sides(side_lock_tx) WHERE side_lock_tx IS NOT NULL;
`);
const NOW = 1_800_000_000, PAST = NOW - 100, FUTURE = NOW + 100;
const ok = JSON.stringify({ refund_authorization: WL[0] });
const M = (id, ver, status, deadline, meta) => sqlite.prepare('INSERT INTO pool_markets VALUES (?,?,?,?,?)').run(id, deadline, ver, status, meta);
M('mA', null, 'open', PAST, ok); M('mB', 'v0.5', 'open', PAST, ok);                     // 入口 1
M('mC', 'v0.6', 'cancelled', PAST, ok); M('mD', 'v0.7', 'refunded', PAST, ok);          // 入口 3
M('mE', 'v0.7', 'collecting_sigs', PAST, ok);                                          // 入口 2(只在 unfixable 里)
M('mF', 'v0.7', 'collecting_sigs', PAST, ok);                                          // 不在 unfixable ⇒ 排除
M('mG', null, 'open', FUTURE, ok); M('mH', null, 'open', PAST, '{bad'); M('mI', null, 'open', PAST, JSON.stringify({ refund_authorization: 'nope' }));
M('mJ', 'v0.6', 'completed', PAST, ok); M('mK', null, 'open', PAST, null); M('mL', 'v0.6', 'cancelled', PAST, JSON.stringify({}));
let seq = 0;
const S = (mid, stake, { lock = 'tx', claim = null, attempt = null } = {}) => { seq++; sqlite.prepare('INSERT INTO pool_bettor_sides (market_id, bettor_pk, stake_amount, side_lock_tx, side_redeem_script_hex, claim_txid, refund_attempted_at) VALUES (?,?,?,?,?,?,?)').run(mid, `pk${seq}`, stake, lock === null ? null : `${lock}${seq}`, 'rr', claim, attempt); };
const sqlv = (expr) => sqlite.prepare(`SELECT ${expr} AS v`).get().v;
const RECENT = sqlv("datetime('now', '-10 minutes')"), OLD = sqlv("datetime('now', '-2 hours')");
const EPOCH_INT = 1783785324;                                   // 活库实存形(5 行): 整数 vs TEXT ⇒ 整数恒小 ⇒ 旧法判候选
const TFORM_RECENT = sqlv("strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-10 minutes')");   // T 形: 'T'(0x54) > ' '(0x20) ⇒ 字符串比较判"晚于" ⇒ 排除(两边同判)
for (const mid of ['mA', 'mB', 'mC', 'mD', 'mE', 'mF', 'mG', 'mH', 'mI', 'mJ', 'mK', 'mL']) {
  S(mid, 500); S(mid, 100, { lock: null }); S(mid, 200, { claim: 'c' }); S(mid, 300, { attempt: RECENT }); S(mid, 400, { attempt: OLD }); S(mid, 500); S(mid, 600, { attempt: EPOCH_INT }); S(mid, 700, { attempt: TFORM_RECENT });
}
const UNFIX = ['mE'];
const ph = Q.unfixablePlaceholdersOf;
const runOld = (ids, limit) => sqlite.prepare(legacySql(ph(ids), AUTH_IN, { limit: limit != null })).all(...ids, NOW, ...(limit != null ? [limit] : []));
const runNew = (ids, limit) => sqlite.prepare(Q.materializedRefundSidesSql(ph(ids), AUTH_IN, { limit: limit != null })).all(...ids, NOW, Q.refundCutoffText(sqlite), ...(limit != null ? [limit] : []));
const norm = (rows) => rows.map((r) => ({ ...r })).sort((a, b) => a.side_id - b.side_id);
const IN_STAKES = [400, 500, 500, 600];   // attempt 2h 前 / NULL ×2 / 整数 epoch

t('V0 oracle 来源: 旧 SQL 从 settler 源码抽取(含 P1 闸注释), 主路与 oracle 同一文本', () => {
  assert.match(LEGACY_TPL, /json_valid\(pm\.metadata\)/); assert.match(LEGACY_TPL, /refund_attempted_at IS NULL OR pbs\.refund_attempted_at </); assert.match(LEGACY_TPL, /P1「验不成 ≠ 可以退款」授权闸/);
  assert.ok(settlerSrc.includes('sqlite.prepare(_legacySidesSql)'), '主路须 prepare(_legacySidesSql)');
});
t('V1 去 LIMIT 逐行相等(含列值), 集合 = 5 市场 × 4 态 = 20 行; 排除类 0 行', () => {
  const a = norm(runOld(UNFIX)), b = norm(runNew(UNFIX));
  assert.equal(a.length, 20); assert.deepEqual(a, b);
  assert.deepEqual([...new Set(a.map((r) => r.market_id))].sort(), ['mA', 'mB', 'mC', 'mD', 'mE']);
  for (const mid of ['mA', 'mB', 'mC', 'mD', 'mE']) assert.deepEqual(a.filter((r) => r.market_id === mid).map((r) => r.stake_amount).sort((x, y) => x - y), IN_STAKES);
  assert.deepEqual(Object.keys(a[0]), ['side_id', 'market_id', 'bettor_pk', 'side_p2sh', 'side_lock_tx', 'side_redeem_script_hex', 'stake_amount', 'deadline', 'protocol_version']);
});
t('V2 带 LIMIT 4: 两边同长, stake 序列相同(ORDER BY stake ASC), 且都是去 LIMIT 集合的子集', () => {
  const a = runOld(UNFIX, 4), b = runNew(UNFIX, 4);
  assert.equal(a.length, 4); assert.equal(b.length, 4); assert.deepEqual(a.map((r) => r.stake_amount), b.map((r) => r.stake_amount));
  const full = new Set(runOld(UNFIX).map((r) => r.side_id)); for (const r of [...a, ...b]) assert.ok(full.has(r.side_id));
});
t('V3 unfixable 空 ⇒ 占位 "\'\'" 两边同(mE 掉出, 16 行); unfixable 含 mF ⇒ mF 进来(24 行)', () => {
  const a = norm(runOld([])), b = norm(runNew([]));
  assert.equal(a.length, 16); assert.deepEqual(a, b); assert.ok(!a.some((r) => r.market_id === 'mE'));
  const c = norm(runOld(['mE', 'mF'])), d = norm(runNew(['mE', 'mF']));
  assert.equal(c.length, 24); assert.deepEqual(c, d);
});
t('V4 影子 helper refundSidesIdsMaterialized == 旧查询去 LIMIT 的 side_id 集合', () => {
  const a = runOld(UNFIX).map((r) => r.side_id).sort((x, y) => x - y), b = Q.refundSidesIdsMaterialized(sqlite, UNFIX, AUTH_IN, NOW).sort((x, y) => x - y);
  assert.equal(a.length, 20); assert.deepEqual(a, b);
});
t('V5 EXPLAIN 新形: MATERIALIZE m + SEARCH pm USING INDEX idx_pool_markets_deadline + 外层 pbs 按 market_id 索引; 无 SCAN pool_markets/SCAN pm', () => {
  const p = sqlite.prepare('EXPLAIN QUERY PLAN ' + Q.materializedRefundSidesSql(ph(UNFIX), AUTH_IN)).all(...UNFIX, NOW, 'x', 4).map((r) => r.detail).join(' | ');
  assert.match(p, /MATERIALIZE m/); assert.match(p, /SEARCH pm USING INDEX idx_pool_markets_deadline/); assert.match(p, /SEARCH pbs USING INDEX idx_pool_sides_(market|bettor_market) \(market_id=\?\)/);
  assert.doesNotMatch(p, /SCAN pool_markets|SCAN pm\b/);
});
t('V6 状态翻转: 一行 claim 后两边同时掉; refund_attempted_at 刚刷新(CURRENT_TIMESTAMP 空格形) ⇒ 两边同时掉', () => {
  const id = runOld(UNFIX)[0].side_id;
  sqlite.prepare("UPDATE pool_bettor_sides SET claim_txid = 'x' WHERE id = ?").run(id);
  assert.deepEqual(norm(runOld(UNFIX)), norm(runNew(UNFIX))); assert.equal(runOld(UNFIX).length, 19);
  const id2 = runOld(UNFIX)[0].side_id;
  sqlite.prepare('UPDATE pool_bettor_sides SET refund_attempted_at = CURRENT_TIMESTAMP WHERE id = ?').run(id2);
  assert.deepEqual(norm(runOld(UNFIX)), norm(runNew(UNFIX))); assert.equal(runOld(UNFIX).length, 18);
});
t('V7 refund_attempted_at 三种存值形逐一同判: 整数 epoch ⇒ 两边都候选(整数恒小于 TEXT); T 形 10min 前 ⇒ 两边都排除(T > 空格); 空格形 2h 前 ⇒ 都候选; 空格形 10min 前 ⇒ 都排除', () => {
  const counts = (rows) => { const o = {}; for (const st of [300, 400, 500, 600, 700]) o[st] = rows.filter((r) => r.stake_amount === st).length; return o; };
  const a = runOld(UNFIX), b = runNew(UNFIX);
  const dump = JSON.stringify({ old: counts(a), neu: counts(b), rows600: sqlite.prepare('SELECT id, market_id, refund_attempted_at, typeof(refund_attempted_at) ty, claim_txid FROM pool_bettor_sides WHERE stake_amount = 600').all() });
  assert.deepEqual(counts(a), counts(b), dump);
  // V6 已把 2 行(stake 400)动过: 一行 claim、一行 attempt 刷新 ⇒ 400 剩 3
  assert.deepEqual(counts(a), { 300: 0, 400: 3, 500: 10, 600: 5, 700: 0 }, dump);   // 600=整数 epoch 都候选; 700=T 形都排除; 300=空格 10min 前都排除
  assert.equal(typeof sqlite.prepare('SELECT refund_attempted_at v FROM pool_bettor_sides WHERE stake_amount = 600 LIMIT 1').get().v, 'number');
});

try { sqlite.close(); } catch { /* best-effort */ }
try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
console.log(`\n${n - fail} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
