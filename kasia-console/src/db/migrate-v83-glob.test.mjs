// migrate-v83-glob.test.mjs — v83 backfill DELETE 的 GLOB 修正回归(J2 2026-08-28 · NWT GO)。跑: node kasia-console/src/db/migrate-v83-glob.test.mjs
// 🔴 临时库 + 真 runMigrations(); 被测语句 = 从 migrate.js 源码【抽出的那条 DELETE 原文】(不抄副本), 保证测的是生产语句。
// ⚠ runMigrations() 无 "停在 v82" 开关 ⇒ 构造法: 全量迁移(触发器已在)→ 临时 DROP 触发器(否则非 hex 行插不进)→ 插四类 broker_% 行 → 跑抽出的 DELETE → 断言;
//    阴性对照 = 同数据上跑错形 '[!...]' ⇒ 合法 hex 行也被删; 幂等 = 重建触发器后再 runMigrations() 两次, :2433 守卫使块不再执行, 行数不变。
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'v83-glob-'));
process.env.DB_PATH = join(dir, 'probe.db');
const { runMigrations } = await import('./migrate.js');
const { sqlite, dbPath } = await import('./client.js');
assert.ok(dbPath.startsWith(dir), `安全闸: 必须临时库, 实际 ${dbPath}`);
runMigrations();

let pass = 0, fail = 0;
const t = (n, f) => { try { f(); pass++; console.log('[PASS] ' + n); } catch (e) { fail++; console.log('[FAIL] ' + n + ' :: ' + e.message); } };
const SRC = readFileSync(new URL('./migrate.js', import.meta.url), 'utf8');
// 抽出生产 DELETE 原文(v83 块内唯一一条 DELETE FROM chain_events)
const m = /DELETE FROM chain_events\s+WHERE event_type LIKE 'broker_%'\s+AND \(length\(txid\) != 64 OR txid GLOB '([^']+)'\)/.exec(SRC);
assert.ok(m, 'migrate.js 里找不到 v83 backfill DELETE 原文');
const DELETE_SQL = m[0]; const GLOB = m[1];
const TRIGGER_DDL = /CREATE TRIGGER chain_events_txid_format_check[\s\S]*?END;/.exec(SRC)?.[0];
assert.ok(TRIGGER_DDL, '找不到 v83 触发器 DDL');

const cols = sqlite.prepare('PRAGMA table_info(chain_events)').all();
const fill = (event_type, txid) => { const row = {}; for (const c of cols) { if (c.name === 'event_type') row[c.name] = event_type; else if (c.name === 'txid') row[c.name] = txid; else if (c.notnull && c.dflt_value == null && !c.pk) row[c.name] = /INT|REAL|NUM/i.test(c.type) ? 1 : 'x'; } return row; };
const insert = (event_type, txid) => { const row = fill(event_type, txid); const ks = Object.keys(row); sqlite.prepare(`INSERT INTO chain_events (${ks.join(',')}) VALUES (${ks.map(() => '?').join(',')})`).run(...ks.map((k) => row[k])); };
const ROWS = [['hex64', 'a'.repeat(64)], ['hex64b', '0123456789abcdef'.repeat(4)], ['short', 'placeholder'], ['g64', 'g'.repeat(64)], ['dash64', '-'.repeat(64)]];
const remaining = () => sqlite.prepare("SELECT txid FROM chain_events WHERE event_type LIKE 'broker_%' ORDER BY txid").all().map((r) => r.txid);
const seed = () => { sqlite.exec("DELETE FROM chain_events WHERE event_type LIKE 'broker_%' OR event_type = 'other_event'"); for (const [, tx] of ROWS) insert('broker_fee_landed', tx); insert('other_event', 'g'.repeat(64)); };   // chain_events 有 UNIQUE(txid,event_type) ⇒ 每次 seed 全清(含对照行)

t('① 源码已是正形 [^a-fA-F0-9](与 :2452 触发器同款)', () => { assert.strictEqual(GLOB, '*[^a-fA-F0-9]*'); assert.ok(TRIGGER_DDL.includes("GLOB '*[^a-fA-F0-9]*'")); });
t('② 生产 DELETE 原文(临时 DROP 触发器后插四类): 只删 长度≠64 / g×64 / -×64, 两条合法 64-hex 留存; 非 broker_% 行不动', () => {
  sqlite.exec('DROP TRIGGER IF EXISTS chain_events_txid_format_check'); seed();
  const r = sqlite.prepare(DELETE_SQL).run(); assert.strictEqual(r.changes, 3, `changes=${r.changes}`);
  assert.deepStrictEqual(remaining(), ['0123456789abcdef'.repeat(4), 'a'.repeat(64)].sort());
  assert.strictEqual(sqlite.prepare("SELECT COUNT(*) c FROM chain_events WHERE event_type='other_event'").get().c, 1);
});
t('③ 阴性对照: 同数据跑错形 [!a-fA-F0-9] ⇒ 合法 64-hex 行也被删、g×64/-×64 反而留(证明错形确实反向且漏)', () => {
  seed(); const bad = DELETE_SQL.replace("'*[^a-fA-F0-9]*'", "'*[!a-fA-F0-9]*'"); assert.notStrictEqual(bad, DELETE_SQL);
  const r = sqlite.prepare(bad).run(); assert.strictEqual(r.changes, 3, `changes=${r.changes}`);
  assert.deepStrictEqual(remaining(), ['-'.repeat(64), 'g'.repeat(64)]);
});
t('④ 幂等: 重建触发器后 runMigrations() ×2 ⇒ :2433 守卫使 v83 块不执行, broker_% 行数不变; 且触发器仍拒非 hex 插入', () => {
  sqlite.exec('DROP TRIGGER IF EXISTS chain_events_txid_format_check'); seed(); sqlite.exec(TRIGGER_DDL);
  const before = remaining().length; assert.strictEqual(before, 5);
  runMigrations(); runMigrations(); assert.strictEqual(remaining().length, before, 'v83 块被重跑了(守卫失效)');
  assert.ok(/if \(!has_v83_trigger\)/.test(SRC), '守卫文本不在');
  assert.throws(() => insert('broker_fee_landed', 'zz'.repeat(32)), /64-hex/);
});
console.log(`\n${fail === 0 ? '✅' : '🔴'} migrate-v83-glob: ${pass} PASS / ${fail} FAIL`);
process.exitCode = fail ? 1 : 0;
try { sqlite.close(); } catch {}
try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch (e) { console.warn('⚠ 清理失败(不改判定): ' + (e?.message || e)); }
